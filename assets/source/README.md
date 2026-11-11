# Source assets

Inputs to the asset pipeline (`npm run assets`). The realistic base is built by `npm run assets:base`
(Blender, see `tools/blender`) from MakeHuman assets downloaded into `.blender/`; all it reads from
here is MediaPipe's canonical face model, `mediapipe/face_model_with_iris.obj`, for the correspondence
data (`public/assets/base/correspondence.json`). The test fixtures read it too. Licences for
third-party files are listed in `../LICENSES.md`.

The hairstyles are MakeHuman's ten CC0 stock hairstyles. Their geometry and textures come from MPFB at
build time: `npm run assets:base` fits each to the base, exports it skinned to the base's rig with the
body targets, and writes `public/assets/hair/<id>.glb`. All this directory holds for each is its catalog
sidecar, `hair/<id>/meta.json`, which `npm run assets:catalog` reads (the `license` stays out of the
catalog).

## Layout

```
assets/source/
├── hair/<hairId>/
│   └── meta.json    { "id", "name", "tags": { length, volume, bangs, parting }, "license" }
└── mediapipe/
    └── face_model_with_iris.obj    MediaPipe's canonical face (478 points, cm), Apache-2.0
```
