# Source assets

Inputs to the asset pipeline (`npm run assets`). Binary files here are git-ignored; only `meta.json`
sidecars are committed. Licences for every third-party file are listed in `../LICENSES.md`.

## Layout

```
assets/source/
├── base-<id>/
│   ├── meta.json              { "id": "a" | "b", "name": "...", "license": "..." }
│   ├── neutral.vrm            the base avatar as exported from VRoid Studio (VRM 1.0 preferred; 0.x works)
│   └── morphs/
│       ├── faceWidth.min.vrm  same character exported at the slider's minimum — identical topology to neutral.vrm
│       ├── faceWidth.max.vrm  ... and maximum
│       └── <param>.{min,max}.vrm for each of: faceWidth jawWidth chinLength noseWidth noseLength eyeSpacing eyeSize lipFullness
└── hair/<hairId>/
    ├── meta.json              { "id", "name", "base", "tags": { length, volume, bangs, parting }, "license" }
    └── source.vrm             any VRoid VRM; its hair meshes are extracted and bound to the head
```

## Rules

- Morph variants must share topology with `neutral.vrm` (same vertex counts per primitive). VRoid keeps
  topology constant across sliders; Blender edits must not add or remove vertices. The build fails loudly otherwise.
- `npm run assets:synth` fakes variants for development only; never ship synthetic morphs.
- Hair sources must come from the same base family as the body (VRoid exports for the VRoid bases): a hairstyle is
  bound to the head in its _source_ model's head-local space, and other tools use different rest-pose conventions,
  so hair transplanted from a non-VRoid model lands misaligned (see `hair_seed_01`, kept only to test detection).
  Textures are converted to greyscale and tinted at runtime.
