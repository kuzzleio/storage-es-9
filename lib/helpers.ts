/*
 * Small helpers the storage drivers import from Kuzzle's internals,
 * copied as they are: they are not part of what `kuzzle` exports.
 */

import assert from "node:assert";
import * as util from "node:util";

import createDebugLogger from "debug";
import didYouMeanLib from "didyoumean";
import { BadRequestError } from "kuzzle";

export function isPlainObject(o: unknown): o is Record<string, unknown> {
  return Object.prototype.toString.call(o) === "[object Object]";
}

/** Kuzzle's `api.assert.invalid_argument` error */
export function assertIsObject(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new BadRequestError(
      `Invalid argument "${String(value)}". Expected: object`,
      "api.assert.invalid_argument",
      // (domain 2 << 24) | (subdomain 1 << 16) | code 2
      0x02010002,
    );
  }
}

/** A "did you mean" hint, in development only, as Kuzzle prints it */
export function didYouMean(str: string, list: readonly string[]): string {
  if (global.NODE_ENV !== "development") {
    return "";
  }

  const result = didYouMeanLib(str, [...list]);

  if (!result) {
    return "";
  }

  return ` Did you mean "${result}"?`;
}

/** Resolves after `ms` milliseconds (what `Bluebird.delay` did) */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function randomNumber(max: number): number {
  return Math.floor(Math.random() * Math.floor(max));
}

interface ExtractedField {
  key: string;
  value: unknown;
}

interface ExtractOptions {
  fieldsToIgnore?: string[];
  alsoExtractValues?: boolean;
}

interface ExtractState {
  path?: string | null;
  extractedFields?: Array<string | ExtractedField>;
}

export function extractFields(
  document: Record<string, unknown>,
  options: ExtractOptions & { alsoExtractValues: true },
): ExtractedField[];
export function extractFields(
  document: Record<string, unknown>,
  options?: ExtractOptions & { alsoExtractValues?: false },
): string[];
export function extractFields(
  document: Record<string, unknown>,
  options?: ExtractOptions,
  state?: ExtractState,
): Array<string | ExtractedField>;
export function extractFields(
  document: Record<string, unknown>,
  { fieldsToIgnore = [], alsoExtractValues = false }: ExtractOptions = {},
  { path = null, extractedFields = [] }: ExtractState = {},
): Array<string | ExtractedField> {
  for (const [key, value] of Object.entries(document)) {
    if (fieldsToIgnore.includes(key)) {
      continue;
    }

    const currentPath = path ? `${path}.${key}` : key;

    if (isPlainObject(value)) {
      extractFields(
        value,
        { alsoExtractValues, fieldsToIgnore },
        { extractedFields, path: currentPath },
      );
    } else if (alsoExtractValues) {
      extractedFields.push({ key: currentPath, value });
    } else {
      extractedFields.push(currentPath);
    }
  }

  return extractedFields;
}

/**
 * A `debug` logger writing through Kuzzle's logger, as Kuzzle's own
 * `kuzzle:*` debug namespaces do
 */
export function createDebug(namespace: string) {
  const debug = createDebugLogger(namespace);

  debug.log = (message: string, ...args: unknown[]) => {
    if (!["debug", "trace"].includes(global.kuzzle.log.level)) {
      global.kuzzle.log.level = "debug";
    }
    global.kuzzle.log.debug({ namespace }, util.format(message, ...args));
  };

  return debug;
}

/*
 * What a failed connection to the storage engine looks like through the
 * clients. The TLS error code is lost on the way: every client wraps the
 * socket error in a `ConnectionError` that keeps its message only, so the
 * messages are matched too ("self-signed certificate", "unable to verify the
 * first certificate", "certificate has expired", "Hostname/IP does not match
 * certificate's altnames", ...).
 */
const TLS_ERROR_CODE =
  /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY_|UNABLE_TO_GET_ISSUER_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$)/;
const TLS_ERROR_MESSAGE = /certificate|Hostname\/IP does not match/i;

interface ConnectionFailure {
  cause?: { code?: unknown };
  code?: unknown;
  message?: unknown;
  meta?: { statusCode?: unknown };
  statusCode?: unknown;
}

/**
 * Whether an error met while waiting for the storage engine is one that
 * waiting will not fix: a TLS failure (untrusted or mismatching certificate),
 * or credentials the engine refuses (401, 403). A refused connection, a
 * timeout or a 503 is a cluster that is not up yet.
 */
export function isPermanentConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const failure = error as ConnectionFailure;
  const status = failure.statusCode ?? failure.meta?.statusCode;

  if (status === 401 || status === 403) {
    return true;
  }

  for (const code of [failure.code, failure.cause?.code]) {
    if (typeof code === "string" && TLS_ERROR_CODE.test(code)) {
      return true;
    }
  }

  // An answer means the TLS handshake succeeded: only a socket error's
  // message can describe a certificate problem
  return (
    !status &&
    typeof failure.message === "string" &&
    TLS_ERROR_MESSAGE.test(failure.message)
  );
}

/**
 * The text of whatever a client threw, for a log line, with the HTTP status
 * when the engine answered: a refusal's message is often only its type
 * ("security_exception")
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return util.inspect(error);
  }

  const failure = error as ConnectionFailure;
  const status = failure.statusCode ?? failure.meta?.statusCode;

  return status ? `${error.message} (HTTP ${String(status)})` : error.message;
}

// Allowed root keys of a search body. Inline scripts are refused anywhere in
// the body whatever the key, by the driver's `_scriptCheck`.
const SEARCH_BODY_KEYS = [
  "aggregations",
  "aggs",
  "collapse",
  "explain",
  "fields",
  "from",
  "highlight",
  "min_score",
  "post_filter",
  "query",
  "search_after",
  "search_timeout",
  "size",
  "sort",
  "suggest",
  "track_scores",
  "_name",
  "_source",
  "_source_excludes",
  "_source_includes",
];

// Root keys `search.additionalBodyKeys` cannot allow: they would override the
// indice, the pagination or the response shape Kuzzle sets and relies on, or
// expose its internal indice names.
const FORBIDDEN_SEARCH_BODY_KEYS = [
  "index",
  "pit",
  "profile",
  "rest_total_hits_as_int",
  "routing",
  "scroll",
  "track_total_hits",
];

/**
 * Answers the allowed root keys of a search body: the defaults, plus the ones
 * listed in `services.storageEngine.search.additionalBodyKeys`.
 *
 * Throws at startup on a malformed list, or on a key that would break what
 * Kuzzle sets on every search request.
 */
export function loadSearchBodyKeys(storageConfig: unknown): string[] {
  const configKey = "services.storageEngine.search.additionalBodyKeys";
  const search = isPlainObject(storageConfig) ? storageConfig.search : null;
  const additional =
    (isPlainObject(search) ? search.additionalBodyKeys : null) ?? [];

  assert(
    Array.isArray(additional) &&
      additional.every((key) => typeof key === "string" && key.length > 0),
    `${configKey} must be an array of non-empty strings.`,
  );

  const forbidden = additional.filter((key) =>
    FORBIDDEN_SEARCH_BODY_KEYS.includes(key),
  );

  assert(
    forbidden.length === 0,
    `${configKey} cannot allow: ${forbidden.join(", ")}.`,
  );

  return [...new Set([...SEARCH_BODY_KEYS, ...additional])];
}
