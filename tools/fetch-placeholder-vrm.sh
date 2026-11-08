#!/usr/bin/env bash
# Fetches the development placeholder avatar (spec §7: real bases come from VRoid Studio in M1).
# Source: vrm-c/vrm-specification samples/VRM1_Constraint_Twist_Sample — VRM Public License 1.0, (c) 2022 pixiv Inc.
# The file is git-ignored; run this after cloning (also run by CI).
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/public/assets/avatars/base-a.vrm"
if [ -s "$DEST" ] && [ "$(head -c 4 "$DEST")" = "glTF" ]; then
  echo "placeholder already present: $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/vrm-c/vrm-specification "$TMP/spec"
git -C "$TMP/spec" sparse-checkout set --no-cone samples/VRM1_Constraint_Twist_Sample/vrm > /dev/null
mkdir -p "$(dirname "$DEST")"
cp "$TMP/spec/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm" "$DEST"
[ "$(head -c 4 "$DEST")" = "glTF" ] || { echo "downloaded file is not glTF" >&2; exit 1; }
echo "fetched placeholder: $DEST ($(du -h "$DEST" | cut -f1))"
