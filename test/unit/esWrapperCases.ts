import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalServiceError } from "kuzzle";
import { restoreKuzzle, stubKuzzle } from "../mocks/kuzzle";

/**
 * The `esWrapper` spec of the storage drivers: the same file in `storage-es-7`,
 * `storage-es-8`, `storage-es-9`, `storage-opensearch-2` and
 * `storage-opensearch-3`, each one naming its own wrapper, client error class
 * and engine.
 */
type ESWrapperClass = new (client: unknown) => {
  formatESError: (error: unknown) => Error & { id?: string };
};

/** The one thing an error's `meta` has to carry for the wrapper to read it. */
type ESError = Error & { body?: unknown; meta?: unknown };

/**
 * The client's own `ResponseError`, which the cases above cannot stand in for:
 * it exposes `body` as a prototype getter, not an own property.
 */
type ResponseErrorClass = new (meta: {
  body: unknown;
  headers: Record<string, string>;
  meta: Record<string, unknown>;
  statusCode: number;
  warnings: string[] | null;
}) => Error;

export function describeESWrapper(
  version: string,
  ESWrapper: ESWrapperClass,
  ResponseError: ResponseErrorClass,
  engine: "Elasticsearch" | "OpenSearch" = "Elasticsearch",
) {
  describe(`#service/storage/${version}/esWrapper`, () => {
    let wrapper: InstanceType<ESWrapperClass>;
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      /*
       * The wrapper turns a client error into a Kuzzle one and, in production,
       * emits the original for support. `emit` is the whole dependency; the
       * client is never called, so it is an empty object rather than a mock of
       * elasticsearch.
       */
      emit = vi.fn();
      stubKuzzle({ emit });
      wrapper = new ESWrapper({});
    });

    afterEach(() => {
      restoreKuzzle();
    });

    const withMeta = (message: string, meta: unknown): ESError =>
      Object.assign(new Error(message), { meta });

    describe("#formatESError", () => {
      /*
       * `catch` answers `unknown`, so a rejected client promise can carry
       * something that is not an Error at all. Everything below reads an
       * Error's shape; this is the normalisation that lets it.
       */
      it("accepts a thrown value that is not an Error", () => {
        const formatted = wrapper.formatESError("a bare string");

        expect(formatted).toBeInstanceOf(ExternalServiceError);
        expect(formatted.id).toBe("services.storage.unexpected_error");
      });

      it("converts an unknown error to an ExternalServiceError", () => {
        const formatted = wrapper.formatESError(
          withMeta("test", { statusCode: 420 }),
        );

        expect(formatted).toBeInstanceOf(ExternalServiceError);
        expect(formatted.id).toBe("services.storage.unexpected_error");
      });

      it("recognises a version conflict", () => {
        const formatted = wrapper.formatESError(
          withMeta(
            '[version_conflict_engine_exception] [data][AVrbg0eg90VMe4Z_dG8j]: version conflict, current version [153] is different than the one provided [152], with { index_uuid="iDrU6CfZSO6CghM1t6dl0A" & shard="2" & index="userglobaldata" }',
            { statusCode: 409 },
          ),
        );

        expect(formatted).toBeInstanceOf(ExternalServiceError);
        expect(formatted.id).toBe("services.storage.too_many_changes");
      });

      it("recognises a document that already exists", () => {
        const formatted = wrapper.formatESError(
          withMeta("", {
            body: {
              error: {
                reason:
                  "[liia]: version conflict, document already exists (current version [1])",
              },
            },
          }),
        );

        expect(formatted).toMatchObject({
          id: "services.storage.document_already_exists",
        });
      });

      it("names the index and collection of a document not found", () => {
        const error = withMeta("test", { statusCode: 404 });
        error.body = {
          _id: "mehry",
          _index: "&nyc-open-data.yellow-taxi",
          error: { reason: "foo", "resource.id": "bar" },
          found: false,
        };

        expect(wrapper.formatESError(error)).toMatchObject({
          id: "services.storage.not_found",
          message:
            'Document "mehry" not found in "nyc-open-data":"yellow-taxi".',
        });
      });

      it("names a document not found from the client's own ResponseError", () => {
        // A plain object built like the case above has `body` as an own
        // property, which is what hid a spread that lost the real one's.
        const error = new ResponseError({
          body: {
            _id: "mehry",
            _index: "&nyc-open-data.yellow-taxi",
            found: false,
          },
          headers: {},
          meta: {},
          statusCode: 404,
          warnings: null,
        });

        expect(wrapper.formatESError(error)).toMatchObject({
          id: "services.storage.not_found",
          message:
            'Document "mehry" not found in "nyc-open-data":"yellow-taxi".',
        });
      });

      it.each([
        [400, "services.storage.unexpected_bad_request"],
        [409, "services.storage.unexpected_error"],
      ])(
        "hands the client's own ResponseError to the %i handler",
        (statusCode, id) => {
          const error = new ResponseError({
            body: { error: { reason: "something unmapped" } },
            headers: {},
            meta: {},
            statusCode,
            warnings: null,
          });

          expect(wrapper.formatESError(error)).toMatchObject({ id });
        },
      );

      /*
       * Issue #3032: a bodyless answer (a 503 while shards initialize) gave
       * the client nothing to put in `message` — "" on ES 8, the "Response
       * Error" placeholder on ES 7 — so `unexpected_error` said nothing, and
       * the status code was lost. Same id and class, a message that says why.
       */
      describe("an unexpected error with no usable message", () => {
        it.each([undefined, ""])(
          "names the status of a bodyless response (body: %j)",
          (body) => {
            const error = new ResponseError({
              body,
              headers: {},
              meta: {},
              statusCode: 503,
              warnings: null,
            });

            const formatted = wrapper.formatESError(error);

            expect(formatted).toBeInstanceOf(ExternalServiceError);
            expect(formatted).toMatchObject({
              id: "services.storage.unexpected_error",
              message: `ResponseError: ${engine} responded 503 (no body)`,
              status: 500,
            });
          },
        );

        it("shows a body the client could not turn into a message", () => {
          const formatted = wrapper.formatESError(
            withMeta("Response Error", {
              body: { status: "unavailable" },
              statusCode: 503,
            }),
          );

          expect(formatted).toMatchObject({
            id: "services.storage.unexpected_error",
            message: `${engine} responded 503: { status: 'unavailable' }`,
          });
        });

        it("says so when there is no status either", () => {
          expect(wrapper.formatESError(new Error(""))).toMatchObject({
            id: "services.storage.unexpected_error",
            message: `${engine} request failed (no body)`,
          });
        });

        it.each([
          [
            "the error's own message",
            withMeta("test", { statusCode: 420 }),
            "test",
          ],
          [
            "the reason ES gave",
            withMeta("", {
              body: { error: { reason: "shards unavailable" } },
              statusCode: 503,
            }),
            "shards unavailable",
          ],
        ])("keeps %s unchanged", (_, error, message) => {
          expect(wrapper.formatESError(error)).toMatchObject({
            id: "services.storage.unexpected_error",
            message,
          });
        });

        it("keeps the reason of the client's own ResponseError", () => {
          const error = new ResponseError({
            body: { error: { reason: "something unmapped", type: "x" } },
            headers: {},
            meta: {},
            statusCode: 503,
            warnings: null,
          });

          expect(wrapper.formatESError(error)).toMatchObject({
            id: "services.storage.unexpected_error",
            message: "something unmapped",
          });
        });
      });

      it("falls back when a not-found carries no index", () => {
        const error = withMeta("test", { statusCode: 404 });
        error.body = {
          _id: "mehry",
          error: { reason: "foo", "resource.id": "bar" },
          found: false,
        };

        expect(wrapper.formatESError(error)).toMatchObject({
          id: "services.storage.unexpected_not_found",
          message: "test",
        });
      });

      /*
       * The messages the engines answer, as their sources build them (see
       * the citations in lib/esErrorMapping.ts), read from the `reason` of
       * the response body as the wrapper does.
       */
      describe("the engines' own messages", () => {
        const fromReason = (reason: string, statusCode: number): ESError =>
          withMeta("ignored client message", {
            body: { error: { reason } },
            statusCode,
          });

        it.each([
          [
            "an Elasticsearch thread pool rejection",
            "rejected execution of org.elasticsearch.common.util.concurrent.TimedRunnable@1c7a3f0b on EsThreadPoolExecutor[name = node-1/write, queue capacity = 10000, org.elasticsearch.common.util.concurrent.EsThreadPoolExecutor@6b2e0c86[Running, pool size = 8, active threads = 8, queued tasks = 10000, completed tasks = 123456]]",
            429,
            "services.storage.too_many_operations",
            '"write" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "an Elasticsearch 8 rejection on a tracking executor",
            "rejected execution of org.elasticsearch.action.support.replication.TransportWriteAction$1@5f2a9c1e on TaskExecutionTimeTrackingEsThreadPoolExecutor[name = node-1/write, queue capacity = 10000, task execution EWMA = 1.2ms, total task execution time = 3.4s, org.elasticsearch.common.util.concurrent.TaskExecutionTimeTrackingEsThreadPoolExecutor@2b9e4f7a[Running, pool size = 8, active threads = 8, queued tasks = 10000, completed tasks = 987]]",
            429,
            "services.storage.too_many_operations",
            '"write" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "an OpenSearch thread pool rejection",
            "rejected execution of org.opensearch.common.util.concurrent.TimedRunnable@3a1b2c4d on OpenSearchThreadPoolExecutor[name = node-1/write, queue capacity = 10000, org.opensearch.common.util.concurrent.OpenSearchThreadPoolExecutor@7e8f9a0b[Running, pool size = 8, active threads = 8, queued tasks = 10000, completed tasks = 123456]]",
            429,
            "services.storage.too_many_operations",
            '"write" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "an OpenSearch search pool rejection",
            "rejected execution of org.opensearch.common.util.concurrent.TimedRunnable@4b5c6d7e on QueueResizingOpenSearchThreadPoolExecutor[name = node-1/search, queue capacity = 1000, min queue capacity = 1000, max queue capacity = 1000, frame size = 2000, targeted response rate = 1s, task execution EWMA = 2.1ms, adjustment amount = 50, org.opensearch.common.util.concurrent.QueueResizingOpenSearchThreadPoolExecutor@1f2e3d4c[Running, pool size = 13, active threads = 13, queued tasks = 1000, completed tasks = 4242]]",
            429,
            "services.storage.too_many_operations",
            '"search" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "the legacy client's form of a rejection",
            "[es_rejected_execution_exception] rejected execution of org.elasticsearch.transport.TransportService$7@7b8c9d0e on EsThreadPoolExecutor[bulk, queue capacity = 200, org.elasticsearch.common.util.concurrent.EsThreadPoolExecutor@5a6b7c8d[Running, pool size = 8, active threads = 8, queued tasks = 200, completed tasks = 42]]",
            429,
            "services.storage.too_many_operations",
            '"bulk" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "an indexing pressure rejection",
            "rejected execution of coordinating operation [coordinating_and_primary_bytes=1024, replica_bytes=0, all_bytes=1024, coordinating_operation_bytes=2048, max_coordinating_and_primary_bytes=1536]",
            429,
            "services.storage.too_many_operations",
            '"coordinating" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "an OpenSearch shard indexing pressure rejection",
            "rejected execution of primary operation [shard_detail=[&nyc-open-data.yellow-taxi][0], shard_total_bytes=1024, shard_operation_bytes=2048, shard_max_bytes=1536]",
            429,
            "services.storage.too_many_operations",
            '"primary" threads buffer exceeded. Too many operations received at once.',
          ],
          [
            "a type change",
            "mapper [age] cannot be changed from type [long] to [text]",
            400,
            "services.storage.cannot_change_mapping",
            'Field "age" already has a mapping, and it cannot be changed',
          ],
          [
            "a parameter change",
            "Mapper for [name] conflicts with existing mapper:\n\tCannot update parameter [analyzer] from [standard] to [english]",
            400,
            "services.storage.cannot_change_mapping",
            'Field "name" already has a mapping, and it cannot be changed',
          ],
          [
            "an object replacing a field",
            "can't merge a non object mapping [name] with an object mapping",
            400,
            "services.storage.cannot_change_mapping",
            'Field "name" already has a mapping, and it cannot be changed',
          ],
          [
            "an Elasticsearch 7 nested change",
            "can't merge a nested mapping [address] with a non-nested mapping",
            400,
            "services.storage.cannot_change_mapping",
            'Field "address" already has a mapping, and it cannot be changed',
          ],
          [
            "an Elasticsearch 8 nested change",
            "can't merge a non-nested mapping [address] with a nested mapping",
            400,
            "services.storage.cannot_change_mapping",
            'Field "address" already has a mapping, and it cannot be changed',
          ],
          [
            "an unsupported mapping parameter",
            "Mapping definition for [flags] has unsupported parameters:  [index : not_analyzed]",
            400,
            "services.storage.unexpected_properties",
            'Property "index : not_analyzed" is not supported for field "flags".',
          ],
          [
            "an unknown mapping parameter",
            "unknown parameter [foo] on mapper [flags] of type [keyword]",
            400,
            "services.storage.unexpected_properties",
            'Property "foo" is not supported for field "flags".',
          ],
          [
            "an unknown parameter in a new index's mapping",
            "Failed to parse mapping [_doc]: unknown parameter [foo] on mapper [flags] of type [keyword]",
            400,
            "services.storage.unexpected_properties",
            'Property "foo" is not supported for field "flags".',
          ],
          [
            "an unknown type",
            "No handler for type [boolean] declared on field [not]",
            400,
            "services.storage.invalid_mapping_type",
            'Field "not": the data type "boolean" doesn\'t exist',
          ],
          [
            "an unknown type in a new index's mapping",
            "Failed to parse mapping [_doc]: No handler for type [boolean] declared on field [not]",
            400,
            "services.storage.invalid_mapping_type",
            'Field "not": the data type "boolean" doesn\'t exist',
          ],
          [
            "an Elasticsearch 8 unknown type",
            "The mapper type [boolean] declared on field [not] does not exist. It might have been created within a future version or requires a plugin to be installed. Check the documentation.",
            400,
            "services.storage.invalid_mapping_type",
            'Field "not": the data type "boolean" doesn\'t exist',
          ],
          [
            "a malformed multi-field",
            "Expected map for property [fields] on field [foo] but got a class java.lang.String",
            400,
            "services.storage.wrong_mapping_property",
            'Cannot parse mapping property "foo.fields"',
          ],
          [
            "a missing collection",
            "no such index [&nyc-open-data.yellow-taxi]",
            404,
            "services.storage.unknown_collection",
            'The collection "nyc-open-data":"yellow-taxi" does not exist.',
          ],
          [
            "a version conflict",
            "[mehry]: version conflict, required seqNo [3], primary term [1]. current document has seqNo [4] and primary term [1]",
            409,
            "services.storage.too_many_changes",
            'Unable to modify document "mehry": cluster sync failed (too many simultaneous changes applied)',
          ],
          [
            "a document created twice",
            "[mehry]: version conflict, document already exists (current version [1])",
            409,
            "services.storage.document_already_exists",
            "Document already exists.",
          ],
          [
            "an unknown query",
            "unknown query [equals] did you mean [term]?",
            400,
            "services.storage.unknown_query_keyword",
            'The keyword "equals" is not part of Elasticsearch Query DSL. Are you trying to use a Koncorde query?',
          ],
        ])("recognises %s", (_, reason, statusCode, id, message) => {
          expect(
            wrapper.formatESError(fromReason(reason, statusCode)),
          ).toMatchObject({ id, message });
        });

        it.each([
          "mapping set to strict, dynamic introduction of [lehuong] within [_doc] is not allowed",
          "[1:15] mapping set to strict, dynamic introduction of [lehuong] within [_doc] is not allowed",
          "mapping set to strict_allow_templates, dynamic introduction of [lehuong] within [_doc] is not allowed",
        ])("recognises a strict mapping rejection: %s", (reason) => {
          const error = withMeta("", {
            body: { error: { reason } },
            meta: {
              request: {
                params: { path: "/%26nyc-open-data.yellow-taxi/_doc" },
              },
            },
            statusCode: 400,
          });

          expect(wrapper.formatESError(error)).toMatchObject({
            id: "services.storage.strict_mapping_rejection",
            message:
              'Cannot create document. Field "lehuong" is not present in collection "nyc-open-data:yellow-taxi" strict mapping',
          });
        });

        it("keeps OpenSearch's nested change, which names no field, as a bad request", () => {
          const reason =
            "cannot change object mapping from nested to non-nested";

          expect(wrapper.formatESError(fromReason(reason, 400))).toMatchObject({
            id: "services.storage.unexpected_bad_request",
            message: reason,
          });
        });
      });

      it.each([
        "[and] query malformed, no start_object after query name",
        "no [query] registered for [equals]",
      ])("recognises an unknown DSL keyword: %s", (reason) => {
        const error = withMeta("", { body: { error: { reason } } });

        expect(wrapper.formatESError(error)).toMatchObject({
          id: "services.storage.unknown_query_keyword",
        });
      });

      /*
       * The Mocha specs wrapped these in a `describe("logging in production")`
       * that set `global.NODE_ENV = "production"` — and there is **no such
       * branch**: `formatESError` emits unconditionally, in every environment.
       * The setup was decorative, and it read as a guarantee the subject does
       * not make. Dropped, and the unconditional emit is what is asserted.
       */
      describe("emitting the source error", () => {
        it("emits it for support and debugging", () => {
          const error = withMeta("test", {
            meta: { request: { oh: "noes" } },
            statusCode: 420,
          });

          wrapper.formatESError(error);

          expect(emit).toHaveBeenCalledWith("services:storage:error", {
            message: `${engine} Client error: ${error.message}`,
            meta: error.meta,
            stack: error.stack,
          });
        });

        it("emits null for an error that carries no meta", () => {
          const error = new Error("test");

          wrapper.formatESError(error);

          expect(emit).toHaveBeenCalledWith("services:storage:error", {
            message: `${engine} Client error: ${error.message}`,
            meta: null,
            stack: error.stack,
          });
        });

        it.each(["production", "development"])(
          "emits in %s alike — there is no environment guard",
          (env) => {
            global.NODE_ENV = env;

            wrapper.formatESError(withMeta("test", { statusCode: 420 }));

            expect(emit).toHaveBeenCalledTimes(1);
          },
        );
      });
    });
  });
}
