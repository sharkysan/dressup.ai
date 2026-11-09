"""MakeHuman .target files and the expression recipes mixed from faceunits01 (pure Python, no bpy).

A .target line is `index dx dy dz`: a vertex of the full MakeHuman basemesh (helpers included) and its
offset in MakeHuman space (Y up, character's left +X, decimetres at scale 1).
"""

# Expression (src/avatar/baseContract.ts EXPRESSION_TARGETS) -> {faceunits01 unit: weight}.
EXPRESSION_RECIPES = {
    "happy": {
        "mouthSmileLeft": 0.8,
        "mouthSmileRight": 0.8,
        "cheekSquintLeft": 0.4,
        "cheekSquintRight": 0.4,
        "eyeSquintLeft": 0.2,
        "eyeSquintRight": 0.2,
    },
    "relaxed": {
        "mouthSmileLeft": 0.3,
        "mouthSmileRight": 0.3,
        "eyeBlinkLeft": 0.25,
        "eyeBlinkRight": 0.25,
        "browInnerUp": 0.1,
    },
    "surprised": {
        "browInnerUp": 0.7,
        "browOuterUpLeft": 0.6,
        "browOuterUpRight": 0.6,
        "eyeWideLeft": 0.8,
        "eyeWideRight": 0.8,
        # Tuned down from 0.35: jawOpen drops the basemesh's lower-teeth helper, and the tips of the
        # upper teeth, which rest on it, go down with it while their roots stay put. A wider jaw
        # stretches the upper teeth into points.
        "jawOpen": 0.1,
    },
    "blinkLeft": {"eyeBlinkLeft": 1.0},
}


def parse_target(text):
    """{vertex index: (dx, dy, dz)} from a .target file's text; blank and `#` lines are skipped."""
    deltas = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        index, dx, dy, dz = line.split()
        deltas[int(index)] = (float(dx), float(dy), float(dz))
    return deltas


def to_blender(delta, scale):
    """A MakeHuman-space offset in Blender space (Z up, -Y forward) at the basemesh's scale, as MPFB's
    TargetService converts it."""
    x, y, z = delta
    return (x * scale, -z * scale, y * scale)


def mix(targets, recipe):
    """The weighted sum {vertex index: (dx, dy, dz)} of the units named in recipe ({unit: weight})."""
    mixed = {}
    for unit, weight in recipe.items():
        for index, (dx, dy, dz) in targets[unit].items():
            x, y, z = mixed.get(index, (0.0, 0.0, 0.0))
            mixed[index] = (x + weight * dx, y + weight * dy, z + weight * dz)
    return mixed
