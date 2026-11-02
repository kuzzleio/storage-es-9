/**
 * The engine as Kuzzle sees it: the family `info()` names, which plugins read
 * as `getStorageEngine().engine`, and the optional `close()` hook Kuzzle
 * (2.61 and later) calls once per instance on a graceful shutdown.
 *
 * The family is the one thing here that differs between the drivers, so it
 * arrives as a parameter: `"elasticsearch"` or `"opensearch"`.
 */
import { describe, expect, it } from "vitest";

import type { ESHarness } from "./harness";

export type ESEngine = "elasticsearch" | "opensearch";

export function describeEngine(harness: ESHarness, engine: ESEngine) {
  describe("#info", () => {
    it(`names "${engine}" as its engine, with the server's version`, async () => {
      harness.clientStub.info.mockResolvedValue(
        harness.envelope.respond({
          version: { lucene_version: "9.12.0", number: "1.2.3" },
        }),
      );
      harness.clientStub.cluster.health.mockResolvedValue(
        harness.envelope.respond({ status: "green" }),
      );
      harness.clientStub.cluster.stats.mockResolvedValue(
        harness.envelope.respond({
          indices: { store: { size: "1kb" } },
          nodes: { count: { total: 1 } },
        }),
      );

      expect(await harness.client.info()).toMatchObject({
        status: "green",
        type: engine,
        version: "1.2.3",
      });
    });
  });

  describe("#close", () => {
    it("closes the engine client", async () => {
      await harness.client.close();

      expect(harness.clientStub.close).toHaveBeenCalledTimes(1);
    });

    it("closes it once, however many times it is called", async () => {
      await Promise.all([harness.client.close(), harness.client.close()]);
      await harness.client.close();

      expect(harness.clientStub.close).toHaveBeenCalledTimes(1);
    });

    it("has nothing to close before init() built the client", async () => {
      // Read as `harness.client` is: the driver of whichever major
      const driver: ESHarness["client"] = harness.build().driver;

      Reflect.deleteProperty(driver, "_client");

      await expect(driver.close()).resolves.toBeUndefined();
    });

    it("rejects with the client's failure, which Kuzzle logs", async () => {
      harness.clientStub.close.mockRejectedValue(harness.esClientError);

      await expect(harness.client.close()).rejects.toBe(harness.esClientError);
      await expect(harness.client.close()).rejects.toBe(harness.esClientError);
      expect(harness.clientStub.close).toHaveBeenCalledTimes(1);
    });
  });
}
