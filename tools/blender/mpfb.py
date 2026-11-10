"""Helpers for Blender scripts run through tools/blender/run.sh.

    sys.path.insert(0, <tools/blender>)
    from mpfb import mpfb_service, require_toolchain

MPFB is installed as the Blender extension bl_ext.<repo>.mpfb; its services are looked up by module name
(the pattern from MPFB's script_samples), so scripts never hard-code the extension repository.
"""

import os
import sys
import tomllib
from pathlib import Path

import bpy

SETUP_HINT = "run `npm run blender:setup`"


def _pins():
    """The KEY=value pins of versions.env, next to this file."""
    pins = {}
    for line in (Path(__file__).resolve().parent / "versions.env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            pins[key.strip()] = value.strip()
    return pins


def _version_tuple(version):
    return tuple(int(part) for part in version.split("."))


def _extension(package_id):
    """The loaded add-on module bl_ext.<repo>.<package_id>, or None."""
    for name, module in sys.modules.items():
        if name.startswith("bl_ext.") and name.count(".") == 2 and name.endswith("." + package_id):
            return module
    return None


def _extension_version(package_id):
    """The version of a loaded extension, read from its blender_manifest.toml, or None."""
    module = _extension(package_id)
    if module is None:
        return None
    manifest = Path(module.__file__).parent / "blender_manifest.toml"
    return tomllib.loads(manifest.read_text())["version"]


def mpfb_service(name):
    """The MPFB service `name` (e.g. 'HumanService') from bl_ext.<repo>.mpfb.services.<name lowercased>."""
    suffix = "mpfb.services." + name.lower()
    for module_name, module in sys.modules.items():
        if module_name.endswith(suffix):
            return getattr(module, name)
    raise LookupError(f"MPFB service {name} is not loaded (no module *.{suffix}) — {SETUP_HINT}")


def _missing(piece, hint=SETUP_HINT):
    print(f"blender toolchain: {piece} — {hint}", file=sys.stderr)
    raise SystemExit(1)


def _env_dir(name):
    """A directory named by an env var that run.sh (env.sh) sets."""
    value = os.environ.get(name)
    if not value:
        _missing(f"${name} is not set", "run Blender scripts through tools/blender/run.sh")
    return Path(value)


def require_toolchain():
    """Checks the pinned toolchain is in place; prints the first missing piece and exits 1 if not."""
    pins = _pins()
    blender = _version_tuple(pins["BLENDER_VERSION"])[:2]
    if bpy.app.version[:2] != blender:
        _missing(f"Blender {pins['BLENDER_VERSION']} is required, this is {bpy.app.version_string}")

    mpfb_version = _extension_version("mpfb")
    if mpfb_version != pins["MPFB_VERSION"]:
        found = f"found {mpfb_version}" if mpfb_version else "not installed or not enabled"
        _missing(f"MPFB {pins['MPFB_VERSION']} add-on is missing ({found})")

    # bpy.ops.export_scene.<anything> resolves lazily, so ask the operator registry instead.
    if "vrm" not in dir(bpy.ops.export_scene):
        _missing(f"VRM add-on {pins['VRM_VERSION']} is missing (no bpy.ops.export_scene.vrm)")

    skins = _env_dir("MPFB_DATA") / "skins"
    if not any(skins.rglob("*.mhmat")):
        _missing(f"MakeHuman system assets are missing (no .mhmat under {skins})")

    blink = _env_dir("FACEUNITS_DIR") / "eyeBlinkLeft.target"
    if not blink.is_file():
        _missing(f"faceunits01 is missing (no {blink})")


def toolchain_versions():
    """The running Blender's version and the loaded MPFB and VRM add-on versions, as strings."""
    return {
        "blender": ".".join(str(part) for part in bpy.app.version),
        "mpfb": _extension_version("mpfb"),
        "vrm": _extension_version("vrm"),
    }
