/* Kuzzle's conformance kit, against a real Elasticsearch 9
 * (ELASTICSEARCH_NODE, http://localhost:9200 by default). */

import { describeStorageDriverConformance } from "kuzzle";
import type { StorageCapability } from "kuzzle";
import { afterAll, beforeAll, describe, it } from "vitest";

import { ES9Driver } from "../lib";
import manifest from "../manifest.json";

describeStorageDriverConformance({
  Driver: ES9Driver,
  capabilities: manifest.capabilities as StorageCapability[],
  config: {
    client: { node: process.env.ELASTICSEARCH_NODE ?? "http://localhost:9200" },
  },
  test: { afterAll, beforeAll, describe, it },
});
