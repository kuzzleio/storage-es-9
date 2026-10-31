---
code: false
type: page
title: Troubleshooting
order: 500
description: Diagnose the Elasticsearch 9 storage driver
---

# Troubleshooting

## Kuzzle does not start

| Error                                                                               | Cause                                                                         | Fix                                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [services.storage_driver.not_found](/core/2/api/errors/error-codes/services)        | `driver` names a package Kuzzle cannot find from the application's directory. | Install `kuzzle-storage-es-9` in the application that starts Kuzzle, and check the spelling. |
| [services.storage_driver.version_mismatch](/core/2/api/errors/error-codes/services) | This Kuzzle version is out of the driver's `kuzzleVersion` range.             | Upgrade Kuzzle, or install a driver version that supports yours.                             |
| [services.storage_driver.invalid_manifest](/core/2/api/errors/error-codes/services) | The package's `manifest.json` is missing or broken.                           | Reinstall the package.                                                                       |
| [services.storage.version_mismatch](/core/2/api/errors/error-codes/services)        | The Elasticsearch cluster is older than 9.0.0.                                | Point `client.node` at an Elasticsearch 9 cluster, or use the Elasticsearch 8 driver.        |
| [cluster.join.storage_driver_mismatch](/core/2/api/errors/error-codes/cluster)      | Another node of the cluster runs another driver, or another version of it.    | Deploy the same `package-lock.json` on every node.                                           |

## Kuzzle cannot reach Elasticsearch

Kuzzle waits for the cluster at startup, and gives up after `services.storageEngine.initTimeout` (or
`services.common.defaultInitTimeout`, 2 minutes by default). Check `client.node` from the machine running Kuzzle
(`curl <node>/_cluster/health`), and the authentication and TLS options of `client`. Once started, a request reaching
a disconnected cluster gets a [services.storage.not_connected](/core/2/api/errors/error-codes/services) error.

## Errors returned by the API

The driver turns Elasticsearch errors into Kuzzle's [storage errors](/core/2/api/errors/error-codes/services)
(`services.storage.*`): a client gets the same error whatever the engine. To see the Elasticsearch error behind one,
start Kuzzle with `DEBUG=kuzzle:services:storage:es9`.
