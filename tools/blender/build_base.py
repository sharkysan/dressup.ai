"""Builds the realistic base avatar (spec §4, §7) headlessly and exports it as VRM 1.0.

    tools/blender/run.sh tools/blender/build_base.py -- --contract <contract.json> --work <dir>

Writes <work>/base.vrm: a MakeHuman (MPFB) female in a T-pose, game_engine rig, GAMEENGINE (plain PBR)
materials, eyes, brows, lashes, teeth and tongue, the VRM expressions happy, relaxed, surprised and
blinkLeft baked from faceunits01 (targets.py), every object and material named per the contract that
tools/build-base.ts writes from src/avatar/baseContract.ts. Exits 1 if any step or the export fails.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mpfb import mpfb_service, require_toolchain  # noqa: E402
from targets import EXPRESSION_RECIPES, mix, parse_target, to_blender  # noqa: E402

# Young adult female, the deepest of MPFB's light skins (MPFB ships only light and dark young female
# skins; Task 6 neutralises the texture so the runtime tint sets the tone).
SKIN_MHMAT = "young_caucasian_female2"
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


def create_human():
    """The MakeHuman basemesh: default macros with gender 0 (female), in metres, feet on the ground."""
    HumanService = mpfb_service("HumanService")
    TargetService = mpfb_service("TargetService")
    macros = TargetService.get_default_macro_info_dict()
    macros["gender"] = 0.0
    basemesh = HumanService.create_human(scale=0.1, macro_detail_dict=macros)
    skin = mpfb_data() / "skins" / SKIN_MHMAT / f"{SKIN_MHMAT}.mhmat"
    HumanService.set_character_skin(str(skin), basemesh, skin_type="GAMEENGINE")
    return basemesh


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


def bake_pose_as_rest(rig, meshes):
    """Makes the current (T-)pose the rest pose: meshes keep their posed shape with no shape keys and
    only an Armature modifier, and the rig's rest matches it."""
    for obj in meshes:
        activate(obj)
        if obj.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for modifier in list(obj.modifiers):
            if modifier.type in ("MASK", "SUBSURF"):
                obj.modifiers.remove(modifier)
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


def delete_helper_vertices(basemesh):
    """Deletes the helper and joint-cube vertices with bmesh, which keeps any shape-key layers."""
    groups = {basemesh.vertex_groups[name].index for name in HELPER_GROUPS}
    mesh = basemesh.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    deform = bm.verts.layers.deform.verify()
    doomed = [v for v in bm.verts if any(g in v[deform] for g in groups)]
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
    rig = add_rig(basemesh)
    proxies = add_proxies(basemesh)
    meshes = [basemesh, *proxies.values()]

    apply_t_pose(rig)
    bake_pose_as_rest(rig, meshes)
    bake_expressions(contract, basemesh, proxies)
    removed = delete_helper_vertices(basemesh)
    print(f"build_base: removed {removed} helper vertices")

    rename(contract, basemesh, proxies)
    set_alpha_modes(contract, basemesh, proxies)
    setup_vrm(rig)
    bind_expressions(contract, rig, meshes)
    export_vrm(rig, args.work / "base.vrm")
    print(f"build_base: wrote {args.work / 'base.vrm'}")


main()
