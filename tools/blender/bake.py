"""The body-shape bake's arithmetic (numpy, no bpy). Coordinates are (N, 3) arrays in Blender space
(Z up, metres); per-vertex values are (N,) arrays."""

import numpy as np


def head_mask(head_weights):
    """How much of a body morph's offset each vertex keeps: 1 - clip(head weight, 0, 1). Body morphs
    never move the head (spec §7): 0 on the head, blending to 1 down the neck."""
    return 1.0 - np.clip(head_weights, 0.0, 1.0)


def anchored(variant, base, anchor):
    """variant translated so that its `anchor` vertices (a boolean (N,) array) sit, on average, where
    base's do."""
    return variant - (variant[anchor] - base[anchor]).mean(axis=0)


def masked_delta(variant, base, mask):
    """The offset from base to variant, per vertex scaled by mask."""
    return (variant - base) * mask[:, np.newaxis]


def height_and_min(coords):
    """(max z - min z, min z): the height and the lowest point of coords."""
    z = coords[:, 2]
    return float(z.max() - z.min()), float(z.min())
