/**
 * The whole wire delta between Elasticsearch majors, in one place.
 *
 * Every difference between the drivers' specs is the transport, not the
 * behaviour (ES 9's client speaks ES 8's format):
 *
 * | | ES 7 | ES 8 and 9 |
 * | --- | --- | --- |
 * | response | `{ body: payload }` | `payload` |
 * | request payload | `body: { … }` | `…` at the root |
 * | document body | `body: { … }` | `document: { … }` |
 * | total-hits flag | `trackTotalHits` | `track_total_hits` |
 * | `_source` filter | `"true"` | `true` |
 * | bulk operations | `body: [...]` | `operations: [...]` |
 * | delete-by-query limit | `size` | `max_docs` |
 * | a query failure | `{ shardId, reason }` | `{ id, cause: { reason } }` |
 * | a scrolled batch | a callback the client calls back | a promise |
 * | an active shard count | `"1"` | `1` |
 * | alias actions | `body: { actions }` | ES 8: the same, ES 9: `actions` at the root |
 *
 * The cases are shared and the delta is a **value they read**, rather than a
 * helper that hides it: the envelope is what distinguishes the majors, so
 * each driver's spec still pins its own wire format.
 */
import type { JSONObject } from "kuzzle";

export interface ESEnvelope {
  readonly version: "7" | "8" | "9";

  /**
   * What the client answers for a given payload. ES 7's transport wraps every
   * response in `body`; ES 8's returns it flat.
   */
  respond<T>(payload: T): T | { body: T };

  /**
   * How a request payload is carried. ES 7 nests it under `body`; ES 8 puts
   * it at the root.
   *
   * ⚠️ Named `searchRequest` in L5a, when `search` was the only case in sight.
   * L5b found the same nesting on `count`'s filter and on `update`'s
   * `doc`/`upsert` pair, so it is the general rule and not a search one.
   */
  request(payload: JSONObject): JSONObject;

  /**
   * How a single document's content is carried in a write request. ES 7 calls
   * it `body`, ES 8 calls it `document`.
   */
  documentRequest(document: JSONObject): JSONObject;

  /**
   * The flag that asks for an exact hit total. Renamed to snake_case in the
   * ES 8 client.
   */
  readonly trackTotalHits: "trackTotalHits" | "track_total_hits";

  /**
   * The value `_source` takes when a spec asks for the whole source. The ES 7
   * client accepted the string; ES 8 takes the boolean.
   */
  readonly sourceEnabled: "true" | true;

  /**
   * The field a `bulk` request carries its operation list in. Renamed from
   * `body` to `operations` in the ES 8 client.
   */
  readonly bulkOperations: "body" | "operations";

  /**
   * The field `deleteByQuery` carries its document limit in. ES 7 reused
   * `size`; ES 8 has a dedicated `max_docs`.
   */
  readonly deleteLimit: "size" | "max_docs";

  /**
   * A `deleteByQuery` failure as the client reports it — the ES 8 client
   * moved the reason under `cause` and reports the document's `id` where
   * ES 7 reported the `shardId`.
   */
  readonly queryFailure: JSONObject;

  /** The same failure, as the subject answers it. */
  readonly reportedFailure: JSONObject;

  /**
   * `wait_for_active_shards` for a single-node cluster. ES 7 answers the
   * string, ES 8 the number — `_getWaitForActiveShards` differs in its last
   * line and nowhere else.
   */
  readonly singleShard: "1" | 1;

  /**
   * `wait_for_active_shards` for any other count, in the same two types:
   * `waitForCollectionShards` asks for as many as the collection has
   * primaries (#3074).
   */
  activeShards(count: number): string | number;

  /**
   * Arms a scroll-driving command to answer `payload`.
   *
   * ⚠️ The one entry here that is a **calling convention** rather than a
   * payload shape: `mExecute` drives the ES 7 client Node-style, handing
   * `search` a callback it calls again for each page, while the ES 8 client
   * answers a promise and the subject loops. A case cannot arm one the way it
   * arms the other, so the arming is named here like every other delta.
   */
  answerScroll(stub: any, payload: JSONObject): void;

  /**
   * How `generateMissingAliases` carries its alias actions: under `body` up
   * to ES 8, which never moved that call's payload to the root, at the root
   * on ES 9, whose client dropped `body`.
   */
  aliasRequest(payload: JSONObject): JSONObject;
}

export const ES7_ENVELOPE: ESEnvelope = {
  version: "7",
  respond: (payload) => ({ body: payload }),
  request: (payload) => ({ body: payload }),
  documentRequest: (document) => ({ body: document }),
  trackTotalHits: "trackTotalHits",
  sourceEnabled: "true",
  bulkOperations: "body",
  deleteLimit: "size",
  singleShard: "1",
  activeShards: (count) => String(count),
  queryFailure: { shardId: 42, reason: "error", foo: "bar" },
  reportedFailure: { shardId: 42, reason: "error" },
  answerScroll: (stub, payload) =>
    stub.mockImplementation((request: unknown, callback: any) =>
      callback(null, { body: payload }),
    ),
  aliasRequest: (payload) => ({ body: payload }),
};

export const ES8_ENVELOPE: ESEnvelope = {
  version: "8",
  respond: (payload) => payload,
  request: (payload) => ({ ...payload }),
  documentRequest: (document) => ({ document }),
  trackTotalHits: "track_total_hits",
  sourceEnabled: true,
  bulkOperations: "operations",
  deleteLimit: "max_docs",
  singleShard: 1,
  activeShards: (count) => count,
  queryFailure: { id: "_id2", cause: { reason: "error" }, foo: "bar" },
  reportedFailure: { id: "_id2", reason: "error" },
  answerScroll: (stub, payload) => stub.mockResolvedValue(payload),
  aliasRequest: (payload) => ({ body: payload }),
};

export const ES9_ENVELOPE: ESEnvelope = {
  ...ES8_ENVELOPE,
  version: "9",
  aliasRequest: (payload) => ({ ...payload }),
};

export const ENVELOPES: Record<"7" | "8" | "9", ESEnvelope> = {
  7: ES7_ENVELOPE,
  8: ES8_ENVELOPE,
  9: ES9_ENVELOPE,
};
