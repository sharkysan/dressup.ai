#!/usr/bin/env bash
# Fetches the MediaPipe models the app self-hosts (spec §4/§6). Idempotent; files are git-ignored.
# Exits 0 with a warning when the host is unreachable (e.g. sandboxed dev): analysis e2e tests then skip.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/models"
mkdir -p "$OUT"

declare -A MODELS=(
  ["face_landmarker.task"]="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
  ["selfie_multiclass_256x256.tflite"]="https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
)

status=0
for name in "${!MODELS[@]}"; do
  dest="$OUT/$name"
  if [ -s "$dest" ]; then
    echo "present: $dest"
    continue
  fi
  if curl -fsSL --retry 2 --max-time 120 -o "$dest.part" "${MODELS[$name]}"; then
    mv "$dest.part" "$dest"
    echo "fetched: $dest ($(du -h "$dest" | cut -f1))"
  else
    rm -f "$dest.part"
    echo "WARNING: could not download $name — face analysis will be unavailable locally; e2e analysis tests will skip." >&2
    status=0
  fi
done
exit $status
