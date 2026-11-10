"""Prints the toolchain paths MPFB resolves itself, as KEY=value lines (read by setup.sh)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mpfb import mpfb_service  # noqa: E402

print(f"MPFB_DATA={mpfb_service('LocationService').get_user_data()}")
