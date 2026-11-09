#!/usr/bin/env bash
# Fetches the MediaPipe models the app self-hosts (spec §4/§6). Idempotent; files are git-ignored.
# Exits 0 with a warning when the host is unreachable (e.g. sandboxed dev): analysis e2e tests then skip.
# Written for bash 3.2 (macOS /bin/bash): no associative arrays.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/models"
mkdir -p "$OUT"

BASE="https://storage.googleapis.com/mediapipe-models"

fetch_one() {
  name=$1
  url=$2
  dest="$OUT/$name"
  if [ -s "$dest" ]; then
    echo "present: $dest"
    return 0
  fi
  if curl -fsSL --retry 2 --max-time 120 -o "$dest.part" "$url"; then
    mv "$dest.part" "$dest"
    echo "fetched: $dest ($(du -h "$dest" | cut -f1))"
  else
    rm -f "$dest.part"
    echo "WARNING: could not download $name — face analysis will be unavailable locally; e2e analysis tests will skip." >&2
  fi
  return 0
}

fetch_one "face_landmarker.task" \
  "$BASE/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
fetch_one "selfie_multiclass_256x256.tflite" \
  "$BASE/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
exit 0
