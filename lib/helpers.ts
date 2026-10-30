/*
 * Small helpers the Elasticsearch 8 driver imports from Kuzzle's internals,
 * copied as they are: they are not part of what `kuzzle` exports.
 */

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
