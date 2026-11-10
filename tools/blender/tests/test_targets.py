"""Tests of targets.py (pure Python): npm run test:blender."""

import os
import unittest
from pathlib import Path

from targets import EXPRESSION_RECIPES, mix, parse_target, to_blender


class ParseTargetTest(unittest.TestCase):
    def test_reads_index_and_delta_skipping_comments_and_blank_lines(self):
        self.assertEqual(
            parse_target("# c\n12 0.1 0.2 0.3\n\n7 -1 0 0\n"),
            {12: (0.1, 0.2, 0.3), 7: (-1.0, 0.0, 0.0)},
        )


class ToBlenderTest(unittest.TestCase):
    def test_swaps_makehuman_y_up_to_blender_z_up_and_scales(self):
        for got, want in zip(to_blender((1, 2, 3), 0.1), (0.1, -0.3, 0.2), strict=True):
            self.assertAlmostEqual(got, want, delta=1e-9)


class MixTest(unittest.TestCase):
    def test_weighted_sum_of_the_named_units(self):
        targets = {"a": {1: (1, 0, 0)}, "b": {1: (0, 2, 0), 2: (0, 0, 1)}}
        self.assertEqual(mix(targets, {"a": 0.5, "b": 0.5}), {1: (0.5, 1, 0), 2: (0, 0, 0.5)})


class ExpressionRecipesTest(unittest.TestCase):
    def test_every_unit_is_in_faceunits01(self):
        units = Path(os.environ["FACEUNITS_DIR"])
        for expression, recipe in EXPRESSION_RECIPES.items():
            for unit in recipe:
                with self.subTest(expression=expression, unit=unit):
                    self.assertTrue((units / f"{unit}.target").is_file(), f"no {unit}.target in {units}")
