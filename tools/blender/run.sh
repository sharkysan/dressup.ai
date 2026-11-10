#!/usr/bin/env bash
# Usage: tools/blender/run.sh <script.py> [-- args…]
# Runs a Python script in the project-local Blender, headless, with the toolchain env (env.sh).
# The exit code is the script's; an uncaught exception exits 1.
set -euo pipefail
. "$(dirname "$0")/env.sh"

if [ $# -lt 1 ]; then
  echo "usage: tools/blender/run.sh <script.py> [-- args…]" >&2
  exit 2
fi
if [ ! -x "$BLENDER" ]; then
  echo "Blender $BLENDER_VERSION is missing ($BLENDER) — run \`npm run blender:setup\`" >&2
  exit 1
fi

script=$1
shift
# --quiet must precede --background to drop the version banner (and "Blender quit"); errors still print.
exec "$BLENDER" --quiet --background --python-exit-code 1 --python "$script" "$@"
