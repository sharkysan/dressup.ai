"""Smoke test of the Blender toolchain: tools/blender/run.sh tools/blender/smoke.py (npm run blender:smoke)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mpfb import require_toolchain, toolchain_versions  # noqa: E402

require_toolchain()
versions = toolchain_versions()
print(
    f"blender toolchain OK: Blender {versions['blender']}, MPFB {versions['mpfb']}, VRM {versions['vrm']}"
)
