/*
 * Kuzzle, a backend software, self-hostable and ready to use
 * to power modern apps
 *
 * Copyright 2015-2022 Kuzzle
 * mailto: support AT kuzzle.io
 * website: http://kuzzle.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint sort-keys: 0 */

import { inspect } from "node:util";

import get from "lodash/get";
import type { Client } from "@elastic/elasticsearch";
import { errors as esErrors } from "@elastic/elasticsearch";
import type { JSONObject } from "kuzzle";
import { KuzzleError, storageError } from "kuzzle";

import { errorMessagesMapping } from "./esErrorMapping";
import type { ThrownESError } from "./esErrorMapping";
import { createDebug } from "./helpers";

const debug = createDebug("kuzzle:services:storage:es9");

/** The engine, as the messages below name it */
const ENGINE = "Elasticsearch";

/**
 * One that came back from the cluster rather than from the client itself, so
 * its `meta` is present — which is what `formatESError` checks before handing
 * it to the handlers below.
 */
type ThrownESResponseError = ThrownESError & { meta: JSONObject };

function isResponseError(error: ThrownESError): error is ThrownESResponseError {
  return Boolean(error.meta);
}

/**
 * What the client puts in `message` when the response carried nothing it could
 * read: this placeholder, or an empty string for a bodyless response.
 */
const CLIENT_PLACEHOLDER_MESSAGE = "Response Error";

function isUsableMessage(message: unknown): message is string {
  return (
    typeof message === "string" &&
    message.trim() !== "" &&
    message !== CLIENT_PLACEHOLDER_MESSAGE
  );
}

/**
 * A message for an error that came with none worth keeping (typically a 503
 * with no body while shards initialize), built from what the error still
 * carries: the client's error name, the HTTP status and the response body.
 */
function describeUnreadableError(error: ThrownESError): string {
  const statusCode = error.meta?.statusCode;
  const body = error.meta?.body;
  const hasBody = body !== undefined && body !== null && body !== "";

  let description =
    statusCode === undefined
      ? `${ENGINE} request failed`
      : `${ENGINE} responded ${statusCode}`;

  description += hasBody
    ? `: ${inspect(body, { breakLength: Infinity, depth: 3 })}`
    : " (no body)";

  return error.name && error.name !== "Error"
    ? `${error.name}: ${description}`
    : description;
}

class ESWrapper {
  public client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Transforms raw ES errors into a normalized Kuzzle version
   *
   * @param error
   */
  formatESError(error: unknown): KuzzleError {
    if (error instanceof KuzzleError) {
      return error;
    }

    // `catch` answers `unknown`, and a rejected client promise can in principle
    // carry anything. Everything below reads an Error's shape, so that is what
    // it gets — without asserting that whatever arrived already was one.
    // `inspect`, not `String`: a thrown object stringifies to "[object
    // Object]", which is the one thing the message must not say.
    const esError: ThrownESError =
      error instanceof Error ? error : new Error(inspect(error));

    global.kuzzle.emit("services:storage:error", {
      message: `${ENGINE} Client error: ${esError.message}`,
      // /!\ not all ES error classes have a "meta" property
      meta: esError.meta || null,
      stack: esError.stack,
    });

    if (error instanceof esErrors.NoLivingConnectionsError) {
      throw storageError.get("not_connected");
    }
    const message: string = get(
      esError,
      "meta.body.error.reason",
      esError.message,
    );

    // Try to match a known elasticsearch error
    for (const betterError of errorMessagesMapping) {
      const matches = message.match(betterError.regex);

      if (matches) {
        return storageError.get(
          betterError.subcode,
          ...betterError.getPlaceholders(esError, matches),
        );
      }
    }

    // Try to match using error codes
    // `meta` is what tells a cluster response from a client-side failure, so
    // the three handlers below are declared to require it rather than
    // re-checking it four times each. The error itself is handed over, never a
    // copy: the client's `ResponseError` exposes `body` as a prototype getter,
    // which a spread does not carry — and without it every missing document
    // answered `unexpected_not_found` instead of `not_found`.
    if (isResponseError(esError)) {
      switch (esError.meta.statusCode) {
        case 400:
          return this._handleBadRequestError(esError, message);
        case 404:
          return this._handleNotFoundError(esError, message);
        case 409:
          return this._handleConflictError(esError, message);
        default:
          break;
      }
    }

    return this._handleUnknownError(esError, message);
  }

  reject(error: unknown): Promise<never> {
    return Promise.reject(this.formatESError(error));
  }

  _handleConflictError(
    error: ThrownESResponseError,
    message: string,
  ): KuzzleError {
    debug('unhandled "Conflict" elasticsearch error: %o', error);

    return storageError.get("unexpected_error", message);
  }

  _handleNotFoundError(
    error: ThrownESResponseError,
    message: string,
  ): KuzzleError {
    let errorMessage = message;

    const indice: string | undefined = get(error, "body._index");

    if (!indice) {
      return storageError.get("unexpected_not_found", errorMessage);
    }

    // _index= "&nyc-open-data.yellow-taxi"
    const index = indice.split(".")[0]?.slice(1);
    const collection = indice.split(".")[1];

    // 404 on a GET document
    if (error.body?.found === false) {
      return storageError.get("not_found", error.body._id, index, collection);
    }

    // 404 on DELETE document (ES error payloads are so cool!)
    if (error.meta.body._id) {
      return storageError.get(
        "not_found",
        error.meta.body._id,
        index,
        collection,
      );
    }

    if (error.meta.body?.error) {
      errorMessage = error.meta.body.error
        ? `${error.meta.body.error.reason}: ${error.meta.body.error["resource.id"]}`
        : `${error.message}: ${error.body?._id}`;
    }

    debug('unhandled "NotFound" elasticsearch error: %o', error);

    return storageError.get("unexpected_not_found", errorMessage);
  }

  _handleBadRequestError(
    error: ThrownESResponseError,
    message: string,
  ): KuzzleError {
    let errorMessage = message;

    if (error.meta.body?.error) {
      errorMessage = error.meta.body.error.root_cause
        ? error.meta.body.error.root_cause[0].reason
        : error.meta.body.error.reason;

      // empty query throws exception with ES 7
      if (
        error.meta.body.error.type === "parsing_exception" &&
        get(error, "meta.body.error.caused_by.type") ===
          "illegal_argument_exception"
      ) {
        errorMessage = error.meta.body.error.caused_by.reason;
      }
    }

    debug(
      'unhandled "BadRequest" elasticsearch error: %o',
      get(error, "meta.body.error.reason", error.message),
    );

    return storageError.get("unexpected_bad_request", errorMessage);
  }

  _handleUnknownError(error: ThrownESError, message: string): KuzzleError {
    debug(
      "unhandled elasticsearch error (unhandled type: %s): %o",
      get(error, "meta.statusCode", "<no status code>"),
      error,
    );

    return storageError.get(
      "unexpected_error",
      isUsableMessage(message) ? message : describeUnreadableError(error),
    );
  }
}

export = ESWrapper;
