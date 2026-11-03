/*
 * Kuzzle, a backend software, self-hostable and ready to use
 * to power modern apps
 *
 * Copyright 2015-2022 Kuzzle
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

/* eslint sort-keys: 0 */

/*
 * The engine error messages the drivers turn into a named `services.storage`
 * error. This file is the same in every storage driver (Elasticsearch 7, 8, 9,
 * OpenSearch 2, 3): the drift guard (`scripts/check-drift.sh`) keeps it so.
 *
 * Each entry is matched against the `reason` the engine answered
 * (`meta.body.error.reason`), or the client error's message when there is
 * none. Two forms are matched:
 *
 * - the engines' own messages, cited below by source file and line, for
 *   OpenSearch 2.19.0 / 3.0.0 and Elasticsearch 7.17.29 / 8.19.0 / 9.1.0;
 * - the legacy `[type] reason` form a former Elasticsearch client built, kept
 *   as it was: the `[type] ` prefix is optional wherever it was required.
 *
 * A message no entry matches is not lost: it falls through to the status-code
 * handlers of `ESWrapper`, which keep it.
 */

import get from "lodash/get";
import type { JSONObject } from "kuzzle";

/**
 * What the engine client throws: an Error, carrying the server's response on
 * `meta` for the ones that came back from the cluster. `catch` hands callers
 * `unknown`, and this is the shape every reader assumes.
 */
export type ThrownESError = Error & { meta?: JSONObject; body?: JSONObject };

export interface ESErrorMapping {
  regex: RegExp;
  /**
   * The `services.storage` error this engine message maps to.
   *
   * Required, and spelled one way. One entry declared `subCode` while the
   * reader has always asked for `subcode`, so the rejected-execution mapping
   * answered `undefined` and `storageError.get` fell through to
   * `core.fatal.unexpected_error` — `too_many_operations` was unreachable.
   */
  subcode: string;
  getPlaceholders: (
    esError: ThrownESError,
    matches: RegExpMatchArray,
  ) => Array<string | undefined>;
}

