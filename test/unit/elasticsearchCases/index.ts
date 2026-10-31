/**
 * The unit suite of the Elasticsearch drivers, moved out of Kuzzle's core with
 * them (ADR-0003 step 06): the same files in `storage-es-7`, `storage-es-8`
 * and `storage-es-9`. The subject is the driver class, run by Kuzzle's
 * `StorageService` against a stubbed client; what differs between majors is
 * the wire format, a value the cases read (see `envelope.ts`).
 *
 * | Group | Blocks |
 * | --- | --- |
 * | `inventory` | 16 — wiring, listings, existence, naming |
 * | `crud` | 8 — the single-document actions |
 * | `queries` | 8 — the query-wide actions, and the cursor they carry |
 * | `lifecycle` | 11 — index and collection lifecycle, mappings, settings |
 * | `multi` | 9 — the `m*` family and the extraction they share |
 * | `internals` | the collection-emulation name arithmetic and query guards |
 */
import { describe } from "vitest";

import { setupElasticsearch, type ESDriver, type ESVersion } from "./harness";
import { describeCrud } from "./crud";
import { describeInventory } from "./inventory";
import { describeInternals } from "./internals";
import { describeLifecycle } from "./lifecycle";
import { describeMulti } from "./multi";
import { describeQueries } from "./queries";

export function describeElasticsearch(version: ESVersion, Driver: ESDriver) {
  describe(`Elasticsearch ${version} driver`, () => {
    const harness = setupElasticsearch(version, Driver);

    describeInventory(harness);
    describeCrud(harness);
    describeQueries(harness);
    describeLifecycle(harness);
    describeMulti(harness);
    describeInternals(harness);
  });
}
