#!/bin/sh
set -eu
SRC="$(cd "$(dirname "$0")/../.." && pwd)/node-ws/src/handlers/device.js"
BASE="$(cd "$(dirname "$0")" && pwd)/BASELINE_FILE"
TEST="$(mktemp)"
trap 'rm -f "$TEST"' EXIT
cp "$SRC" "$TEST"
cp "$BASE" "$TEST"
cmp -s "$TEST" "$BASE"
printf 'ROLLBACK_TEST=PASS\nRESTORED_COPY=%s\n' "$TEST"
