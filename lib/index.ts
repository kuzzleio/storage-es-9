/*
 * Kuzzle, a backend software, self-hostable and ready to use
 * to power modern apps
 *
 * Copyright 2015-2026 Kuzzle
 * mailto: support AT kuzzle.io
 * website: http://kuzzle.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Client } from "@elastic/elasticsearch";
import type { JSONObject, StorageDriver } from "kuzzle";

import { ES9 } from "./elasticsearch";

/**
 * The Elasticsearch 9 storage driver of Kuzzle: Kuzzle's Elasticsearch 8
 * driver, on the Elasticsearch 9 client.
 */
export class ES9Driver extends ES9 implements StorageDriver {
  static createNativeClient(clientConfig: JSONObject): Client {
    return new Client(clientConfig);
  }

  init(): Promise<void> {
    return this._initSequence();
  }
}

export default ES9Driver;
