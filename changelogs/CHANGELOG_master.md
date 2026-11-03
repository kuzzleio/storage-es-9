## [1.1.0](https://github.com/kuzzleio/storage-es-9/compare/v1.0.0...v1.1.0) (2026-11-03)

### Dependencies

* **deps:** drop bluebird ([596451c](https://github.com/kuzzleio/storage-es-9/commit/596451cd3316026f1ec3091137b1a4f1f6e1244b))

### Features

* close the engine client on Kuzzle's shutdown ([2769f91](https://github.com/kuzzleio/storage-es-9/commit/2769f91e659b3d3797ee3bdace448b52f158a797)), closes [kuzzleio/kuzzle#3141](https://github.com/kuzzleio/kuzzle/issues/3141)

### Bug Fixes

* keep lodash types out of the shipped declarations ([98dfc91](https://github.com/kuzzleio/storage-es-9/commit/98dfc9121e4c649a0b77a5ad09cdbd1f03824469))
* map the engines' actual error messages to storage errors ([5a40f40](https://github.com/kuzzleio/storage-es-9/commit/5a40f4079294dc253492b9d582e67d505131763d))
* refuse an Elasticsearch 10 cluster and an OpenSearch one ([ee903ea](https://github.com/kuzzleio/storage-es-9/commit/ee903ea1551bec8f5758b64950061fdcc4168586))
* send index settings as settings, not body ([23976f1](https://github.com/kuzzleio/storage-es-9/commit/23976f1997e20396a41535218f19ff8e32843f3f))

## 1.0.0 (2026-10-31)

### Dependencies

* **deps:** build against kuzzle 2.61.0-beta.1 ([d608b7c](https://github.com/kuzzleio/storage-es-9/commit/d608b7ce61a605595bb16cce4e1ba38f10065caf))

### Features

* Elasticsearch 9 storage driver for Kuzzle ([62062c6](https://github.com/kuzzleio/storage-es-9/commit/62062c67298a7b57684353040151d503e8719324))

### Bug Fixes

* publish as kuzzle-storage-es-9, unscoped like kuzzle ([173625d](https://github.com/kuzzleio/storage-es-9/commit/173625d47a94e43a0de0b52c7b7c9e53956944c7))
