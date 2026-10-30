import { vi } from "vitest";

import { ES9Driver } from "../../lib";
import { describeElasticsearch } from "./elasticsearchCases";

vi.mock("kuzzle", async (importOriginal) => {
  const { withLock } = await import("./elasticsearchCases/lockFixture");

  return { ...(await importOriginal<typeof import("kuzzle")>()), withLock };
});

describeElasticsearch("9", ES9Driver);
