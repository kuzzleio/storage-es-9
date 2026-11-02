/*
 * The Elasticsearch versions this driver runs on, checked at startup against
 * what the cluster's root endpoint answers.
 */

import semver from "semver";

/** The Elasticsearch versions this driver runs on */
export const SUPPORTED_ELASTICSEARCH_VERSIONS = ">=9.0.0 <10.0.0";

/**
 * True when the cluster is an Elasticsearch one of a supported version.
 * OpenSearch answers the same endpoint with `distribution: "opensearch"`,
 * whatever version number it is set to report: it is refused, as is a version
 * out of range.
 */
export function isSupportedElasticsearch(version: {
  distribution?: string;
  number: string;
}): boolean {
  const coerced = semver.coerce(version.number);

  return (
    version.distribution !== "opensearch" &&
    coerced !== null &&
    semver.satisfies(coerced, SUPPORTED_ELASTICSEARCH_VERSIONS)
  );
}
