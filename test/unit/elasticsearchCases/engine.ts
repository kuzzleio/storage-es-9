/**
 * The engine as Kuzzle sees it: the family `info()` names, which plugins read
 * as `getStorageEngine().engine`, the optional `close()` hook Kuzzle
 * (2.61 and later) calls once per instance on a graceful shutdown, and the
 * wait for the engine at startup.
 *
 * The family is the one thing here that differs between the drivers, so it
 * arrives as a parameter: `"elasticsearch"` or `"opensearch"`.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

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

  /*
   * storage-es-8#9: the wait used to swallow every error, so a TLS or
   * credentials problem looked like a cluster that is not up yet, forever and
   * without a log line. The messages below are what the five clients really
   * throw: their `ConnectionError` keeps the socket error's message only.
   *
   * ⚠️ The wait is shared by every instance through a module-level state, and
   * these cases never let it reach "ready": once it has, every later call
   * returns at once, in this file and for good.
   */
  describe("#waitForElasticsearch", () => {
    const connectionError = (message: string) =>
      Object.assign(new Error(message), { name: "ConnectionError" });
    const responseError = (statusCode: number) =>
      Object.assign(new Error("security_exception"), {
        meta: { statusCode },
        name: "ResponseError",
        statusCode,
      });

    // Built by `harness.build()` after `harness.client`, so read off it
    const warn = () => vi.mocked(global.kuzzle.log.warn);

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      "self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca",
      "unable to verify the first certificate",
      "unable to get local issuer certificate",
      "certificate has expired",
      "Hostname/IP does not match certificate's altnames: Host: localhost. is not in the cert's altnames: DNS:other.example",
    ])("fails at once on a TLS failure: %s", async (message) => {
      harness.clientStub.cluster.health.mockRejectedValue(
        connectionError(message),
      );

      await expect(harness.client.waitForElasticsearch()).rejects.toMatchObject(
        {
          id: "services.storage.unexpected_error",
          message: expect.stringContaining(message),
        },
      );
      expect(harness.clientStub.cluster.health).toHaveBeenCalledTimes(1);
    });

    it("fails at once on a TLS error that still carries its code", async () => {
      harness.clientStub.cluster.health.mockRejectedValue(
        Object.assign(new Error("socket hang up"), {
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
        }),
      );

      await expect(harness.client.waitForElasticsearch()).rejects.toMatchObject(
        { id: "services.storage.unexpected_error" },
      );
    });

    it.each([401, 403])(
      "fails at once when the engine refuses the credentials (%i)",
      async (status) => {
        harness.clientStub.cluster.health.mockRejectedValue(
          responseError(status),
        );

        await expect(
          harness.client.waitForElasticsearch(),
        ).rejects.toMatchObject({
          id: "services.storage.unexpected_error",
          message: expect.stringContaining(
            `security_exception (HTTP ${status})`,
          ),
        });
      },
    );

    it("keeps retrying on what waiting fixes, and logs each new reason", async () => {
      vi.useFakeTimers();
      const refused = connectionError("connect ECONNREFUSED 10.0.0.1:9200");
      const timeout = Object.assign(new Error("Request timed out"), {
        name: "TimeoutError",
      });
      harness.clientStub.cluster.health
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(responseError(503))
        // ends the wait without letting it reach "ready" (see above)
        .mockRejectedValueOnce(responseError(401));

      const wait = harness.client.waitForElasticsearch();
      const settled = expect(wait).rejects.toMatchObject({
        message: expect.stringContaining("(HTTP 401)"),
      });
      await vi.advanceTimersByTimeAsync(5000);
      await settled;

      expect(harness.clientStub.cluster.health).toHaveBeenCalledTimes(6);
      expect(warn().mock.calls.map(([line]) => line)).toEqual([
        expect.stringContaining("connect ECONNREFUSED 10.0.0.1:9200"),
        expect.stringContaining("Request timed out"),
        expect.stringContaining("security_exception (HTTP 503)"),
      ]);
    });

    it("repeats an unchanged reason every 30 attempts", async () => {
      vi.useFakeTimers();
      const refused = connectionError("connect ECONNREFUSED 10.0.0.1:9200");
      for (let i = 0; i < 31; i++) {
        harness.clientStub.cluster.health.mockRejectedValueOnce(refused);
      }
      harness.clientStub.cluster.health.mockRejectedValueOnce(
        responseError(401),
      );

      const wait = harness.client.waitForElasticsearch();
      const settled = expect(wait).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(31_000);
      await settled;

      expect(warn()).toHaveBeenCalledTimes(2);
    });

    it("fails another instance waiting on the same engine too", async () => {
      vi.useFakeTimers();
      // Read as `harness.client` is: the driver of whichever major
      const other: ESHarness["client"] = harness.build().driver;
      harness.clientStub.cluster.health
        .mockRejectedValueOnce(connectionError("connect ECONNREFUSED"))
        .mockRejectedValueOnce(responseError(401));
      other._client.cluster.health.mockRejectedValue(responseError(401));

      const first = harness.client.waitForElasticsearch();
      const second = other.waitForElasticsearch();
      const settled = Promise.all([
        expect(first).rejects.toMatchObject({ message: /HTTP 401/ }),
        expect(second).rejects.toMatchObject({ message: /HTTP 401/ }),
      ]);
      await vi.advanceTimersByTimeAsync(3000);
      await settled;
    });

    describe("with the real client", () => {
      let server: Server | null = null;

      afterEach(async () => {
        await new Promise((resolve) => server?.close(resolve) ?? resolve(null));
        server = null;
      });

      it("starts no further than an engine refusing the credentials", async () => {
        server = createServer((_, response) => {
          response.writeHead(401, {
            "content-type": "application/json",
            "x-elastic-product": "Elasticsearch",
          });
          response.end(
            JSON.stringify({
              error: {
                reason: "unable to authenticate",
                type: "security_exception",
              },
              status: 401,
            }),
          );
        });
        await new Promise<void>((resolve) =>
          server?.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;

        harness.config.client = { node: `http://127.0.0.1:${port}` };
        const built = harness.build();
        // No preset client: `_initSequence` builds the real one (see harness)
        Reflect.deleteProperty(built.driver, "_client");

        await expect(built.init()).rejects.toMatchObject({
          id: "services.storage.unexpected_error",
          message: expect.stringContaining("(HTTP 401)"),
        });
      });
    });
  });
}
