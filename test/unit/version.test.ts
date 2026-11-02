import { describe, expect, it } from "vitest";

import { isSupportedElasticsearch } from "../../lib/version";

describe("isSupportedElasticsearch", () => {
  it.each(["9.0.0", "9.1.2", "9.99.0", "9.0.0-SNAPSHOT"])(
    "accepts Elasticsearch %s",
    (number) => {
      expect(isSupportedElasticsearch({ number })).toBe(true);
    },
  );

  it.each(["8.17.0", "10.0.0", "10.1.0"])(
    "refuses Elasticsearch %s",
    (number) => {
      expect(isSupportedElasticsearch({ number })).toBe(false);
    },
  );

  it("refuses OpenSearch, whatever version it reports", () => {
    expect(
      isSupportedElasticsearch({
        distribution: "opensearch",
        number: "9.10.2",
      }),
    ).toBe(false);
  });

  it("refuses an unreadable version", () => {
    expect(isSupportedElasticsearch({ number: "unknown" })).toBe(false);
  });
});
