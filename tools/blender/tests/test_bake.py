"""Tests of bake.py (numpy, no bpy): npm run test:blender."""

import struct
import unittest
import zlib

import numpy as np

from bake import (
    anchored,
    classify_regions,
    darken,
    disc_weights,
    face_regions,
    head_mask,
    height_and_min,
    masked_delta,
    png_bytes,
    rasterise,
    widen,
)


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


class ClassifyRegionsTest(unittest.TestCase):
    def test_thigh_above_the_hem_is_pelvis(self):
        np.testing.assert_array_equal(
            classify_regions({"spine_02": [1, 0], "thigh_l": [0, 1]}, z=[1.2, 0.85], hem_z=0.8), [1, 2]
        )

    def test_thigh_below_the_hem_is_thighs(self):
        np.testing.assert_array_equal(
            classify_regions({"spine_02": [1, 0], "thigh_l": [0, 1]}, z=[1.2, 0.7], hem_z=0.8), [1, 5]
        )

    def test_the_dominant_group_decides_and_unlisted_groups_are_never_hidden(self):
        groups = {
            "clavicle_r": [0.6, 0, 0, 0, 0, 0],
            "neck_01": [0.4, 1, 0, 0, 0, 0],
            "ball_r": [0, 0, 1, 0, 0, 0],
            "lowerarm_l": [0, 0, 0, 0.3, 0, 0],
            "hand_l": [0, 0, 0, 0.7, 0, 0],
            "calf_r": [0, 0, 0, 0, 1, 0],
        }
        np.testing.assert_array_equal(classify_regions(groups, z=np.zeros(6), hem_z=0.8), [1, 8, 7, 0, 6, 0])


class FaceRegionsTest(unittest.TestCase):
    def test_takes_the_majority_and_breaks_ties_toward_the_lower_code(self):
        np.testing.assert_array_equal(face_regions([1, 1, 2, 0], [[0, 1, 2], [1, 2, 3]]), [1, 0])


class RasteriseTest(unittest.TestCase):
    def test_fills_the_pixels_whose_centres_are_inside_each_face(self):
        image = rasterise([[(0, 0), (1, 0), (0, 1)]], [3], 8)
        self.assertEqual(image.shape, (8, 8))
        self.assertEqual(image.dtype, np.uint8)
        self.assertEqual(image[1, 1], 3)
        self.assertEqual(image[7, 7], 0)

    def test_fills_quads_and_reads_u_as_the_column_and_v_as_the_row(self):
        image = rasterise([[(0.5, 0), (1, 0), (1, 0.25), (0.5, 0.25)]], [7], 4)
        np.testing.assert_array_equal(image, [[0, 0, 7, 7], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])


class WidenTest(unittest.TestCase):
    def test_grows_values_into_empty_pixels_without_overwriting_others(self):
        image = np.array([[5, 0, 0, 0, 6]], dtype=np.uint8)
        np.testing.assert_array_equal(widen(image, 1), [[5, 5, 0, 6, 6]])
        np.testing.assert_array_equal(image, [[5, 0, 0, 0, 6]])

    def test_grows_diagonally(self):
        image = np.zeros((3, 3), dtype=np.uint8)
        image[1, 1] = 2
        np.testing.assert_array_equal(widen(image, 1), np.full((3, 3), 2))


class PngBytesTest(unittest.TestCase):
    def test_encodes_8_bit_rgb_and_rgba_rows_unfiltered(self):
        for channels, colour_type in ((3, 2), (4, 6)):
            pixels = np.arange(2 * 3 * channels, dtype=np.uint8).reshape(2, 3, channels)
            png = png_bytes(pixels)
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">IIBBBBB", png[16:29]), (3, 2, 8, colour_type, 0, 0, 0))
            idat = png.index(b"IDAT")
            (length,) = struct.unpack(">I", png[idat - 4 : idat])
            rows = zlib.decompress(png[idat + 4 : idat + 4 + length])
            self.assertEqual(rows, b"".join(b"\x00" + row.tobytes() for row in pixels))
            self.assertTrue(png.endswith(b"IEND\xaeB`\x82"))


class DiscWeightsTest(unittest.TestCase):
    def test_is_one_inside_the_radius_and_fades_to_zero_over_the_feather(self):
        weights = disc_weights(10, [(0.05, 0.05)], radius=0.2, feather=0.2)
        self.assertEqual(weights[0, 0], 1)
        self.assertAlmostEqual(weights[0, 3], 0.5)
        self.assertEqual(weights[0, 5], 0)


class DarkenTest(unittest.TestCase):
    def test_scales_rgb_by_the_weighted_value_and_keeps_alpha(self):
        rgba = np.array([[[200, 100, 50, 255], [200, 100, 50, 0], [200, 100, 50, 128]]], dtype=np.uint8)
        out = darken(rgba, np.array([[1, 0, 0.5]]), value=0.5)
        np.testing.assert_array_equal(out, [[[100, 50, 25, 255], [200, 100, 50, 0], [150, 75, 38, 128]]])