export const errorMessagesMapping: ESErrorMapping[] = [
  {
    /*
     * A full thread pool. The exception is `EsRejectedExecutionException`
     * (type `es_rejected_execution_exception`) on Elasticsearch, and
     * `OpenSearchRejectedExecutionException` on OpenSearch, whose type drops
     * the `OpenSearch` prefix: `rejected_execution_exception`
     * (OpenSearchException.java:725-731 on 2.19.0). Its message is the
     * same on both, "rejected execution of <task> on <executor>"
     * (OpenSearchAbortPolicy.java:67 on OpenSearch 2.19.0 and 3.0.0,
     * EsRejectedExecutionHandler.java:32 on ES 7.17.29, :48 on 8.19.0 and
     * 9.1.0), and the executor prints itself as
     * "<class>[name = <node>/<pool>, ..." (OpenSearchThreadPoolExecutor.java:173-188,
     * EsThreadPoolExecutor.java:148-163 on ES 7.17.29, :144-157 on 8.19.0 and
     * 9.1.0). The class is `EsThreadPoolExecutor` or `OpenSearchThreadPoolExecutor`,
     * or a subclass of either (`QueueResizingOpenSearchThreadPoolExecutor`,
     * `TaskExecutionTimeTrackingEsThreadPoolExecutor`...).
     *
     * rejected execution of org.opensearch.common.util.concurrent.TimedRunnable@3a1b2c on OpenSearchThreadPoolExecutor[name = node-1/write, queue capacity = 10000, ...]
     *
     * The placeholder is the pool, without the node name: "write". Elasticsearch
     * 5 printed the pool alone, "EsThreadPoolExecutor[bulk, ...": still read.
     */
    regex:
      /^(?:\[(?:es_)?rejected_execution_exception\] )?rejected execution of .*? on \w*(?:Es|OpenSearch)ThreadPoolExecutor\[(?:name = )?(?:[^,\]/]*\/)?([^,\]]+)/,
    subcode: "too_many_operations",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * Indexing pressure: the same exception, thrown when the bytes being
     * indexed exceed the node's limit, without an executor
     * (IndexingPressure.java:108/152/187 and ShardIndexingPressure.java:348 on
     * OpenSearch 2.19.0 and 3.0.0, IndexingPressure.java:77/121/156 on ES
     * 7.17.29).
     *
     * rejected execution of coordinating operation [coordinating_and_primary_bytes=0, replica_bytes=0, ...]
     *
     * The placeholder is the stage: "coordinating", "primary" or "replica".
     */
    regex:
      /^(?:\[(?:es_)?rejected_execution_exception\] )?rejected execution of (\w+) operation \[/,
    subcode: "too_many_operations",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // [illegal_argument_exception] object mapping [titi] can't be changed from nested to non-nested
    regex:
      /^\[illegal_argument_exception] object mapping \[(.*?)] can't be changed from nested to non-nested$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // [illegal_argument_exception] object mapping [baz] can't be changed from non-nested to nested
    regex:
      /^\[illegal_argument_exception] object mapping \[(.*?)] can't be changed from non-nested to nested$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * can't merge a nested mapping [baz] with a non-nested mapping (ES 7.17.29 ObjectMapper.java:341)
     * can't merge a non-nested mapping [baz] with a nested mapping (ES 8.19.0 and 9.1.0 MapperErrors.java:18)
     *
     * OpenSearch says "cannot change object mapping from nested to
     * non-nested" (ObjectMapper.java:130/134 on 2.19.0 and 3.0.0), naming no
     * field: it is left to the 400 handler, which keeps that reason.
     */
    regex:
      /^can't merge a (?:non-)?nested mapping \[(.*?)] with a (?:non-)?nested mapping$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * can't merge a non object mapping [aeaze] with an object mapping
     * (OpenSearch 2.19.0 and 3.0.0 ObjectMapper.java:776/812, ES 7.17.29
     * ObjectMapper.java:337/376, ES 8.19.0 and 9.1.0 MapperErrors.java:14)
     * [illegal_argument_exception] Can't merge a non object mapping [aeaze] with an object mapping [aeaze]
     */
    regex:
      /^(?:\[illegal_argument_exception] )?[Cc]an't merge a non object mapping \[(.*?)] with an object mapping(?: \[.*?])?$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // [illegal_argument_exception] [tutu.tutu] is defined as an object in mapping [aze] but this name is already used for a field in other types
    regex:
      /^\[illegal_argument_exception] \[(.*?)] is defined as an object in mapping \[(.*?)] but this name is already used for a field in other types$/,
    subcode: "duplicate_field_mapping",
    getPlaceholders: (esError, matches) => [matches[1], matches[2]],
  },
  {
    // [illegal_argument_exception] mapper [source.flags] of different type, current_type [string], merged_type [long]
    regex:
      /^mapper \[(.*?)] of different type, current_type \[(.*?)], merged_type \[(.*?)]$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * mapper [age] cannot be changed from type [long] to [text]
     * (OpenSearch 2.19.0 and 3.0.0 ParametrizedFieldMapper.java:114/119,
     * FieldMapper.java:395; ES 7.17.29 FieldMapper.java:421/426, ES 8.19.0
     * FieldMapper.java:415/420, ES 9.1.0 FieldMapper.java:414/419)
     */
    regex: /^mapper \[(.*?)] cannot be changed from type \[(.*?)] to \[(.*?)]$/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * Mapper for [name] conflicts with existing mapper:
     * 	Cannot update parameter [analyzer] from [standard] to [english]
     * (OpenSearch 2.19.0 and 3.0.0 ParametrizedFieldMapper.java:580, ES
     * 7.17.29 FieldMapper.java:1174, 8.19.0 :1368, 9.1.0 :1371)
     */
    regex: /^Mapper for \[(.*?)] conflicts with existing mapper:/,
    subcode: "cannot_change_mapping",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * Mapping definition for [flags] has unsupported parameters:  [index : not_analyzed]
     *
     * Two spaces: the message ends with a space and every parameter is
     * appended as " [key : value]" (DocumentMapperParser.java:185/198 on
     * OpenSearch 2.19.0, :182 on 3.0.0, MappingParser.java:61 on ES 7.17.29). Prefixed with
     * "Failed to parse mapping [_doc]: " when the mapping is a new index's
     * (OpenSearch MapperService.java:439 on 2.19.0, :443 on 3.0.0, ES 7.17.29
     * MapperService.java:401).
     */
    regex:
      /^(?:\[mapper_parsing_exception] )?(?:Failed to parse mapping \[[^\]]*]: )?Mapping definition for \[(.*?)] has unsupported parameters: +\[(.*)]$/,
    subcode: "unexpected_properties",
    getPlaceholders: (esError, matches) => [matches[2], matches[1]],
  },
  {
    /*
     * unknown parameter [foo] on mapper [flags] of type [keyword]
     * (OpenSearch 2.19.0 and 3.0.0 ParametrizedFieldMapper.java:716, ES
     * 7.17.29 FieldMapper.java:1333, 8.19.0 :1570, 9.1.0 :1573)
     */
    regex:
      /^(?:Failed to parse mapping \[[^\]]*]: )?unknown parameter \[(.*?)] on mapper \[(.*?)] of type \[(.*?)]$/,
    subcode: "unexpected_properties",
    getPlaceholders: (esError, matches) => [matches[1], matches[2]],
  },
  {
    /*
     * No handler for type [boolean] declared on field [not]
     * (OpenSearch 2.19.0 and 3.0.0 ObjectMapper.java:503/581, lowercase "no"
     * in TypeParsers.java:261 for a multi-field; ES 7.17.29
     * ObjectMapper.java:205)
     */
    regex:
      /^(?:\[mapper_parsing_exception] )?(?:Failed to parse mapping \[[^\]]*]: )?[Nn]o handler for type \[(.*?)] declared on field \[(.*?)]$/,
    subcode: "invalid_mapping_type",
    getPlaceholders: (esError, matches) => [matches[2], matches[1]],
  },
  {
    /*
     * The mapper type [boolean] declared on field [not] does not exist. It might have been created within a future version or requires a plugin to be installed. Check the documentation.
     * (ES 8.19.0 ObjectMapper.java:405, 9.1.0 :402)
     */
    regex:
      /^The mapper type \[(.*?)] declared on field \[(.*?)] does not exist\./,
    subcode: "invalid_mapping_type",
    getPlaceholders: (esError, matches) => [matches[2], matches[1]],
  },
  {
    // [mapper_parsing_exception] failed to parse [conditions.host.flags]
    regex: /^\[mapper_parsing_exception] failed to parse \[(.*?)]$/,
    subcode: "wrong_mapping_property",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // Failed to parse mapping [_doc]: Expected map for property [fields] on field [enabled] but got a class java.lang.String
    regex:
      /^Failed to parse mapping \[.*\]: Expected \w+ for property \[(.*)\] on field \[(.*)\]/,
    subcode: "wrong_mapping_property",
    getPlaceholders: (esError, matches) => [`${matches[2]}.${matches[1]}`],
  },
  {
    // [index_not_found_exception] no such index, with { resource.type=index_or_alias & resource.id=foso & index=foso }
    regex: /^no such index \[([%&])([^\]]*)\.([^.\]]*)\]$/,
    subcode: "unknown_collection",
    getPlaceholders: (esError, matches) => [matches[2], matches[3]],
  },
  {
    /*
     * Expected map for property [fields] on field [foo] but got a class java.lang.String
     * (OpenSearch 2.19.0 and 3.0.0 ObjectMapper.java:525/603, ES 7.17.29
     * ObjectMapper.java:223, 8.19.0 :439, 9.1.0 :436)
     */
    regex:
      /^(?:\[mapper_parsing_exception] )?Expected map for property \[(.*?)] on field \[(.*?)] but got a class java\.lang\.String$/,
    subcode: "wrong_mapping_property",
    getPlaceholders: (esError, matches) => [`${matches[2]}.${matches[1]}`],
  },
  {
    regex:
      /^\[version_conflict_engine_exception] \[data]\[(.*?)]: version conflict.*$/,
    subcode: "too_many_changes",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    //[liia]: version conflict, document already exists (current version [2])
    regex: /^\[(.*)\]: version conflict, document already exists.*/,
    subcode: "document_already_exists",
    getPlaceholders: () => [],
  },
  {
    /*
     * [AVrbg0eg90VMe4Z_dG8j]: version conflict, required seqNo [3], primary term [1]. current document has seqNo [4] and primary term [1]
     * (OpenSearch 2.19.0 and 3.0.0 VersionConflictEngineException.java:75,
     * ES 7.17.29 :46, ES 8.19.0 and 9.1.0 :29/42)
     *
     * After `document_already_exists`, which is the same message for a
     * document created twice.
     */
    regex: /^\[([^\]]*)]: version conflict, /,
    subcode: "too_many_changes",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // Unknown key for a START_OBJECT in [term].
    regex: /^Unknown key for a START_OBJECT in \[(.*)\].*/,
    subcode: "invalid_search_query",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * mapping set to strict, dynamic introduction of [lehuong] within [_doc] is not allowed
     *
     * Elasticsearch 8 and 9 prefix it with the position in the document,
     * "[1:15] " (DocumentParsingException.java:44 on 8.19.0 and 9.1.0).
     * OpenSearch names the policy, which can also be
     * `strict_allow_templates` (StrictDynamicMappingException.java:47 and
     * ObjectMapper.java:314 on 2.19.0).
     */
    regex:
      /^(?:\[[^\]]*\] )?mapping set to strict(?:_allow_templates)?, dynamic introduction of \[(.+)\] within \[.*\] is not allowed/,
    subcode: "strict_mapping_rejection",
    getPlaceholders: (esError, matches) => {
      // "/%26index.collection/_doc"
      const esPath: string = get(esError, "meta.meta.request.params.path", "");
      // keep only "index"
      const index = esPath.split(".")[0]?.split("%26")[1];
      // keep only "collection"
      const collection = esPath.substr(esPath.indexOf(".") + 1).split("/")[0];

      return [matches[1], index, collection];
    },
  },
  {
    // [and] query malformed, no start_object after query name
    regex: /^\[(.*)\] query malformed, no start_object after query name/,
    subcode: "unknown_query_keyword",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    // no [query] registered for [equals]
    regex: /^no \[query\] registered for \[(.*)\]/,
    subcode: "unknown_query_keyword",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
  {
    /*
     * unknown query [equals] did you mean [term]?
     * (OpenSearch AbstractQueryBuilder.java:334 on 2.19.0, :358 on 3.0.0; ES
     * 7.17.29 :311, 8.19.0 and 9.1.0 :450)
     */
    regex: /^unknown query \[(.*?)]/,
    subcode: "unknown_query_keyword",
    getPlaceholders: (esError, matches) => [matches[1]],
  },
];
