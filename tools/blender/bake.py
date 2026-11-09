"""The base build's arithmetic (numpy, no bpy): the body-shape bake, the region-ID and base-layer maps, the
eye textures. Coordinates are (N, 3) arrays in Blender space (Z up, metres); per-vertex values are (N,)
arrays. Images are (rows, columns[, channels]) uint8 arrays, row 0 at the top; UVs given to them are in
image space: u to the right, v down, both 0..1."""

import struct
import zlib

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


# The contract's region codes (src/avatar/baseContract.ts REGION_CODES; build_base.py checks they match).
REGION_CODES = {
    "torso": 1,
    "pelvis": 2,
    "upperArms": 3,
    "forearms": 4,
    "thighs": 5,
    "calves": 6,
    "feet": 7,
    "neck": 8,
}

# Vertex group (game_engine bone) -> the region of the vertices it dominates. Any other group (head,
# hands, fingers) is region 0, never hidden.
REGION_OF_GROUP = {
    "spine_01": "torso",
    "spine_02": "torso",
    "spine_03": "torso",
    "clavicle_l": "torso",
    "clavicle_r": "torso",
    "pelvis": "pelvis",
    "thigh_l": "thighs",
    "thigh_r": "thighs",
    "upperarm_l": "upperArms",
    "upperarm_r": "upperArms",
    "lowerarm_l": "forearms",
    "lowerarm_r": "forearms",
    "calf_l": "calves",
    "calf_r": "calves",
    "foot_l": "feet",
    "foot_r": "feet",
    "ball_l": "feet",
    "ball_r": "feet",
    "neck_01": "neck",
}


def classify_regions(group_weights, z, hem_z):
    """Each vertex's region code (REGION_CODES, 0 = never hidden), decided by its dominant vertex group
    ({name: (N,) weights}); thigh vertices at or above hem_z belong to the pelvis (the shorts reach down
    to the hem, spec §5). A vertex in no group is 0."""
    names = list(group_weights)
    weights = np.column_stack([np.asarray(group_weights[name], dtype=np.float64) for name in names])
    dominant = weights.argmax(axis=1)
    codes = np.array([REGION_CODES.get(REGION_OF_GROUP.get(name), 0) for name in names])[dominant]
    above_hem = np.asarray(z) >= hem_z
    codes[(codes == REGION_CODES["thighs"]) & above_hem] = REGION_CODES["pelvis"]
    codes[weights.max(axis=1) <= 0] = 0
    return codes


def face_regions(vertex_regions, faces):
    """Each face's region: the code most of its vertices have, ties broken toward the lower code."""
    vertex_regions = np.asarray(vertex_regions)
    return np.array([np.bincount(vertex_regions[list(face)]).argmax() for face in faces])


def rasterise(uv_faces, values, size):
    """A (size, size) uint8 image with each face's UV polygon filled with its value, no antialiasing: a
    pixel takes the value of the last face that contains its centre (edges included). Polygons are
    fanned into triangles from their first corner."""
    image = np.zeros((size, size), dtype=np.uint8)
    for polygon, value in zip(uv_faces, values, strict=True):
        corners = np.asarray(polygon, dtype=np.float64) * size
        for i in range(1, len(corners) - 1):
            _fill_triangle(image, corners[0], corners[i], corners[i + 1], value)
    return image


def _fill_triangle(image, a, b, c, value):
    area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if area == 0:
        return
    corners = np.array([a, b, c])
    # The pixels whose centres (x + 0.5, y + 0.5) can lie inside the triangle's bounds.
    last_column, last_row = image.shape[1] - 1, image.shape[0] - 1
    x0, y0 = np.maximum(np.ceil(corners.min(axis=0) - 0.5), 0).astype(int)
    x1, y1 = np.minimum(np.floor(corners.max(axis=0) - 0.5), [last_column, last_row]).astype(int)
    if x0 > x1 or y0 > y1:
        return
    x, y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    inside = np.ones(x.shape, dtype=bool)
    for (px, py), (qx, qy) in ((a, b), (b, c), (c, a)):
        # Same side as the triangle's winding, or on the edge.
        inside &= np.sign(area) * ((qx - px) * (y - py) - (qy - py) * (x - px)) >= 0
    image[y0 : y1 + 1, x0 : x1 + 1][inside] = value


def widen(image, steps):
    """image with each non-zero value grown `steps` pixels (8-neighbourhood) into the zero pixels around
    it, one pixel per step; where values meet, each zero pixel takes one of its neighbours'."""
    image = image.copy()
    rows, columns = image.shape
    for _ in range(steps):
        padded = np.pad(image, 1)
        grown = image.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1) if dy else (-1, 1):
                neighbour = padded[1 + dy : 1 + dy + rows, 1 + dx : 1 + dx + columns]
                empty = grown == 0
                grown[empty] = neighbour[empty]
        image = grown
    return image


def png_bytes(pixels):
    """An 8-bit RGB or RGBA PNG of pixels ((rows, columns, 3 or 4) uint8), rows unfiltered."""
    rows, columns, channels = pixels.shape
    colour_type = {3: 2, 4: 6}[channels]

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    raw = np.concatenate([np.zeros((rows, 1), dtype=np.uint8), pixels.reshape(rows, -1)], axis=1)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", columns, rows, 8, colour_type, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw.astype(np.uint8).tobytes(), 9))
        + chunk(b"IEND", b"")
    )


def disc_weights(size, centres, radius, feather):
    """A (size, size) weight per pixel: 1 within `radius` of any of `centres` (image-space UVs), falling
    linearly to 0 over the next `feather`."""
    v, u = (np.mgrid[0:size, 0:size] + 0.5) / size
    distance = np.min([np.hypot(u - cu, v - cv) for cu, cv in centres], axis=0)
    return np.clip((radius + feather - distance) / feather, 0.0, 1.0)


def darken(rgba, weights, value):
    """rgba with each pixel's RGB scaled toward `value` times itself by its weight: HSV value drops,
    hue and saturation stay, alpha is untouched."""
    out = rgba.copy()
    scale = 1.0 - np.asarray(weights)[..., np.newaxis] * (1.0 - value)
    out[..., :3] = np.clip(np.round(rgba[..., :3] * scale), 0, 255)
    return out
