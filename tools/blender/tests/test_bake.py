"""Tests of bake.py (numpy, no bpy): npm run test:blender."""

import unittest

import numpy as np

from bake import anchored, head_mask, height_and_min, masked_delta


class HeadMaskTest(unittest.TestCase):
    def test_is_one_minus_the_head_weight_clipped_to_0_1(self):
        np.testing.assert_array_equal(head_mask(np.array([0, 0.5, 1, 1.2])), [1, 0.5, 0, 0])


class MaskedDeltaTest(unittest.TestCase):
    def test_scales_each_vertex_offset_by_its_mask(self):
        np.testing.assert_array_equal(
            masked_delta(np.ones((2, 3)), np.zeros((2, 3)), np.array([1, 0])), [[1, 1, 1], [0, 0, 0]]
        )


class AnchoredTest(unittest.TestCase):
    def test_translates_the_variant_so_its_anchor_vertices_sit_on_the_bases_on_average(self):
        base = np.array([[0, 0, 0], [1, 0, 0], [0, 0, 1.0]])
        variant = base + [0, 0, 0.2] + [[0, 0, 0], [0, 0, 0], [0.5, 0, 0]]
        np.testing.assert_allclose(
            anchored(variant, base, np.array([True, True, False])), base + [[0, 0, 0], [0, 0, 0], [0.5, 0, 0]]
        )


class HeightAndMinTest(unittest.TestCase):
    def test_is_the_z_extent_and_the_lowest_z(self):
        height, lowest = height_and_min(np.array([[0, 0, -0.1], [0, 0, 1.6]]))
        self.assertAlmostEqual(height, 1.7, delta=1e-12)
        self.assertAlmostEqual(lowest, -0.1, delta=1e-12)
