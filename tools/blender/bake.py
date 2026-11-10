"""The base build's arithmetic (numpy, no bpy): the body-shape bake, the nipples' smoothing, the region-ID
and base-layer maps, the eye textures. Coordinates are (N, 3) arrays in Blender space (Z up, metres);
per-vertex values are (N,) arrays. Images are (rows, columns[, channels]) uint8 arrays, row 0 at the
top; UVs given to them are in image space: u to the right, v down, both 0..1."""

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


def smooth_patch(coords, edges, free, rings=2):
    """coords with the `free` vertices (a boolean (N,) array, one patch) moved onto the quadratic surface
    that best fits the `rings` rings of vertices around them (by `edges`, (E, 2) vertex indices), along that
    surface's normal: a bump flattens into the curve of the surface around it. The other vertices stay."""
    coords = np.asarray(coords, dtype=np.float64)
    edges = np.asarray(edges)
    free = np.asarray(free, dtype=bool)
    around = free.copy()
    for _ in range(rings):
        around[edges[around[edges].any(axis=1)].ravel()] = True
    around &= ~free
    centre = coords[around].mean(axis=0)
    # The surround's two widest axes span the surface; the third is its normal.
    _, _, (u, v, normal) = np.linalg.svd(coords[around] - centre)

    def heights(points):
        offset = points - centre
        a, b = offset @ u, offset @ v
        return np.column_stack([np.ones(len(a)), a, b, a * a, a * b, b * b]), offset @ normal

    terms, height = heights(coords[around])
    fit = np.linalg.lstsq(terms, height, rcond=None)[0]
    terms, height = heights(coords[free])
    out = coords.copy()
    out[free] += (terms @ fit - height)[:, np.newaxis] * normal
    return out


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
            hit = _triangle_pixels(corners[[0, i, i + 1]], (0, size), size)
            if hit is not None:
                window, inside, _ = hit
                image[window][inside] = value
    return image


def interpolate(uv_faces, corner_values, size, rows=None):
    """((rows, size, k) float32 values, (rows, size) bool covered): the faces rasterised as in rasterise,
    each covered pixel taking the barycentric blend, at its centre, of its triangle's corner values
    (corner_values holds one (corners, k) array per face). Pixels no face covers are 0. rows = (start,
    stop) renders only those rows of the size² image, as rows 0 .. stop - start - 1."""
    start, stop = rows or (0, size)
    values = np.zeros((stop - start, size, np.shape(corner_values[0])[1]), dtype=np.float32)
    covered = np.zeros((stop - start, size), dtype=bool)
    for polygon, corner in zip(uv_faces, corner_values, strict=True):
        points = np.asarray(polygon, dtype=np.float64) * size
        corner = np.asarray(corner, dtype=np.float64)
        for i in range(1, len(points) - 1):
            triangle = [0, i, i + 1]
            hit = _triangle_pixels(points[triangle], (start, stop), size)
            if hit is None:
                continue
            (window_rows, window_columns), inside, weights = hit
            window = (slice(window_rows.start - start, window_rows.stop - start), window_columns)
            values[window][inside] = weights[inside] @ corner[triangle]
            covered[window] |= inside
    return values, covered


def _triangle_pixels(corners, rows, columns):
    """The pixels in image rows rows = (start, stop) and columns 0 .. columns - 1 whose centres (x + 0.5,
    y + 0.5) lie inside the triangle `corners` ((3, 2), pixel units), edges included: ((row slice, column
    slice) of the window around them, (h, w) bool inside, (h, w, 3) each corner's barycentric weight), or
    None if there are none."""
    a, b, c = corners
    area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if area == 0:
        return None
    x0, y0 = np.maximum(np.ceil(corners.min(axis=0) - 0.5), [0, rows[0]]).astype(int)
    x1, y1 = np.minimum(np.floor(corners.max(axis=0) - 0.5), [columns - 1, rows[1] - 1]).astype(int)
    if x0 > x1 or y0 > y1:
        return None
    x, y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    # The signed area a pixel centre makes with each edge, over the triangle's: the weight of the corner
    # opposite that edge. The centre is inside, or on an edge, where no weight is negative.
    weights = np.stack(
        [
            ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) / area
            for p, q in ((b, c), (c, a), (a, b))
        ],
        axis=-1,
    )
    return (slice(y0, y1 + 1), slice(x0, x1 + 1)), (weights >= 0).all(axis=-1), weights


# The base layer's garments (spec §3), as garments() codes them; 0 is bare skin.
UNDERSHIRT = 1
SHORTS = 2


