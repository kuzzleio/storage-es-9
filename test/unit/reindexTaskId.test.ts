/**
 * The re-indexation task id `updateCollection` reports.
 *
 * When a collection update re-indexes the collection, the update-by-query runs
 * as an engine background task (`wait_for_completion: false`), and its id is
 * all a caller has to follow it: `updateSearchIndex` answers it, and
 * `updateCollection` hands it on as `reindexTaskId`. An update that does not
 * re-index answers `null`, as it always did.
 *
 * Not one of the shared `elasticsearchCases`: the OpenSearch drivers share
 * those, and do not report the task (yet).
 */
import { describe, expect, it, vi } from "vitest";

import { ES9Driver } from "../../lib";
import { setupElasticsearch } from "./elasticsearchCases/harness";

const index = "nyc-open-data";
const collection = "yellow-taxi";
const indice = "&nyc-open-data.yellow-taxi";
const taskId = "oTUltX4IQMOUUVeiohTt8A:12345";

describe("Elasticsearch 9 driver: re-indexation task id", () => {
  const harness = setupElasticsearch("9", ES9Driver);

  describe("#updateSearchIndex", () => {
    it("answers the id of the background task", async () => {
      harness.clientStub.updateByQuery.mockResolvedValue(
        harness.envelope.respond({ task: taskId }),
      );

      await expect(
        harness.client.updateSearchIndex(index, collection),
      ).resolves.toEqual({ taskId });
    });

    it("leaves the id out when the engine reports none", async () => {
      harness.clientStub.updateByQuery.mockResolvedValue(
        harness.envelope.respond({}),
      );

      await expect(
        harness.client.updateSearchIndex(index, collection),
      ).resolves.toEqual({});
    });
  });

  describe("#updateCollection", () => {
    const arm = (existingDynamic: unknown = "false") => {
      vi.spyOn(harness.client, "_getIndice").mockResolvedValue(indice);

      harness.clientStub.indices.getSettings.mockResolvedValue(
        harness.envelope.respond({
          [indice]: { settings: { index: { blocks: { write: false } } } },
        }),
      );

      vi.spyOn(harness.client, "getMapping").mockResolvedValue({
        dynamic: existingDynamic,
        properties: { city: { type: "keyword" } },
      });

      vi.spyOn(harness.client, "updateMapping").mockResolvedValue(undefined);
      vi.spyOn(harness.client, "updateSettings").mockResolvedValue(undefined);

      harness.clientStub.updateByQuery.mockResolvedValue(
        harness.envelope.respond({ task: taskId }),
      );
    };

    it("answers the task id when asked to re-index the collection", async () => {
      arm();

      await expect(
        harness.client.updateCollection(index, collection, {
          mappings: { properties: { city: { type: "keyword" } } },
          reindexCollection: true,
        }),
      ).resolves.toEqual({ reindexTaskId: taskId });

      expect(harness.clientStub.updateByQuery).toHaveBeenCalledTimes(1);
    });

    it("answers the task id when a `dynamic` opening up re-indexes it", async () => {
      arm("false");

      await expect(
        harness.client.updateCollection(index, collection, {
          mappings: { dynamic: true },
        }),
      ).resolves.toEqual({ reindexTaskId: taskId });

      expect(harness.clientStub.updateByQuery).toHaveBeenCalledTimes(1);
    });

    it("answers null when the collection is not re-indexed", async () => {
      arm("false");

      await expect(
        harness.client.updateCollection(index, collection, {
          mappings: { properties: { city: { type: "keyword" } } },
          settings: { index: { blocks: { write: true } } },
        }),
      ).resolves.toBeNull();

      expect(harness.clientStub.updateByQuery).not.toHaveBeenCalled();
    });

    it("answers null for a settings-only update, even asked to re-index", async () => {
      arm();

      await expect(
        harness.client.updateCollection(index, collection, {
          reindexCollection: true,
          settings: { index: { blocks: { write: true } } },
        }),
      ).resolves.toBeNull();

      expect(harness.clientStub.updateByQuery).not.toHaveBeenCalled();
    });
  });

  describe("#createCollection", () => {
    /*
     * A collection that already exists is updated instead (#3033), which may
     * re-index it: `createCollection` still answers `null`.
     */
    it("answers null when it updated, and re-indexed, an existing collection", async () => {
      vi.spyOn(harness.client, "_getAvailableIndice").mockResolvedValue(indice);
      vi.spyOn(harness.client, "_getWaitForActiveShards").mockResolvedValue(1);
      vi.spyOn(harness.client, "waitForCollectionShards").mockResolvedValue(
        undefined,
      );
      vi.spyOn(harness.client, "hasCollection").mockResolvedValue(true);
      const update = vi
        .spyOn(harness.client, "updateCollection")
        .mockResolvedValue({ reindexTaskId: taskId });

      await expect(
        harness.client.createCollection(index, collection, {
          mappings: { dynamic: true },
        }),
      ).resolves.toBeNull();

      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
