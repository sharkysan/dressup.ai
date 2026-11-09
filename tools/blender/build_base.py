"""Builds the realistic base avatar (spec §4, §7) headlessly and exports it as VRM 1.0.

    tools/blender/run.sh tools/blender/build_base.py -- --contract <contract.json> --work <dir>

Writes <work>/base.vrm: a MakeHuman (MPFB) female in a T-pose, game_engine rig, GAMEENGINE (plain PBR)
materials, eyes, brows, lashes, teeth and tongue, the VRM expressions happy, relaxed, surprised and
blinkLeft baked from faceunits01 (targets.py), the body-shape shape keys baked from MakeHuman probes
(bake.py), every object and material named per the contract that tools/build-base.ts writes from
src/avatar/baseContract.ts. Writes <work>/base.json: the Body's height and lowest point, and how much
each body target changes them (baseMetaSchema). Exits 1 if any step or the export fails.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bake import anchored, head_mask, height_and_min, masked_delta  # noqa: E402
from mpfb import mpfb_service, require_toolchain  # noqa: E402
from targets import EXPRESSION_RECIPES, mix, parse_target, to_blender  # noqa: E402

# Young adult female, the deepest of MPFB's light skins (MPFB ships only light and dark young female
# skins; Task 6 neutralises the texture so the runtime tint sets the tone).
SKIN_MHMAT = "young_caucasian_female2"
# The base's macros over MPFB's defaults (0.5 each): gender 0, female.
BASE_MACROS = {"gender": 0.0}
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
    """The MakeHuman basemesh: MPFB's default macros with BASE_MACROS, then `macros`, in metres, feet on
    the ground."""
    macros = mpfb_service("TargetService").get_default_macro_info_dict() | BASE_MACROS | (macros or {})
    return mpfb_service("HumanService").create_human(scale=0.1, macro_detail_dict=macros)


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
        targets = Path(mpfb_service("LocationService").get_mpfb_data("targets"))
        for target in change.get("targets", ()):
            path = targets / f"{target}.target.gz"
            mpfb_service("TargetService").load_target(basemesh, str(path), weight=1.0)
        apply_t_pose(add_rig(basemesh))
        remove_mask_and_subsurf(basemesh)
        evaluated = basemesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        coords = coords_array(evaluated.to_mesh().vertices)
        evaluated.to_mesh_clear()
        if len(coords) != len(basemesh.data.vertices):
            raise RuntimeError(f"probe {change}: evaluated to {len(coords)} vertices, not the full mesh")
        return coords
    finally:
        bpy.data.batch_remove(datablocks() - before)
        leftover = datablocks() - before
        if leftover:
            raise RuntimeError(f"probe {change} left {sorted(block.name for block in leftover)} behind")


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

    rename(contract, basemesh, proxies)
    set_alpha_modes(contract, basemesh, proxies)
    setup_vrm(rig)
    bind_expressions(contract, rig, meshes)
    export_vrm(rig, args.work / "base.vrm")
    print(f"build_base: wrote {args.work / 'base.vrm'}")
    (args.work / "base.json").write_text(json.dumps(meta, indent=2))
    print(f"build_base: wrote {args.work / 'base.json'}")


main()