def garments(z, torso, pelvis, thigh, neck, hem_z, waist_z, neck_z):
    """Each point's base-layer garment (UNDERSHIRT, SHORTS or 0), from its height z and its soft
    membership (summed vertex-group weights) of the torso, the pelvis, the thighs and the neck. The trunk
    is clothed where its membership is at least 0.5: torso plus pelvis, plus thigh at or above the shorts'
    hem and neck at or below the neckline, so that those planes, not the weights where the torso shades
    into the thighs and the neck, draw the hem and the neckline. The waist plane alone splits the trunk
    into the undershirt (waist_z up to neck_z) and the shorts (below waist_z), so no skin can show between
    the two."""
    z = np.asarray(z)
    trunk = (
        np.asarray(torso)
        + np.asarray(pelvis)
        + np.where(z >= hem_z, thigh, 0.0)
        + np.where(z <= neck_z, neck, 0.0)
    )
    clothed = trunk >= 0.5
    out = np.zeros(z.shape, dtype=np.uint8)
    out[clothed & (z < waist_z)] = SHORTS
    out[clothed & (z >= waist_z) & (z <= neck_z)] = UNDERSHIRT
    return out


# Each base-layer texel is classified at SUPERSAMPLES x SUPERSAMPLES points, which base_layer rasterises
# BAND_ROWS texel rows at a time (512 x 8192 samples of 5 float32 values: 84 MB a band at 2048²).
SUPERSAMPLES = 4
BAND_ROWS = 128


def base_layer(uv_faces, corner_values, size, planes, colours, samples=SUPERSAMPLES):
    """The base layer in the faces' UV layout, antialiased: ((size, size, 4) uint8 straight-alpha RGBA,
    (size, size) bool covered). corner_values holds one (corners, 5) array per face: each corner's z,
    torso, pelvis, thigh and neck, as garments() takes them with planes = {hem_z, waist_z, neck_z};
    colours maps each garment to its RGB. A texel is sampled samples x samples times; its samples inside
    a face are interpolated and classified one by one. Its alpha is the share of those that are clothed,
    its colour their garments' mean: a garment's edge blends over about a texel, while an island's own
    edge stays opaque. A texel with no sample inside a face is 0 and not covered."""
    fine = size * samples
    rgba = np.zeros((size, size, 4), dtype=np.uint8)
    covered = np.zeros((size, size), dtype=bool)
    # Each face's span of sample rows, so that each band rasterises only the faces that reach into it.
    spans = np.array([[min(p[1] for p in polygon), max(p[1] for p in polygon)] for polygon in uv_faces])
    spans = spans * fine - 0.5
    for top in range(0, size, BAND_ROWS):
        bottom = min(top + BAND_ROWS, size)
        start, stop = top * samples, bottom * samples
        near = np.flatnonzero((spans[:, 1] >= start) & (spans[:, 0] < stop))
        if len(near) == 0:
            continue
        values, inside = interpolate(
            [uv_faces[i] for i in near], [corner_values[i] for i in near], fine, rows=(start, stop)
        )
        kinds = np.where(inside, garments(*np.moveaxis(values, -1, 0), **planes), 0)

        def per_texel(mask, rows=bottom - top):
            return mask.reshape(rows, samples, size, samples).sum(axis=(1, 3))

        counts = {garment: per_texel(kinds == garment) for garment in colours}
        clothed = sum(counts.values())
        hits = per_texel(inside)
        rgb = sum(counts[g][..., np.newaxis] * np.asarray(colours[g], dtype=np.float64) for g in colours)
        rgb /= np.maximum(clothed, 1)[..., np.newaxis]
        alpha = 255 * clothed / np.maximum(hits, 1)
        rgba[top:bottom] = np.round(np.concatenate([rgb, alpha[..., np.newaxis]], axis=-1))
        covered[top:bottom] = hits > 0
    return rgba, covered


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


def widen_into(image, filled, steps):
    """image ((rows, columns, ...)) with its `filled` pixels ((rows, columns) bool) grown `steps` pixels
    into the others around them, the way widen grows values: each pixel reached takes the whole value
    (every channel) of one filled pixel."""
    rows, columns = filled.shape
    index = np.where(filled, np.arange(1, rows * columns + 1).reshape(rows, columns), 0)
    reached = widen(index, steps).ravel()
    source = image.reshape(rows * columns, *image.shape[2:])
    out = source.copy()
    out[reached > 0] = source[reached[reached > 0] - 1]
    return out.reshape(image.shape)


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
