---
code: false
type: page
title: Configuration
order: 200
description: Configure the Elasticsearch 9 storage driver
---

# Configuration

Every key of `services.storageEngine` is handed to the driver, as it was to Kuzzle's embedded Elasticsearch code.
None is specific to this driver:

| Key                                | Default                                   | What it does                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`                           | `{ "node": "http://localhost:9200" }`     | The [Elasticsearch client options](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/basic-config.html): nodes, authentication, TLS... |
| `commonMapping`                    | `_kuzzle_info` fields, `dynamic: "false"` | The mapping merged into every collection's mapping.                                                                                                              |
| `defaultSettings`                  | 1 shard, 1 replica                        | The settings of a new collection's index, unless the request sets them.                                                                                          |
| `internalIndex`                    | `kuzzle`, with its collections            | The name, settings and mappings of Kuzzle's internal index.                                                                                                      |
| `maxScrollDuration`                | `"1m"`                                    | The longest scroll a request may ask for.                                                                                                                        |
| `defaults.onUpdateConflictRetries` | `0`                                       | How many times an update is retried on a version conflict.                                                                                                       |
| `defaults.scrollTTL`               | `"15s"`                                   | How long a paginated search's cursor lives.                                                                                                                      |
| `generateMissingAliases`           | `true`                                    | Creates the aliases of the collections that have none, at startup (data created before Kuzzle 2.14).                                                             |
| `search.additionalBodyKeys`        | `[]`                                      | Root keys a search body may use, on top of the default ones. See [Search body keys](#search-body-keys).                                                          |

The full reference, with comments, is Kuzzle's
[`.kuzzlerc.sample.jsonc`](https://github.com/kuzzleio/kuzzle/blob/master/.kuzzlerc.sample.jsonc). Each key can also
be set through an environment variable, for example `kuzzle_services__storageEngine__client__node`.

## Search body keys

A search body may only use these root keys: `aggregations`, `aggs`, `collapse`, `explain`, `fields`, `from`,
`highlight`, `min_score`, `post_filter`, `query`, `search_after`, `search_timeout`, `size`, `sort`, `suggest`,
`track_scores`, `_name`, `_source`, `_source_excludes` and `_source_includes`. Any other key is refused with
`services.storage.invalid_search_query`, before the request reaches the engine.

`search.additionalBodyKeys` adds keys to that list, for every search of the application:

```jsonc
{
  "services": {
    "storageEngine": {
      "search": {
        "additionalBodyKeys": ["indices_boost", "rescore"],
      },
    },
  },
}
```

Or, through an environment variable: `kuzzle_services__storageEngine__search__additionalBodyKeys='*json:["rescore"]'`.

- Inline scripts stay refused, under any key: only stored scripts are accepted.
- Kuzzle refuses to start if the list is not an array of non-empty strings, or if it holds a key that Kuzzle sets on
  every search request, or that exposes its internal indice names: `index`, `pit`, `profile`,
  `rest_total_hits_as_int`, `routing`, `scroll`, `track_total_hits`.
- Set the same list on every node of the cluster.
- The driver does not check that the engine knows an added key: an unknown one is answered with the engine's own error.

`min_score` and `track_scores` rely on the relevance score:

- with `lang: "koncorde"`, the score comes from the query the filters are translated to: an `and`, for
  instance, gives every document a score of 0, so any `min_score` above 0 leaves them all out;
- leave them out of `document:count`: depending on the engine, a count request refuses them.

## Authentication and TLS

`client` goes to the Elasticsearch client as it is:

```jsonc
{
  "services": {
    "storageEngine": {
      "driver": "kuzzle-storage-es-9",
      "client": {
        "node": "https://elasticsearch.example.com:9200",
        "auth": { "username": "kuzzle", "password": "<password>" },
        "tls": { "rejectUnauthorized": true },
      },
    },
  },
}
```

Keep secrets out of `.kuzzlerc`: use [Kuzzle's vault](/core/2/guides/advanced/secrets-vault) or environment variables.
