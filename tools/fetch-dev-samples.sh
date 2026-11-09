#!/usr/bin/env bash
# Fetches the development sample VRMs (VRM Public License 1.0, dev only — see assets/LICENSES.md)
# into the assets/source layout. Idempotent; files are git-ignored.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/assets/source/base-a/neutral.vrm"
HAIR_TWIST="$ROOT/assets/source/hair/hair_twist_01/source.vrm"
HAIR_SEED="$ROOT/assets/source/hair/hair_seed_01/source.vrm"

is_glb() { [ -s "$1" ] && [ "$(head -c 4 "$1")" = "glTF" ]; }

if is_glb "$BASE" && is_glb "$HAIR_TWIST" && is_glb "$HAIR_SEED"; then
  echo "dev samples already present"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/vrm-c/vrm-specification "$TMP/spec"
git -C "$TMP/spec" sparse-checkout set --no-cone samples/VRM1_Constraint_Twist_Sample/vrm samples/Seed-san/vrm > /dev/null

mkdir -p "$(dirname "$BASE")" "$(dirname "$HAIR_TWIST")" "$(dirname "$HAIR_SEED")"
cp "$TMP/spec/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm" "$BASE"
cp "$BASE" "$HAIR_TWIST"
cp "$TMP/spec/samples/Seed-san/vrm/Seed-san.vrm" "$HAIR_SEED"
for f in "$BASE" "$HAIR_TWIST" "$HAIR_SEED"; do is_glb "$f" || { echo "bad download: $f" >&2; exit 1; }; done
echo "fetched dev samples into assets/source/"
