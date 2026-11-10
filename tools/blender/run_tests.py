"""Runs the Blender-side Python tests, tools/blender/tests/test_*.py, in Blender's Python.

    tools/blender/run.sh tools/blender/run_tests.py    (npm run test:blender)

Exits 0 if every test passes, 1 otherwise. Modules under tools/blender import as top-level modules.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# unittest.main() would parse Blender's own argv, so discover and run directly.
suite = unittest.defaultTestLoader.discover(os.path.join(HERE, "tests"), pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
