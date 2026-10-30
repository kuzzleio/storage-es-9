# kuzzle-storage-es-9

The Elasticsearch 9 storage driver for [Kuzzle](https://github.com/kuzzleio/kuzzle) 2.

Kuzzle 2 ships its Elasticsearch 7 and 8 drivers. Elasticsearch 9 runs through this package, installed next to Kuzzle
([ADR-0003](https://github.com/kuzzleio/kuzzle/blob/2-dev/docs/adr-003/ADR-0003-storage-drivers.md)). It is Kuzzle's
Elasticsearch 8 driver on the Elasticsearch 9 client: same mappings, same queries, same errors.

## Install

```bash
npm install kuzzle-storage-es-9
```

Then select it in your `.kuzzlerc`, with the address of your Elasticsearch 9 cluster:

```jsonc
{
  "services": {
    "storageEngine": {
      "driver": "kuzzle-storage-es-9",
      "client": { "node": "http://localhost:9200" }
    }
  }
}
```

The rest of `services.storageEngine` works as with the built-in drivers; `majorVersion` is not read. Every node of a
cluster must run the same driver.

Requires Kuzzle 2.61 or later, and Elasticsearch 9.

## Capabilities

The driver declares every optional capability (`aggregations`, `mappingUpdates`, `stats`, `updateByQuery`): every
Kuzzle API action works as with Elasticsearch 8.

## Development

```bash
docker run -d -p 9200:9200 -e discovery.type=single-node -e xpack.security.enabled=false elasticsearch:9.5.5
npm ci
npm test   # Kuzzle's conformance kit, against ELASTICSEARCH_NODE (default http://localhost:9200)
```

## License

[Apache-2.0](LICENSE.md)
