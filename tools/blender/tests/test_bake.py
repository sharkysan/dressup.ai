"""Tests of bake.py (numpy, no bpy): npm run test:blender."""

import struct
import unittest
import zlib

import numpy as np

import bake
from bake import (
    SHORTS,
    UNDERSHIRT,
    anchored,
    base_layer,
    classify_regions,
    coverage_gaps,
    darken,
    disc_weights,
    face_regions,
    garments,
    head_mask,
    height_and_min,
    in_armholes,
    interpolate,
    masked_delta,
    png_bytes,
    rasterise,
    smooth_patch,
    tent_weights,
    trunk_membership,
    uv_islands,
    waist_plane,
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


# Planes for the garment tests: hem 0.5, waist 1, neck 2 (metres); the armholes far out of the way.
PLANES = {
    "hem_z": 0.5,
    "waist_z": 1.0,
    "neck_z": 2.0,
    "armhole": {"strap_x": 10.0, "curve_z": 1.5, "width": 1.0, "depth": 0.5},
}
COLOURS = {UNDERSHIRT: (0xE9, 0xE6, 0xE1), SHORTS: (0x2F, 0x2F, 0x33)}


def square(z_top, z_bottom, torso=0.0, pelvis=0.0, thigh=0.0, neck=0.0, arm=0.0, u=(0, 1)):
    """One quad over the image's columns u (all rows) with (x, z, torso, pelvis, thigh, neck, arm) per
    corner: x is 0, z is z_top along the top edge and z_bottom along the bottom one."""
    corners = np.array([(u[0], 0), (u[1], 0), (u[1], 1), (u[0], 1)], dtype=np.float64)
    values = np.array([[0, z, torso, pelvis, thigh, neck, arm] for z in (z_top, z_top, z_bottom, z_bottom)])
    return [corners], [values]


def zeros(n):
    return np.zeros(n)


class InArmholesTest(unittest.TestCase):
    ARMHOLE = {"strap_x": 0.1, "curve_z": 1.3, "width": 0.06, "depth": 0.09}

    def test_runs_straight_down_the_shoulder_straps_outer_edge_to_curve_z_on_both_sides(self):
        x = np.array([0.099, 0.101, -0.099, -0.101, 0.099, 0.101])
        z = np.array([1.35, 1.35, 1.35, 1.35, 1.3, 1.3])
        np.testing.assert_array_equal(in_armholes(x, z, **self.ARMHOLE), [0, 1, 0, 1, 0, 1])

    def test_then_curves_out_along_a_quarter_ellipse_to_a_level_bottom_under_the_arm(self):
        # The edge 60° round the ellipse is at |x| 0.13, z 1.3 - 0.09 sin 60°; the bottom is z 1.21.
        z_edge = 1.3 - 0.09 * np.sin(np.pi / 3)
        x = np.array([0.128, 0.132, -0.132, 0.2, 0.2, 0.16])
        z = np.array([z_edge, z_edge, z_edge, 1.211, 1.209, 1.209])
        np.testing.assert_array_equal(in_armholes(x, z, **self.ARMHOLE), [0, 1, 1, 1, 0, 0])


class GarmentsTest(unittest.TestCase):
    def test_thigh_at_or_above_the_hem_is_shorts_and_below_it_is_not(self):
        z = np.array([0.6, 0.5, 0.4, 0.6])
        thigh = np.array([1.0, 0.5, 1.0, 0.4])
        np.testing.assert_array_equal(
            garments(zeros(4), z, zeros(4), zeros(4), thigh, zeros(4), zeros(4), **PLANES),
            [SHORTS, SHORTS, 0, 0],
        )

    def test_the_waist_plane_splits_the_trunk_so_nothing_shows_between_undershirt_and_shorts(self):
        # Just below the waist the torso still dominates; the shorts take it, not the skin.
        z = np.array([0.99, 1.0, 1.5, 0.3, 2.1])
        torso = np.array([0.6, 0.6, 1.0, 0.0, 1.0])
        pelvis = np.array([0.4, 0.0, 0.0, 0.9, 0.0])
        np.testing.assert_array_equal(
            garments(zeros(5), z, torso, pelvis, zeros(5), zeros(5), zeros(5), **PLANES),
            [SHORTS, UNDERSHIRT, UNDERSHIRT, SHORTS, 0],
        )

    def test_neck_below_the_neckline_is_undershirt_so_the_plane_draws_the_neckline(self):
        # Where the torso shades into the neck, its weights don't decide the neckline: the plane does.
        z = np.array([1.9, 2.0, 2.1, 2.1])
        torso = np.array([0.3, 0.2, 0.3, 0.6])
        neck = np.array([0.7, 0.8, 0.7, 0.4])
        np.testing.assert_array_equal(
            garments(zeros(4), z, torso, zeros(4), zeros(4), neck, zeros(4), **PLANES),
            [UNDERSHIRT, UNDERSHIRT, 0, 0],
        )

    def test_the_armholes_edge_not_the_weights_draws_the_armhole(self):
        # Where the torso shades into the upper arm, the arm's weight clothes the shoulder up to the
        # armhole's edge, and nothing beyond the edge is clothed, however much torso weight it has.
        planes = PLANES | {"armhole": InArmholesTest.ARMHOLE}
        x = np.array([0.09, 0.11, 0.11, -0.09])
        z = np.full(4, 1.32)
        torso = np.array([0.3, 0.3, 0.8, 0.3])
        arm = np.array([0.7, 0.7, 0.2, 0.7])
        np.testing.assert_array_equal(
            garments(x, z, torso, zeros(4), zeros(4), zeros(4), arm, **planes), [UNDERSHIRT, 0, 0, UNDERSHIRT]
        )


class WaistPlaneTest(unittest.TestCase):
    # Pelvis weight along the front and back midlines (z out of order, as vertices come).
    FRONT = (np.array([1.0, 0.9, 1.1]), np.array([0.06, 0.3, 0.0]))
    BACK = (np.array([0.9, 1.0, 1.1]), np.array([0.2, 0.02, 0.0]))

    def test_is_midway_along_spine_02_where_the_midline_pelvis_weights_fade_out(self):
        waist, weights = waist_plane((0.96, 1.05), [self.FRONT, self.BACK], most=0.1)
        self.assertAlmostEqual(waist, 1.005)
        np.testing.assert_allclose(weights, [0.057, 0.02 * 0.95])

    def test_fails_below_where_the_pelvis_weight_fades_or_above_where_it_ends(self):
        with self.assertRaisesRegex(ValueError, "pelvis weight 0.252"):
            waist_plane((0.90, 0.94), [self.FRONT, self.BACK], most=0.1)
        with self.assertRaisesRegex(ValueError, "pelvis weight 0.000"):
            waist_plane((1.10, 1.20), [self.FRONT, self.BACK], most=0.1)


class UvIslandsTest(unittest.TestCase):
    def test_joins_faces_that_share_a_vertex_at_the_same_uv_and_no_others(self):
        faces = [[0, 1, 2, 3], [1, 4, 5, 2], [1, 6, 7, 2], [8, 9, 10, 11]]
        uvs = [
            [(0, 0), (0.5, 0), (0.5, 0.5), (0, 0.5)],
            [(0.5, 0), (1, 0), (1, 0.5), (0.5, 0.5)],  # shares vertices 1 and 2 at their UVs: joined
            [(0, 0.6), (0.5, 0.6), (0.5, 1), (0, 1)],  # vertices 1 and 2 again, across a seam: apart
            [(1, 0), (1, 0.4), (0.9, 0.4), (0.9, 0)],  # touches the second face's UVs, no shared vertex
        ]
        np.testing.assert_array_equal(uv_islands(faces, uvs), [0, 0, 1, 2])


class TentWeightsTest(unittest.TestCase):
    def test_weighs_samples_by_their_distance_from_the_texels_centre_out_to_a_texel(self):
        np.testing.assert_allclose(
            tent_weights(4),
            [[0, 0, 0.125, 0.375], [0.625, 0.875, 0.875, 0.625], [0.375, 0.125, 0, 0]],
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

    def test_ramps_an_edge_on_a_texel_boundary_over_the_texels_either_side(self):
        # The hem (z = 0.5) runs along the boundary between rows 1 and 2 of 4, v = 0.5: a filter one
        # texel wide would step from 255 to 0 there; the tent ramps it over both rows.
        uvs, values = square(0.9, 0.1, thigh=1.0)
        rgba, _ = base_layer(uvs, values, 4, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[0, :, 3], 255)
        np.testing.assert_array_equal(rgba[1, :, 3], 223)  # 255 x 3.5 / 4
        np.testing.assert_array_equal(rgba[2, :, 3], 32)  # 255 x 0.5 / 4
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
        values = [np.array([[0, 0.9, 0, 0, 1.0, 0, 0]] * 3)]
        rgba, covered = base_layer(triangle, values, 4, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[covered, 3], 255)
        np.testing.assert_array_equal(rgba[~covered, 3], 0)
        self.assertTrue(covered[0, 3] and not covered[3, 3])

    def test_never_blends_an_island_with_the_island_beside_it(self):
        # Two islands side by side: the left one shorts (thigh above the hem), the right one bare.
        left_uvs, left = square(0.9, 0.9, thigh=1.0, u=(0, 0.5))
        right_uvs, right = square(0.1, 0.1, thigh=1.0, u=(0.5, 1))
        rgba, _ = base_layer(left_uvs + right_uvs, left + right, 8, PLANES, COLOURS, islands=[0, 1])
        np.testing.assert_array_equal(rgba[:, :4, 3], 255)
        np.testing.assert_array_equal(rgba[:, 4:, 3], 0)
        # As one island, the filter would blend them across the join.
        rgba, _ = base_layer(left_uvs + right_uvs, left + right, 8, PLANES, COLOURS)
        np.testing.assert_array_equal(rgba[:, 3, 3], 223)
        np.testing.assert_array_equal(rgba[:, 4, 3], 32)

    def test_renders_in_bands_the_same_as_in_one_piece(self):
        # Bands of 2 texel rows: each band's filter reaches into the rows of the bands either side.
        uvs, values = square(0.9, 0.1, thigh=1.0)
        whole, _ = base_layer(uvs, values, 8, PLANES, COLOURS)
        original = bake.BAND_ROWS
        bake.BAND_ROWS = 2
        try:
            banded, _ = base_layer(uvs, values, 8, PLANES, COLOURS)
        finally:
            bake.BAND_ROWS = original
        np.testing.assert_array_equal(banded, whole)


class TrunkMembershipTest(unittest.TestCase):
    def test_sums_torso_pelvis_thigh_above_the_hem_neck_below_the_neckline_and_arm_outside_the_armholes(self):
        planes = {"hem_z": 0.5, "neck_z": 2.0, "armhole": InArmholesTest.ARMHOLE}
        x = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2])
        z = np.array([1.0, 0.6, 0.4, 1.9, 2.1, 1.0, 1.25])
        part = np.array([0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        ones = np.ones(7)
        np.testing.assert_allclose(
            trunk_membership(
                x,
                z,
                part,
                part,
                ones * [0, 1, 1, 0, 0, 0, 0],
                ones * [0, 0, 0, 1, 1, 0, 0],
                ones * [0, 0, 0, 0, 0, 1, 1],
                **planes,
            ),
            [0.2, 1, 0, 1, 0, 1, 0],
        )


class CoverageGapsTest(unittest.TestCase):
    # The hem at 0.5, the armholes' bottom at 1.5 - 0.3 = 1.2; the tests take a margin of 0.1 above the hem.
    PLANES = {
        "hem_z": 0.5,
        "waist_z": 1.0,
        "neck_z": 2.0,
        "armhole": {"strap_x": 10.0, "curve_z": 1.5, "width": 1.0, "depth": 0.3},
    }

    def layer(self):
        # One torso quad from z 1.6 (top row) down to 0.2 (bottom row): the trunk throughout, clothed by
        # base_layer from the hem (0.5) up; rows 0..15 of 16, 0.0875 m each.
        uvs, values = square(1.6, 0.2, torso=1.0)
        rgba, _ = base_layer(uvs, values, 16, self.PLANES, COLOURS)
        return uvs, values, rgba

    def test_finds_none_where_the_base_layer_covers_the_trunk(self):
        uvs, values, rgba = self.layer()
        self.assertEqual(coverage_gaps(rgba, uvs, values, self.PLANES, margin=0.1).shape, (0, 2))

    def test_finds_a_hole_in_the_trunk_between_the_hem_and_the_armholes(self):
        uvs, values, rgba = self.layer()
        rgba[6, 9, 3] = 0  # z 1.6 - 6.5 x 0.0875 = 1.03
        rgba[7, 2, 3] = 254
        np.testing.assert_array_equal(
            coverage_gaps(rgba, uvs, values, self.PLANES, margin=0.1), [[6, 9], [7, 2]]
        )

    def test_ignores_holes_above_the_armholes_bottom_below_the_margin_or_off_the_trunk(self):
        uvs, values, rgba = self.layer()
        rgba[3, 4, 3] = 0  # z 1.29: above the armholes' bottom
        rgba[12, 4, 3] = 0  # z 0.51: within the margin above the hem
        np.testing.assert_array_equal(coverage_gaps(rgba, uvs, values, self.PLANES, margin=0.1).shape, (0, 2))
        # Where the trunk membership is below 0.5 nothing is required.
        uvs, values = square(1.6, 0.2, torso=0.4)
        rgba = np.zeros((16, 16, 4), dtype=np.uint8)
        self.assertEqual(coverage_gaps(rgba, uvs, values, self.PLANES, margin=0.1).shape, (0, 2))


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
