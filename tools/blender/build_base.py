"""Builds the realistic base avatar (spec §4, §7) headlessly and exports it as VRM 1.0.

    tools/blender/run.sh tools/blender/build_base.py -- --contract <contract.json> --work <dir>

Writes <work>/base.vrm: a MakeHuman (MPFB) female in a T-pose, nipples flattened (a modest fit under the
base layer), game_engine rig, GAMEENGINE (plain PBR) materials, eyes, brows, lashes, teeth and tongue,
the VRM expressions happy, relaxed, surprised and blinkLeft baked from faceunits01 (targets.py), the
body-shape shape keys baked from MakeHuman probes (bake.py), every object and material named per the
contract that tools/build-base.ts writes from src/avatar/baseContract.ts. Writes <work>/base.json: the
Body's height and lowest point, and how much each body target changes them (baseMetaSchema);
<work>/regions.png and <work>/baselayer.png, the region-ID map and the base layer in the Body's UV
layout, and <work>/coverage.png, the texels the Body's faces cover; and <work>/eyes/<preset>.png, one
eye texture per eye-colour preset. Exits 1 if any step or the export fails.
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bake import (  # noqa: E402
    REGION_CODES,
    REGION_OF_GROUP,
    SHORTS,
    UNDERSHIRT,
    anchored,
    base_layer,
    classify_regions,
    darken,
    disc_weights,
    face_regions,
    head_mask,
    height_and_min,
    masked_delta,
    png_bytes,
    rasterise,
    smooth_patch,
    uv_islands,
    waist_plane,
    widen,
    widen_into,
)
from mpfb import mpfb_service, require_toolchain  # noqa: E402
from targets import EXPRESSION_RECIPES, mix, parse_target, to_blender  # noqa: E402

# Young adult female, the deepest of MPFB's three light-skinned young female skins (young_caucasian_female,
# young_caucasian_female2 and young_asian_female; young_african_female is its dark one). build-base.ts
# neutralises the texture, so the runtime tint sets the tone.
SKIN_MHMAT = "young_caucasian_female2"
# The base's macros over MPFB's defaults (0.5 each): gender 0, female.
BASE_MACROS = {"gender": 0.0}
# A modest fit, so that the base layer's fitted undershirt, painted on the skin, shows no nipple geometry.
# Every human, the base and each body probe alike, is made with these MPFB targets (data/targets/<dir>/
# <name>.target.gz) at weight 1, and then its FLATTENED_GROUP vertices (the nipples and areolae) are
# moved onto the surface around them: the targets alone leave a small tip, and at a weight above 1 they
# fold the mesh.
BASE_TARGETS = ("breast/nipple-size-decr", "breast/nipple-point-decr")
FLATTENED_GROUP = "nipple"
RIG = "game_engine"
T_POSE = "game_engine_fk/t-pose.json"

# Contract material key -> (MPFB asset type, asset name). Each proxy's object and material take the
# contract's material name (Eyes, Brows, ...).
PROXIES = {
    "eyes": ("eyes", "high-poly"),
    "brows": ("eyebrows", "eyebrow011"),
    "lashes": ("eyelashes", "eyelashes02"),
    "teeth": ("teeth", "teeth_base"),
    "tongue": ("tongue", "tongue01"),
}

# game_engine rig bone -> VRM 1.0 humanoid bone. The same table as the VRM add-on's Unreal mapping
# (common/human_bone_mapper/unreal_mapping.py); every bone is checked against the rig at build time.
GAME_ENGINE_TO_VRM = {
    "pelvis": "hips",
    "spine_01": "spine",
    "spine_02": "chest",
    "spine_03": "upperChest",
    "neck_01": "neck",
    "head": "head",
    "clavicle_l": "leftShoulder",
    "upperarm_l": "leftUpperArm",
    "lowerarm_l": "leftLowerArm",
    "hand_l": "leftHand",
    "clavicle_r": "rightShoulder",
    "upperarm_r": "rightUpperArm",
    "lowerarm_r": "rightLowerArm",
    "hand_r": "rightHand",
    "thigh_l": "leftUpperLeg",
    "calf_l": "leftLowerLeg",
    "foot_l": "leftFoot",
    "ball_l": "leftToes",
    "thigh_r": "rightUpperLeg",
    "calf_r": "rightLowerLeg",
    "foot_r": "rightFoot",
    "ball_r": "rightToes",
    "thumb_01_l": "leftThumbMetacarpal",
    "thumb_02_l": "leftThumbProximal",
    "thumb_03_l": "leftThumbDistal",
    "index_01_l": "leftIndexProximal",
    "index_02_l": "leftIndexIntermediate",
    "index_03_l": "leftIndexDistal",
    "middle_01_l": "leftMiddleProximal",
    "middle_02_l": "leftMiddleIntermediate",
    "middle_03_l": "leftMiddleDistal",
    "ring_01_l": "leftRingProximal",
    "ring_02_l": "leftRingIntermediate",
    "ring_03_l": "leftRingDistal",
    "pinky_01_l": "leftLittleProximal",
    "pinky_02_l": "leftLittleIntermediate",
    "pinky_03_l": "leftLittleDistal",
    "thumb_01_r": "rightThumbMetacarpal",
    "thumb_02_r": "rightThumbProximal",
    "thumb_03_r": "rightThumbDistal",
    "index_01_r": "rightIndexProximal",
    "index_02_r": "rightIndexIntermediate",
    "index_03_r": "rightIndexDistal",
    "middle_01_r": "rightMiddleProximal",
    "middle_02_r": "rightMiddleIntermediate",
    "middle_03_r": "rightMiddleDistal",
    "ring_01_r": "rightRingProximal",
    "ring_02_r": "rightRingIntermediate",
    "ring_03_r": "rightRingDistal",
    "pinky_01_r": "rightLittleProximal",
    "pinky_02_r": "rightLittleIntermediate",
    "pinky_03_r": "rightLittleDistal",
}

# Basemesh vertex groups that hold MakeHuman's fitting helpers, not the body.
HELPER_GROUPS = ("HelperGeometry", "JointCubes")

# Proxies (contract material keys) that take the expression shape keys from the basemesh. Not the eyes:
# the eyeballs stay put while the lids, brows and mouth move around them.
EXPRESSION_PROXIES = ("brows", "lashes", "teeth", "tongue")

# Contract body target -> the one change its probe makes to the base: MPFB macros set to a value, and
# MPFB targets (data/targets/<dir>/<name>.target.gz) loaded at weight 1.
BODY_PROBES = {
    "body_gender_max": {"macros": {"gender": 1.0}},
    "body_weight_min": {"macros": {"weight": 0.0}},
    "body_weight_max": {"macros": {"weight": 1.0}},
    "body_muscle_min": {"macros": {"muscle": 0.0}},
    "body_muscle_max": {"macros": {"muscle": 1.0}},
    "body_bust_min": {"macros": {"cupsize": 0.0}},
    "body_bust_max": {"macros": {"cupsize": 1.0}},
    "body_shoulders_min": {"targets": ["torso/measure-shoulder-dist-decr"]},
    "body_shoulders_max": {"targets": ["torso/measure-shoulder-dist-incr"]},
    "body_waist_min": {"targets": ["torso/measure-waist-circ-decr"]},
    "body_waist_max": {"targets": ["torso/measure-waist-circ-incr"]},
    "body_hips_min": {"targets": ["torso/measure-hips-circ-decr"]},
    "body_hips_max": {"targets": ["torso/measure-hips-circ-incr"]},
    "body_legLength_min": {
        "targets": ["legs/measure-upperleg-height-decr", "legs/measure-lowerleg-height-decr"]
    },
    "body_legLength_max": {
        "targets": ["legs/measure-upperleg-height-incr", "legs/measure-lowerleg-height-incr"]
    },
    "body_armLength_min": {
        "targets": ["arms/measure-upperarm-length-decr", "arms/measure-lowerarm-length-decr"]
    },
    "body_armLength_max": {
        "targets": ["arms/measure-upperarm-length-incr", "arms/measure-lowerarm-length-incr"]
    },
}

# Pairs of body targets whose summed deltas are compared, in the log only, with a probe that makes both
# changes: the runtime adds morphs linearly, MakeHuman's macros don't combine quite linearly.
BODY_CORNERS = (
    ("body_gender_max", "body_weight_max"),
    ("body_gender_max", "body_muscle_max"),
    ("body_weight_min", "body_muscle_max"),
    ("body_weight_max", "body_bust_max"),
)

# Vertex groups (game_engine bones) -> their share of a vertex's head weight. Body morphs are zeroed on
# the head and fade in down the neck (spec §7).
HEAD_GROUPS = {"head": 1.0, "neck_01": 0.5}
# A body morph may move a vertex with head weight >= HEAD_WEIGHT_STILL by at most HEAD_STILL_M.
HEAD_WEIGHT_STILL = 0.999
HEAD_STILL_M = 1e-6
# An unchanged probe must reproduce the base this closely, or every body delta is polluted.
PROBE_TOLERANCE_M = 1e-5

# The base layer (spec §3), painted over the skin at runtime: a fitted undershirt over the torso and
# shorts over the pelvis, opaque, transparent everywhere else, antialiased (bake.base_layer). 2048², the
# Skin texture's size.
UNDERSHIRT_RGB = (0xE9, 0xE6, 0xE1)
SHORTS_RGB = (0x2F, 0x2F, 0x33)
BASE_LAYER_SIZE = 2048
# The region-ID map (spec §7): R = the region code of the face under each pixel, 0 = never hidden.
REGIONS_SIZE = 1024
# The shorts' hem (spec §5): thigh vertices above it are pelvis. The crotch is the lowest midline vertex
# in the pelvis vertex group; midline vertices are within MIDLINE_M of x = 0.
HEM_BELOW_CROTCH_M = 0.08
MIDLINE_M = 1e-4
# The base layer's waist, where the undershirt meets the shorts (bake.waist_plane): midway along the
# spine_02 bone, 1.006 m on the base, above the navel (0.948 to 0.990 m; the weight morph lifts the belly
# below the navel by up to 9 mm, which would bend a waist line there into a peak). The build fails unless
# that is the top of the pelvis vertex group, where the pelvis weight on the front and back midlines has
# faded to between 0 and WAIST_PELVIS_MAX.
WAIST_PELVIS_MAX = 0.1
# The undershirt's neckline: NECKLINE_BELOW_M below the lowest front-midline vertex whose neck weight
# (neck_01 + head: on the front, the head's weight comes in before neck_01's alone reaches 0.5) is at
# least 0.5.
NECKLINE_BELOW_M = 0.01
# The undershirt's armholes (bake.in_armholes), from the shoulder joints (the upper arms' heads): seen from
# the front, each runs straight down STRAP_INSIDE_SHOULDER_M inside the joint, the shoulder strap's outer
# edge, to the joint's height, then curves out ARMHOLE_WIDTH_M to a level bottom ARMHOLE_DEPTH_M below the
# joint, under the armpit. The upper arms' weights over the shoulders, which shade into the torso's over
# large faces, would draw a jagged edge.
STRAP_INSIDE_SHOULDER_M = 0.03
ARMHOLE_WIDTH_M = 0.06
ARMHOLE_DEPTH_M = 0.09
# Pixels each map grows every UV island by into the texels no face covers, so that a sample on a UV seam
# (the back's midline, the crotch) blends the island with itself, not with what lies outside it: without
# it, filtering draws a line of skin down the back of the undershirt and shorts. 8 px of 2048² holds down
# to the 256² mip level. Islands that meet in a gutter split it; no island's own texels are painted over.
MAP_MARGIN_PX = {BASE_LAYER_SIZE: 8, REGIONS_SIZE: 4}

# Eye-colour preset (src/catalog/params.ts) -> (MakeHuman eye texture in <MPFB data>/eyes/materials, the
# scale its iris's HSV value takes). Each preset takes the texture whose iris hue (the median of the iris
# disc) is nearest its reference colour's (src/avatar/eyeColors.ts):
#   brown 27°, darkBrown 23°, hazel 40° -> brownlight 33° (MakeHuman's "brown" is a red mahogany, 8°)
#   green 109° -> green 109°
#   blue 214° -> lightblue 188°: blue (189°) and deepblue (237°, violet) are as near in hue; lightblue has
#     the preset's value (0.69) and is the nearest in OKLab
#   grey (achromatic, saturation 0.11) -> grey (0.11)
# Presets that share a texture are kept distinct: the lightest keeps it as it is, the darker ones lower the
# iris's value in the ratio of their reference values (brown 0.42 / hazel 0.56, darkBrown 0.23 / 0.56).
EYE_PRESETS = {
    "brown": ("brownlight", 0.75),
    "darkBrown": ("brownlight", 0.41),
    "hazel": ("brownlight", 1.0),
    "green": ("green", 1.0),
    "blue": ("lightblue", 1.0),
    "grey": ("grey", 1.0),
}
# The two iris discs of MakeHuman's 1024² eye textures (image-space UVs), from a circle fit to the limbus
# of brownlight_eye.png: centres (721, 305) and (301, 718) px, radius 122 px. A darkened iris fades out
# from 120 to 126 px; the sclera and the cornea's alpha-0 disc are outside and keep their pixels.
IRIS_CENTRES = ((721.2 / 1024, 304.8 / 1024), (300.7 / 1024, 718.3 / 1024))
IRIS_RADIUS = 120 / 1024
IRIS_FEATHER = 6 / 1024

VRM_NAME = "Kiss base"
VRM_AUTHOR = "Kiss"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_base.py")
    parser.add_argument("--contract", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    return parser.parse_args(argv)


def mpfb_data():
    return Path(os.environ["MPFB_DATA"])


def activate(obj):
    """Makes obj the only selected and the active object, in object mode."""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def create_human(macros=None):
    """The MakeHuman basemesh: MPFB's default macros with BASE_MACROS, then `macros`, BASE_TARGETS and the
    flattened FLATTENED_GROUP, in metres, feet on the ground."""
    macros = mpfb_service("TargetService").get_default_macro_info_dict() | BASE_MACROS | (macros or {})
    basemesh = mpfb_service("HumanService").create_human(scale=0.1, macro_detail_dict=macros)
    load_targets(basemesh, BASE_TARGETS)
    flatten(basemesh, FLATTENED_GROUP)
    return basemesh


def load_targets(basemesh, targets):
    """Loads each MPFB target (<dir>/<name>, under MPFB's data/targets) onto basemesh at weight 1."""
    root = Path(mpfb_service("LocationService").get_mpfb_data("targets"))
    for target in targets:
        mpfb_service("TargetService").load_target(basemesh, str(root / f"{target}.target.gz"), weight=1.0)


def flatten(basemesh, group):
    """Adds the shape key flatten-<group>, at 1, which moves the vertex group's vertices on each side of
    the body, from the current shape (the mix of basemesh's shape keys), onto the smooth surface around
    them (bake.smooth_patch)."""
    mix = basemesh.shape_key_add(name="mix", from_mix=True)
    shape = coords_array(mix.data)
    basemesh.shape_key_remove(mix)
    edges = np.empty(2 * len(basemesh.data.edges), dtype=np.int64)
    basemesh.data.edges.foreach_get("vertices", edges)
    members = vertex_group_weights(basemesh, group) > 0
    flat = shape
    for side in (shape[:, 0] < 0, shape[:, 0] > 0):
        flat = smooth_patch(flat, edges.reshape(-1, 2), members & side)
    basis = coords_array(basemesh.data.shape_keys.reference_key.data)
    add_shape_key(basemesh, f"flatten-{group}", (basis + flat - shape).astype(np.float32).ravel())
    basemesh.data.shape_keys.key_blocks[f"flatten-{group}"].value = 1.0


def set_skin(basemesh):
    skin = mpfb_data() / "skins" / SKIN_MHMAT / f"{SKIN_MHMAT}.mhmat"
    mpfb_service("HumanService").set_character_skin(str(skin), basemesh, skin_type="GAMEENGINE")


def add_rig(basemesh):
    return mpfb_service("HumanService").add_builtin_rig(basemesh, RIG)


def add_proxies(basemesh):
    """Adds eyes, brows, lashes, teeth and tongue, rigged to the basemesh's rig. Returns {key: object}."""
    HumanService = mpfb_service("HumanService")
    proxies = {}
    for key, (asset_type, name) in PROXIES.items():
        mhclo = mpfb_data() / asset_type / name / f"{name}.mhclo"
        proxies[key] = HumanService.add_mhclo_asset(
            str(mhclo), basemesh, asset_type=asset_type, subdiv_levels=0, material_type="GAMEENGINE"
        )
    return proxies


def apply_t_pose(rig):
    LocationService = mpfb_service("LocationService")
    RigService = mpfb_service("RigService")
    pose_file = Path(LocationService.get_mpfb_data("poses")) / T_POSE
    pose = json.loads(pose_file.read_text())
    activate(rig)
    bpy.ops.object.mode_set(mode="POSE")
    RigService.set_pose_from_dict(rig, pose)
    bpy.ops.object.mode_set(mode="OBJECT")


def remove_mask_and_subsurf(obj):
    """Removes MPFB's Mask (hidden helpers) and Subdivision modifiers: the mesh keeps its full topology."""
    for modifier in list(obj.modifiers):
        if modifier.type in ("MASK", "SUBSURF"):
            obj.modifiers.remove(modifier)


def bake_pose_as_rest(rig, meshes):
    """Makes the current (T-)pose the rest pose: meshes keep their posed shape with no shape keys and
    only an Armature modifier, and the rig's rest matches it."""
    for obj in meshes:
        activate(obj)
        if obj.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        remove_mask_and_subsurf(obj)
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        leftover = [m.type for m in obj.modifiers]
        if leftover:
            raise RuntimeError(f"{obj.name}: unexpected modifiers {leftover}")

    activate(rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    RigService = mpfb_service("RigService")
    for obj in meshes:
        activate(obj)
        RigService.ensure_armature_modifier(obj, rig)


def vertex_coords(mesh):
    """A mesh's vertex coordinates, flat [x0, y0, z0, x1, ...]."""
    coords = [0.0] * (3 * len(mesh.vertices))
    mesh.vertices.foreach_get("co", coords)
    return coords


def coords_array(points):
    """The `co` of each of points (a mesh's vertices, a shape key's data) as an (N, 3) float64 array."""
    coords = np.empty(3 * len(points), dtype=np.float32)
    points.foreach_get("co", coords)
    return coords.reshape(-1, 3).astype(np.float64)


def add_shape_key(obj, name, coords):
    """Adds shape key `name` (and the Basis first, if obj has none) with flat coordinates `coords`."""
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    obj.shape_key_add(name=name, from_mix=False).data.foreach_set("co", coords)


def faceunits():
    """{unit: {vertex index: MakeHuman offset}} for every faceunits01 unit the recipes use."""
    units_dir = Path(os.environ["FACEUNITS_DIR"])
    names = {unit for recipe in EXPRESSION_RECIPES.values() for unit in recipe}
    return {name: parse_target((units_dir / f"{name}.target").read_text()) for name in names}


def capture_shape_keys(source, obj, names):
    """Gives obj each of source's shape keys `names`, captured through a Surface Deform bound to source
    at rest: proxies don't follow basemesh shape keys on their own."""
    activate(obj)
    capture = obj.modifiers.new("Capture expressions", "SURFACE_DEFORM")
    capture.target = source
    bpy.ops.object.surfacedeform_bind(modifier=capture.name)
    bpy.context.evaluated_depsgraph_get()  # the bind happens on evaluation
    if not capture.is_bound:
        raise RuntimeError(f"{obj.name}: Surface Deform did not bind to {source.name}")
    keys = source.data.shape_keys.key_blocks
    for name in names:
        keys[name].value = 1.0
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        coords = vertex_coords(evaluated.to_mesh())
        evaluated.to_mesh_clear()
        keys[name].value = 0.0
        add_shape_key(obj, name, coords)
    obj.modifiers.remove(capture)


def bake_expressions(contract, basemesh, proxies):
    """Adds each EXPRESSION_RECIPES mix of faceunits01 as the contract's shape key on the basemesh, then
    captures those keys on the EXPRESSION_PROXIES. Runs before delete_helper_vertices: target indices
    address the full basemesh, helpers included."""
    key_names = contract["expressionTargets"]
    if set(key_names) != set(EXPRESSION_RECIPES):
        raise RuntimeError(
            f"contract expressions {sorted(key_names)} != recipes {sorted(EXPRESSION_RECIPES)}"
        )
    units = faceunits()
    # MPFB's GeneralObjectProperties scale_factor, which its TargetService scales targets by.
    scale = basemesh.MPFB_GEN_scale_factor
    basis = vertex_coords(basemesh.data)
    for expression, recipe in EXPRESSION_RECIPES.items():
        coords = list(basis)
        for index, delta in mix(units, recipe).items():
            if 3 * index >= len(coords):
                raise RuntimeError(f"{expression}: target vertex {index} is beyond the basemesh")
            for axis, offset in enumerate(to_blender(delta, scale)):
                coords[3 * index + axis] += offset
        add_shape_key(basemesh, key_names[expression], coords)
    for key in EXPRESSION_PROXIES:
        capture_shape_keys(basemesh, proxies[key], key_names.values())


def vertex_group_weights(obj, name):
    """Each vertex's weight in obj's vertex group `name`, 0 if it isn't in the group, as an (N,) array."""
    group = obj.vertex_groups[name].index
    weights = np.zeros(len(obj.data.vertices))
    for vertex in obj.data.vertices:
        for element in vertex.groups:
            if element.group == group:
                weights[vertex.index] = element.weight
    return weights


def head_weights(obj):
    """Each vertex's head weight (HEAD_GROUPS), as an (N,) array."""
    return sum(share * vertex_group_weights(obj, name) for name, share in HEAD_GROUPS.items())


def helper_vertices(basemesh):
    """True for each vertex in a HELPER_GROUPS vertex group: the ones delete_helper_vertices deletes."""
    groups = {basemesh.vertex_groups[name].index for name in HELPER_GROUPS}
    return np.array([any(g.group in groups for g in v.groups) for v in basemesh.data.vertices])


def datablocks():
    """Every datablock in bpy.data."""
    return set(bpy.data.user_map())


def probe(change):
    """The full-topology vertex coordinates (N, 3) of a human made like the base plus `change` (macros
    set, targets loaded at weight 1; see BODY_PROBES), rigged and T-posed like the base and evaluated
    through the depsgraph. Everything the probe adds to bpy.data is deleted again."""
    before = datablocks()
    try:
        basemesh = create_human(change.get("macros"))
        load_targets(basemesh, change.get("targets", ()))
        apply_t_pose(add_rig(basemesh))
        remove_mask_and_subsurf(basemesh)
        evaluated = basemesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        coords = coords_array(evaluated.to_mesh().vertices)
        evaluated.to_mesh_clear()
        if len(coords) != len(basemesh.data.vertices):
            raise RuntimeError(f"probe {change}: evaluated to {len(coords)} vertices, not the full mesh")
    finally:
        bpy.data.batch_remove(datablocks() - before)
    # Checked only once the probe succeeded, so a failing probe's own error is the one reported.
    leftover = datablocks() - before
    if leftover:
        raise RuntimeError(f"probe {change} left {sorted(block.name for block in leftover)} behind")
    return coords


def combine(a, b):
    """The probe change that makes both changes a and b."""
    return {
        "macros": a.get("macros", {}) | b.get("macros", {}),
        "targets": [*a.get("targets", ()), *b.get("targets", ())],
    }


def bake_body_shapes(contract, basemesh):
    """Adds each contract body target as a shape key on the basemesh: its probe's T-posed shape minus the
    base's, head-masked (spec §7). Runs after the expression keys and before delete_helper_vertices, so
    probes and basemesh share vertex indices. Returns base.json's content, measured on the vertices
    that are kept.

    Body morphs never move the head, so each probe is first translated to hold its head where the
    base's is (which also drops MPFB's per-human feet-on-ground offset): the gender macro raises
    MakeHuman's whole upper body ~13 cm, which a mask alone would leave to the neck. A taller body
    then grows downwards, and base.json's lowest-point deltas let the runtime put the feet back on the
    ground."""
    names = contract["bodyTargets"]
    if set(names) != set(BODY_PROBES):
        raise RuntimeError(f"contract body targets {sorted(names)} != probes {sorted(BODY_PROBES)}")
    # base.json reads object-space z as the exported glTF y, which needs the Body at the world origin.
    if not np.allclose(np.array(basemesh.matrix_world), np.eye(4)):
        raise RuntimeError(f"{basemesh.name} is not at the world origin")
    full = coords_array(basemesh.data.vertices)
    kept = ~helper_vertices(basemesh)
    base = full[kept]
    weights = head_weights(basemesh)[kept]
    head = weights >= HEAD_WEIGHT_STILL
    # Wholly head from HEAD_WEIGHT_STILL up: some head vertices carry a trace of neck_01 (w ~ 0.999),
    # and 1 - w of a centimetre-sized delta would still move them.
    mask = head_mask(np.where(head, 1.0, weights))

    def body_delta(change):
        """(the probe's masked delta, how far the probe's head was moved to hold it still)"""
        raw = probe(change)[kept]
        variant = anchored(raw, base, head)
        return masked_delta(variant, base, mask), np.linalg.norm(raw[0] - variant[0])

    error = np.linalg.norm(probe({})[kept] - base, axis=1).max()
    print(f"build_base: unchanged probe vs base: {error:.1e} m")
    if error > PROBE_TOLERANCE_M:
        raise RuntimeError(f"an unchanged probe is {error:.1e} m off the base (> {PROBE_TOLERANCE_M} m)")

    height, lowest = height_and_min(base)
    meta = {"version": 1, "heightM": height, "minY": lowest, "morphHeightDelta": {}, "morphMinYDelta": {}}
    deltas = {}
    for name in names:
        delta, shift = body_delta(BODY_PROBES[name])
        deltas[name] = delta
        coords = full.copy()
        coords[kept] += delta
        add_shape_key(basemesh, name, coords.astype(np.float32).ravel())
        morph_height, morph_lowest = height_and_min(base + delta)
        dh = meta["morphHeightDelta"][name] = morph_height - height
        dmin = meta["morphMinYDelta"][name] = morph_lowest - lowest
        moved = np.linalg.norm(delta, axis=1)
        if not (moved > HEAD_STILL_M).any():
            # A probe that changes nothing: a renamed or mistyped MPFB macro or target would otherwise
            # ship an all-zero morph.
            raise RuntimeError(f"body target {name}: its probe {BODY_PROBES[name]} moves no vertex")
        print(
            f"build_base: {name}: moves {np.count_nonzero(moved > HEAD_STILL_M)} vertices up to "
            f"{moved.max() * 1000:.1f} mm (head held still by {shift * 1000:.1f} mm); "
            f"height {dh * 100:+.2f} cm, lowest point {dmin * 100:+.2f} cm"
        )
    print(f"build_base: {len(names)} body targets")

    for a, b in BODY_CORNERS:
        both, _ = body_delta(combine(BODY_PROBES[a], BODY_PROBES[b]))
        error = np.linalg.norm(deltas[a] + deltas[b] - both, axis=1).max()
        print(f"build_base: corner {a} + {b}: largest error {error * 1000:.1f} mm")
    return meta


def assert_head_still(contract, body):
    """Fails unless every body target moves each vertex with head weight >= HEAD_WEIGHT_STILL by at
    most HEAD_STILL_M (spec §7)."""
    head = head_weights(body) >= HEAD_WEIGHT_STILL
    keys = body.data.shape_keys.key_blocks
    basis = coords_array(keys["Basis"].data)
    for name in contract["bodyTargets"]:
        moved = np.linalg.norm(coords_array(keys[name].data) - basis, axis=1)[head].max()
        if moved > HEAD_STILL_M:
            raise RuntimeError(f"body target {name} moves the head by {moved:.1e} m")
    print(f"build_base: head untouched by body morphs: OK ({np.count_nonzero(head)} head vertices)")


def delete_helper_vertices(basemesh):
    """Deletes the helper and joint-cube vertices with bmesh, which keeps any shape-key layers."""
    helpers = helper_vertices(basemesh)
    mesh = basemesh.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    doomed = [v for v in bm.verts if helpers[v.index]]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for vertex_group in list(basemesh.vertex_groups):
        if vertex_group.name in HELPER_GROUPS:
            basemesh.vertex_groups.remove(vertex_group)
    return len(doomed)


def bone_weights(obj, rig):
    """{bone: (N,) weights} for each of the rig's deform bones that is one of obj's vertex groups."""
    bones = [bone.name for bone in rig.data.bones if bone.use_deform and bone.name in obj.vertex_groups]
    columns = {obj.vertex_groups[name].index: column for column, name in enumerate(bones)}
    weights = np.zeros((len(obj.data.vertices), len(bones)))
    for vertex in obj.data.vertices:
        for element in vertex.groups:
            if element.group in columns:
                weights[vertex.index, columns[element.group]] = element.weight
    return {name: weights[:, column] for column, name in enumerate(bones)}


def uv_faces(mesh):
    """(each polygon's vertex indices, each polygon's UVs in image space), from mesh's only UV map. Blender's
    v points up; image rows, and the glTF exporter's v, point down."""
    if len(mesh.uv_layers) != 1:
        raise RuntimeError(f"{mesh.name}: expected one UV map, found {[uv.name for uv in mesh.uv_layers]}")
    uv = np.empty(2 * len(mesh.loops))
    mesh.uv_layers[0].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * [1, -1] + [0, 1]
    loop_vertices = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", loop_vertices)
    starts = np.empty(len(mesh.polygons), dtype=np.int64)
    totals = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get("loop_start", starts)
    mesh.polygons.foreach_get("loop_total", totals)
    spans = [slice(start, start + total) for start, total in zip(starts, totals, strict=True)]
    return [loop_vertices[span] for span in spans], [uv[span] for span in spans]


def membership(weights, region):
    """Each vertex's soft membership of a region: its summed weight in the vertex groups (bones) that
    bake.REGION_OF_GROUP assigns to it."""
    return sum(column for name, column in weights.items() if REGION_OF_GROUP.get(name) == region)


def joint(rig, bone, end="head"):
    """A rig bone's head or tail in world space, as a (3,) array."""
    return np.array(rig.matrix_world @ getattr(rig.data.bones[bone], f"{end}_local"))


def base_layer_planes(weights, coords, hem_z, rig):
    """The base layer's planes and armholes ({hem_z, waist_z, neck_z, armhole}, bake.garments), from the
    rig's joints and the Body's midlines (WAIST_PELVIS_MAX, NECKLINE_BELOW_M, STRAP_INSIDE_SHOULDER_M,
    ARMHOLE_WIDTH_M, ARMHOLE_DEPTH_M). The front is the way the feet point."""
    x, y, z = coords.T
    front = np.sign((joint(rig, "foot_l", "tail") - joint(rig, "foot_l"))[1])  # MakeHuman faces -y
    if front == 0:
        raise RuntimeError("the left foot points neither forward nor back")
    midline = np.abs(x) <= MIDLINE_M
    midlines = {"front": midline & (y * front > 0), "back": midline & (y * front < 0)}
    spine_02 = (joint(rig, "spine_02")[2], joint(rig, "spine_02", "tail")[2])
    waist_z, pelvis = waist_plane(
        spine_02, [(z[side], weights["pelvis"][side]) for side in midlines.values()], WAIST_PELVIS_MAX
    )
    neck = z[midlines["front"] & (weights["neck_01"] + weights["head"] >= 0.5)]
    if len(neck) == 0:
        raise RuntimeError("the Body's front midline has no neck-weighted vertex")
    shoulders = np.array([joint(rig, "upperarm_l"), joint(rig, "upperarm_r")])
    shoulder_x, shoulder_z = np.abs(shoulders[:, 0]).mean(), shoulders[:, 2].mean()
    armhole = {
        "strap_x": float(shoulder_x - STRAP_INSIDE_SHOULDER_M),
        "curve_z": float(shoulder_z),
        "width": ARMHOLE_WIDTH_M,
        "depth": ARMHOLE_DEPTH_M,
    }
    planes = {"hem_z": hem_z, "waist_z": waist_z, "neck_z": float(neck.min() - NECKLINE_BELOW_M)}
    if not planes["hem_z"] < planes["waist_z"] < armhole["curve_z"] - ARMHOLE_DEPTH_M < planes["neck_z"]:
        raise RuntimeError(f"base-layer planes out of order: {planes}, armholes {armhole}")
    print(
        f"build_base: base layer waist at z {waist_z:.3f} m (midway along spine_02; midline pelvis weight "
        f"there front {pelvis[0]:.3f}, back {pelvis[1]:.3f}), neckline at z {planes['neck_z']:.3f} m "
        f"(front-midline neck weight 0.5 at {neck.min():.3f} m); armholes from the shoulder joints "
        f"(|x| {shoulder_x:.3f} m, z {shoulder_z:.3f} m): strap edge at |x| {armhole['strap_x']:.3f} m, "
        f"level bottom at z {shoulder_z - ARMHOLE_DEPTH_M:.3f} m"
    )
    return planes | {"armhole": armhole}


def bake_maps(contract, body, rig, work):
    """Writes <work>/regions.png (R = region code, REGIONS_SIZE²) in the Body's UV layout: each vertex
    takes its dominant bone's region, each face its vertices' majority (bake.py). <work>/baselayer.png
    (undershirt and shorts, BASE_LAYER_SIZE² RGBA), classified per supersample from each vertex's x and
    height and its torso, pelvis, thigh, neck and upper-arm membership, interpolated over the faces, and
    filtered within each UV island (bake.base_layer). And
    <work>/coverage.png (R = 255 where a face covers the texel, BASE_LAYER_SIZE², the Skin texture's
    size): build-base.ts neutralises the skin on those texels only, not on the UV gutter."""
    if contract["regions"] != REGION_CODES:
        raise RuntimeError(f"contract regions {contract['regions']} != bake.py's {REGION_CODES}")
    weights = bone_weights(body, rig)
    coords = coords_array(body.data.vertices)
    crotch = coords[(weights["pelvis"] > 0) & (np.abs(coords[:, 0]) <= MIDLINE_M), 2]
    if len(crotch) == 0:
        raise RuntimeError(f"{body.name}: no midline vertex in the pelvis group")
    hem_z = crotch.min() - HEM_BELOW_CROTCH_M
    vertex_codes = classify_regions(weights, coords[:, 2], hem_z)
    faces, uvs = uv_faces(body.data)
    face_codes = face_regions(vertex_codes, faces)
    counts = np.bincount(face_codes, minlength=len(REGION_CODES) + 1)
    names = {code: region for region, code in REGION_CODES.items()} | {0: "never hidden"}
    print(
        f"build_base: hem at z {hem_z:.3f} m (crotch {crotch.min():.3f} m); faces per region: "
        + ", ".join(f"{names[code]} {count}" for code, count in enumerate(counts))
    )

    def region_map(size):
        # Faces as code + 1, so that 0 is a pixel no face covers and every island (region 0's too) grows.
        ids = widen(rasterise(uvs, face_codes + 1, size), MAP_MARGIN_PX[size])
        return np.maximum(ids.astype(np.int16) - 1, 0).astype(np.uint8)

    regions = np.zeros((REGIONS_SIZE, REGIONS_SIZE, 3), dtype=np.uint8)
    regions[..., 0] = region_map(REGIONS_SIZE)
    (work / "regions.png").write_bytes(png_bytes(regions))

    planes = base_layer_planes(weights, coords, hem_z, rig)
    worn_over = ("torso", "pelvis", "thighs", "neck", "upperArms")
    per_vertex = np.column_stack([coords[:, 0], coords[:, 2], *(membership(weights, r) for r in worn_over)])
    colours = {UNDERSHIRT: UNDERSHIRT_RGB, SHORTS: SHORTS_RGB}
    islands = uv_islands(faces, uvs)
    layer, covered = base_layer(
        uvs, [per_vertex[face] for face in faces], BASE_LAYER_SIZE, planes, colours, islands
    )
    alpha = layer[..., 3]
    print(
        f"build_base: base layer texels: {np.count_nonzero(alpha == 255)} clothed, "
        f"{np.count_nonzero((alpha > 0) & (alpha < 255))} antialiased; {islands.max() + 1} UV islands"
    )
    layer = widen_into(layer, covered, MAP_MARGIN_PX[BASE_LAYER_SIZE])
    (work / "baselayer.png").write_bytes(png_bytes(layer))

    coverage = np.zeros((BASE_LAYER_SIZE, BASE_LAYER_SIZE, 3), dtype=np.uint8)
    coverage[..., 0] = rasterise(uvs, np.full(len(uvs), 255), BASE_LAYER_SIZE)
    (work / "coverage.png").write_bytes(png_bytes(coverage))
    print(f"build_base: wrote {work / 'regions.png'}, {work / 'baselayer.png'} and {work / 'coverage.png'}")


def read_png(path):
    """An image file's pixels as a (rows, columns, 4) uint8 array, row 0 at the top."""
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
    finally:
        bpy.data.images.remove(image)
    # Blender stores rows bottom-up; a byte image's pixels are its bytes / 255.
    return np.flipud(np.round(pixels.reshape(height, width, 4) * 255).astype(np.uint8))


def write_eye_textures(work):
    """Writes <work>/eyes/<preset>.png for each EYE_PRESETS entry: its MakeHuman eye texture, with the iris
    darkened where the preset says so."""
    materials = mpfb_data() / "eyes" / "materials"
    out = work / "eyes"
    out.mkdir(exist_ok=True)
    for preset, (texture, value) in EYE_PRESETS.items():
        source = materials / f"{texture}_eye.png"
        if value == 1.0:
            shutil.copyfile(source, out / f"{preset}.png")
            continue
        rgba = read_png(source)
        if rgba.shape[0] != rgba.shape[1]:
            raise RuntimeError(f"{source.name}: expected a square texture, got {rgba.shape[1::-1]}")
        iris = disc_weights(rgba.shape[0], IRIS_CENTRES, IRIS_RADIUS, IRIS_FEATHER)
        (out / f"{preset}.png").write_bytes(png_bytes(darken(rgba, iris, value)))
    print(f"build_base: wrote {len(EYE_PRESETS)} eye textures to {out}")


def single_material(obj):
    materials = [slot.material for slot in obj.material_slots if slot.material]
    if len(materials) != 1:
        raise RuntimeError(f"{obj.name}: expected one material, found {[m.name for m in materials]}")
    return materials[0]


def rename(contract, basemesh, proxies):
    """Names objects, meshes and materials per the contract: the body mesh, and each proxy after its
    material (Eyes, Brows, ...)."""
    basemesh.name = basemesh.data.name = contract["bodyMesh"]
    single_material(basemesh).name = contract["materials"]["skin"]
    for key, obj in proxies.items():
        name = contract["materials"][key]
        obj.name = obj.data.name = name
        single_material(obj).name = name


def principled(material):
    nodes = [n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
    if len(nodes) != 1:
        raise RuntimeError(f"material {material.name}: expected one Principled BSDF, found {len(nodes)}")
    return nodes[0]


def make_opaque(material):
    """Unlinks the texture alpha from Principled Alpha so the glTF exporter writes alphaMode OPAQUE."""
    alpha = principled(material).inputs["Alpha"]
    for link in list(alpha.links):
        material.node_tree.links.remove(link)
    alpha.default_value = 1.0


def make_alpha_clip(material):
    """Routes the texture alpha through Math GREATER_THAN 0.5, which the glTF exporter (Blender 4.2+)
    writes as alphaMode MASK with the default cutoff."""
    tree = material.node_tree
    alpha = principled(material).inputs["Alpha"]
    if not alpha.links:
        raise RuntimeError(f"material {material.name}: Alpha has no texture link to clip")
    source = alpha.links[0].from_socket
    tree.links.remove(alpha.links[0])
    clip = tree.nodes.new("ShaderNodeMath")
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.5
    tree.links.new(source, clip.inputs[0])
    tree.links.new(clip.outputs[0], alpha)


def set_alpha_modes(contract, basemesh, proxies):
    """GAMEENGINE links every texture's alpha to Principled Alpha (exported as BLEND): the contract's
    masked materials get an alpha clip, everything else is made opaque."""
    make_opaque(single_material(basemesh))
    for obj in proxies.values():
        material = single_material(obj)
        if material.name in contract["maskedMaterials"]:
            make_alpha_clip(material)
        else:
            make_opaque(material)


def snake_case(name):
    """A VRM camelCase name (leftUpperArm, blinkLeft) as the VRM add-on's property name (left_upper_arm)."""
    return "".join("_" + c.lower() if c.isupper() else c for c in name)


def setup_vrm(rig):
    """VRM 1.0 humanoid (rest pose = the baked T-pose) and meta on the rig."""
    ext = rig.data.vrm_addon_extension
    ext.spec_version = "1.0"  # first: its update callback clears expression binds and previews
    bones = rig.data.bones
    human_bones = ext.vrm1.humanoid.human_bones
    for bone_name, vrm_bone in GAME_ENGINE_TO_VRM.items():
        if bone_name not in bones:
            raise RuntimeError(f"rig {RIG} has no bone {bone_name} (for VRM {vrm_bone})")
        getattr(human_bones, snake_case(vrm_bone)).node.bone_name = bone_name
    ext.vrm1.humanoid.pose = "restPositionPose"
    meta = ext.vrm1.meta
    meta.vrm_name = VRM_NAME
    meta.version = "1"  # base.json version
    meta.authors.clear()
    meta.authors.add().value = VRM_AUTHOR


def bind_expressions(contract, rig, meshes):
    """Binds each contract expression's VRM preset to its shape key, at weight 1, on every mesh that has
    the key. Runs after setup_vrm sets the spec version, which clears expression binds."""
    presets = rig.data.vrm_addon_extension.vrm1.expressions.preset
    for expression, key_name in contract["expressionTargets"].items():
        binds = getattr(presets, snake_case(expression)).morph_target_binds
        for obj in meshes:
            if obj.data.shape_keys and key_name in obj.data.shape_keys.key_blocks:
                bind = binds.add()
                bind.node.bpy_object = obj
                bind.index = key_name
                bind.weight = 1.0


def export_vrm(rig, path):
    activate(rig)
    # The validator logs each error itself; the export below refuses to run if there are any.
    validated = bpy.ops.vrm.model_validate(armature_object_name=rig.name, show_successful_message=False)
    print(f"build_base: VRM validation {validated}")
    result = bpy.ops.export_scene.vrm(filepath=str(path), armature_object_name=rig.name)
    if result != {"FINISHED"}:
        raise SystemExit(f"build_base: VRM export {result}")


def main():
    args = parse_args()
    require_toolchain()
    contract = json.loads(args.contract.read_text())
    args.work.mkdir(parents=True, exist_ok=True)

    clear_scene()
    basemesh = create_human()
    set_skin(basemesh)
    rig = add_rig(basemesh)
    proxies = add_proxies(basemesh)
    meshes = [basemesh, *proxies.values()]

    apply_t_pose(rig)
    bake_pose_as_rest(rig, meshes)
    bake_expressions(contract, basemesh, proxies)
    meta = bake_body_shapes(contract, basemesh)
    removed = delete_helper_vertices(basemesh)
    print(f"build_base: removed {removed} helper vertices")
    assert_head_still(contract, basemesh)
    bake_maps(contract, basemesh, rig, args.work)
    write_eye_textures(args.work)

    rename(contract, basemesh, proxies)
    set_alpha_modes(contract, basemesh, proxies)
    setup_vrm(rig)
    bind_expressions(contract, rig, meshes)
    export_vrm(rig, args.work / "base.vrm")
    print(f"build_base: wrote {args.work / 'base.vrm'}")
    (args.work / "base.json").write_text(json.dumps(meta, indent=2))
    print(f"build_base: wrote {args.work / 'base.json'}")


main()
