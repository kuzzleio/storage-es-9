#!/usr/bin/env bash
#
# Drift guard. The five storage drivers (storage-es-7, -es-8, -es-9,
# -opensearch-2, -opensearch-3) share most of their code. The files listed
# below must stay identical to their canonical copy: the one in the repository
# and at the commit `scripts/drift.env` pins (CANONICAL_REPO, CANONICAL_REF).
# A file this repository deliberately keeps different is listed in ALLOW.
#
# This script is the same in every driver, and is itself a shared file.
#
# Changing a shared file: change it in the canonical repository first, then
# copy it to the siblings and move CANONICAL_REF, in every driver, to the
# commit that has it.
#
# Usage: scripts/check-drift.sh   (exit 1 on drift)

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=drift.env
. scripts/drift.env

SHARED_FILES=(
  .prettierignore
  .prettierrc
  lib/esErrorMapping.ts
  lib/helpers.ts
  lib/types.ts
  lib/vendor.d.ts
  scripts/check-drift.sh
  test/mocks/elasticsearchClient.ts
  test/mocks/kuzzle.ts
  test/unit/elasticsearchCases/crud.ts
  test/unit/elasticsearchCases/engine.ts
  test/unit/elasticsearchCases/envelope.ts
  test/unit/elasticsearchCases/harness.ts
  test/unit/elasticsearchCases/index.ts
  test/unit/elasticsearchCases/internals.ts
  test/unit/elasticsearchCases/inventory.ts
  test/unit/elasticsearchCases/lifecycle.ts
  test/unit/elasticsearchCases/lockFixture.ts
  test/unit/elasticsearchCases/multi.ts
  test/unit/elasticsearchCases/queries.ts
  test/unit/esWrapperCases.ts
  tsconfig.build.json
  tsconfig.test.json
  vitest.config.mts
)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

drift=0

for file in "${SHARED_FILES[@]}"; do
  if [[ " ${ALLOW:-} " == *" $file "* ]]; then
    echo "skip   $file (allowed to differ)"
    continue
  fi

  url="https://raw.githubusercontent.com/$CANONICAL_REPO/$CANONICAL_REF/$file"

  if ! curl -fsSL --retry 3 "$url" -o "$tmp/canonical"; then
    echo "ERROR  $file: cannot fetch $url"
    drift=1
  elif [[ ! -f "$file" ]]; then
    echo "DRIFT  $file: missing here"
    drift=1
  elif ! diff -u --label "$CANONICAL_REPO@$CANONICAL_REF:$file" --label "$file" \
    "$tmp/canonical" "$file"; then
    echo "DRIFT  $file"
    drift=1
  else
    echo "ok     $file"
  fi
done

if [[ $drift -ne 0 ]]; then
  echo
  echo "Shared files differ from $CANONICAL_REPO@$CANONICAL_REF."
  echo "Make the change in the canonical repository and copy it here, or move"
  echo "CANONICAL_REF in scripts/drift.env, or list the file in ALLOW there."
fi

exit $drift
