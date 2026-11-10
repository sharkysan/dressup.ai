"""Tests of bake.py (numpy, no bpy): npm run test:blender."""

import struct
import unittest
import zlib

import numpy as np

from bake import (
    SHORTS,
    UNDERSHIRT,
    anchored,
    base_layer,
    classify_regions,
    darken,
    disc_weights,
    face_regions,
    garments,
    head_mask,
    height_and_min,
    interpolate,
    masked_delta,
    png_bytes,
    rasterise,
    smooth_patch,
    widen,
    widen_into,
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


class SmoothPatchTest(unittest.TestCase):
    def setUp(self):
        # A 7 x 7 grid on the paraboloid z = 0.05 (x² + y²), 4-neighbour edges, its middle 3 x 3 free.
        self.xy = np.array([(x, y) for y in range(-3, 4) for x in range(-3, 4)], dtype=np.float64)
        self.surface = np.column_stack([self.xy, 0.05 * (self.xy**2).sum(axis=1)])
        self.edges = np.array([(i, i + 1) for i in range(49) if i % 7 < 6] + [(i, i + 7) for i in range(42)])
        self.free = (np.abs(self.xy) <= 1).all(axis=1)

    def test_moves_a_bump_onto_the_curve_of_the_surface_around_it(self):
        bumpy = self.surface.copy()
        bumpy[24, 2] += 0.4  # the middle sticks out, and a neighbour a little
        bumpy[25, 2] += 0.1
        smooth = smooth_patch(bumpy, self.edges, self.free)
        np.testing.assert_allclose(smooth, self.surface, atol=1e-12)
        self.assertAlmostEqual(bumpy[24, 2], 0.4)

    def test_moves_only_the_free_vertices_and_only_along_the_normal(self):
        bumpy = self.surface + np.where(self.free, 0.3, -0.2)[:, np.newaxis] * [0, 0, 1]
        smooth = smooth_patch(bumpy, self.edges, self.free, rings=1)
        np.testing.assert_array_equal(smooth[~self.free], bumpy[~self.free])
        np.testing.assert_allclose(smooth[self.free, :2], bumpy[self.free, :2], atol=1e-12)


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


class InterpolateTest(unittest.TestCase):
    # Image-space UVs of a triangle that no row, column or diagonal of the pixel grid lines up with.
    TRIANGLE = np.array([(0.1, 0.05), (0.95, 0.3), (0.3, 0.9)])

    def test_blends_the_corner_values_barycentrically_and_a_threshold_cuts_along_a_straight_line(self):
        size = 32
        values, covered = interpolate([self.TRIANGLE], [np.array([[0.0], [0.0], [1.0]])], size)
        self.assertEqual(values.shape, (size, size, 1))
        self.assertEqual(values.dtype, np.float32)
        a, b, c = self.TRIANGLE * size
        # Pixels near the third corner take ~1, near the first ~0.
        self.assertGreater(values[int(c[1]) - 1, int(c[0]), 0], 0.9)
        self.assertLess(values[int(a[1]) + 1, int(a[0]) + 2, 0], 0.1)
        # At 0.5 the face splits along the line through the midpoints of its two edges at the third
        # corner, pixel for pixel: not a face-wide step.
        rows, columns = np.nonzero(covered)
        centres = np.column_stack([columns, rows]) + 0.5
        m, n = (a + c) / 2, (b + c) / 2

        def side(points):
            return np.sign((n[0] - m[0]) * (points[..., 1] - m[1]) - (n[1] - m[1]) * (points[..., 0] - m[0]))

        on_c_side = side(centres) == side(c)
        np.testing.assert_array_equal(values[rows, columns, 0] >= 0.5, on_c_side)
        self.assertTrue(on_c_side.any() and not on_c_side.all())

    def test_renders_a_band_of_rows_and_only_marks_pixels_inside_a_face(self):
        values, covered = interpolate([self.TRIANGLE], [np.array([[0.0], [0.0], [1.0]])], 32)
        band, band_covered = interpolate([self.TRIANGLE], [np.array([[0.0], [0.0], [1.0]])], 32, rows=(8, 20))
        np.testing.assert_array_equal(band, values[8:20])
        np.testing.assert_array_equal(band_covered, covered[8:20])
        self.assertFalse(covered[0, 31] or covered[31, 0])
        np.testing.assert_array_equal(values[~covered], 0)


# Planes for the garment tests: hem 0.5, waist 1, neck 2 (metres).
PLANES = {"hem_z": 0.5, "waist_z": 1.0, "neck_z": 2.0}
COLOURS = {UNDERSHIRT: (0xE9, 0xE6, 0xE1), SHORTS: (0x2F, 0x2F, 0x33)}


def square(z_top, z_bottom, torso=0.0, pelvis=0.0, thigh=0.0, neck=0.0):
    """One quad over the whole image with (z, torso, pelvis, thigh, neck) per corner: z is z_top along the
    top edge and z_bottom along the bottom one."""
    corners = np.array([(0, 0), (1, 0), (1, 1), (0, 1)], dtype=np.float64)
    values = np.array([[z, torso, pelvis, thigh, neck] for z in (z_top, z_top, z_bottom, z_bottom)])
    return [corners], [values]


class GarmentsTest(unittest.TestCase):
    def test_thigh_at_or_above_the_hem_is_shorts_and_below_it_is_not(self):
        z = np.array([0.6, 0.5, 0.4, 0.6])
        thigh = np.array([1.0, 0.5, 1.0, 0.4])
        np.testing.assert_array_equal(
            garments(z, np.zeros(4), np.zeros(4), thigh, np.zeros(4), **PLANES), [SHORTS, SHORTS, 0, 0]
        )

    def test_the_waist_plane_splits_the_trunk_so_nothing_shows_between_undershirt_and_shorts(self):
        # Just below the waist the torso still dominates; the shorts take it, not the skin.
        z = np.array([0.99, 1.0, 1.5, 0.3, 2.1])
        torso = np.array([0.6, 0.6, 1.0, 0.0, 1.0])
        pelvis = np.array([0.4, 0.0, 0.0, 0.9, 0.0])
        np.testing.assert_array_equal(
            garments(z, torso, pelvis, np.zeros(5), np.zeros(5), **PLANES),
            [SHORTS, UNDERSHIRT, UNDERSHIRT, SHORTS, 0],
        )

    def test_neck_below_the_neckline_is_undershirt_so_the_plane_draws_the_neckline(self):
        # Where the torso shades into the neck, its weights don't decide the neckline: the plane does.
        z = np.array([1.9, 2.0, 2.1, 2.1])
        torso = np.array([0.3, 0.2, 0.3, 0.6])
        neck = np.array([0.7, 0.8, 0.7, 0.4])
        np.testing.assert_array_equal(
            garments(z, torso, np.zeros(4), np.zeros(4), neck, **PLANES), [UNDERSHIRT, UNDERSHIRT, 0, 0]
        )


class BaseLayerTest(unittest.TestCase):
    def test_paints_thighs_above_the_hem_with_the_shorts_and_leaves_them_bare_below(self):
        # z falls from 0.9 (top) to 0.1 (bottom): the hem (0.5) crosses the image's middle.
        uvs, values = square(0.9, 0.1, thigh=1.0)
        rgba, covered = base_layer(uvs, values, 8, PLANES, COLOURS)
        self.assertEqual(rgba.dtype, np.uint8)
        self.assertTrue(covered.all())
        np.testing.assert_array_equal(rgba[:3], np.broadcast_to([0x2F, 0x2F, 0x33, 255], (3, 8, 4)))
        np.testing.assert_array_equal(rgba[5:, :, 3], 0)

    def test_antialiases_a_boundary_through_a_texel_with_partial_alpha(self):
        # The hem (z = 0.5) crosses row 2 of 4 at its middle, v = 0.625.
        uvs, values = square(0.9, 0.26, thigh=1.0)
        rgba, _ = base_layer(uvs, values, 4, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[:2, :, 3], 255)
        self.assertTrue(((rgba[2, :, 3] > 0) & (rgba[2, :, 3] < 255)).all(), rgba[2, :, 3])
        np.testing.assert_array_equal(rgba[2, :, :3], np.broadcast_to([0x2F, 0x2F, 0x33], (4, 3)))
        np.testing.assert_array_equal(rgba[3, :, 3], 0)

    def test_blends_undershirt_into_shorts_across_the_waist_and_stays_opaque(self):
        # The waist (z = 1) crosses row 1 of 4 at its middle, v = 0.375.
        uvs, values = square(1.3, 0.5, torso=1.0)
        rgba, _ = base_layer(uvs, values, 4, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[..., 3], 255)
        np.testing.assert_array_equal(rgba[0], np.broadcast_to([0xE9, 0xE6, 0xE1, 255], (4, 4)))
        np.testing.assert_array_equal(rgba[2:], np.broadcast_to([0x2F, 0x2F, 0x33, 255], (2, 4, 4)))
        self.assertTrue(((rgba[1, :, 0] > 0x2F) & (rgba[1, :, 0] < 0xE9)).all(), rgba[1])

    def test_measures_coverage_over_the_samples_inside_a_face_so_island_edges_stay_opaque(self):
        # A triangle's slanted edge cuts through texels: those it covers in part are still fully shorts.
        triangle = [np.array([(0, 0), (1, 0), (0, 1)], dtype=np.float64)]
        values = [np.array([[0.9, 0, 0, 1.0, 0]] * 3)]
        rgba, covered = base_layer(triangle, values, 4, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[covered, 3], 255)
        np.testing.assert_array_equal(rgba[~covered, 3], 0)
        self.assertTrue(covered[0, 3] and not covered[3, 3])


class WidenIntoTest(unittest.TestCase):
    def test_grows_whole_pixels_into_the_unfilled_ones_and_leaves_filled_ones_alone(self):
        image = np.array([[[9, 1], [0, 0], [0, 0], [0, 0], [7, 0]]], dtype=np.uint8)
        filled = np.array([[True, False, False, False, True]])
        np.testing.assert_array_equal(
            widen_into(image, filled, 1), [[[9, 1], [9, 1], [0, 0], [7, 0], [7, 0]]]
        )
        np.testing.assert_array_equal(image[0, 1], [0, 0])


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
