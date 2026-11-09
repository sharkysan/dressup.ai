# Source assets

Inputs to the asset pipeline (`npm run assets`). The realistic base is built by `npm run assets:base`
(Blender, see `tools/blender`) and needs nothing here. Licences for third-party files are listed in
`../LICENSES.md`.

## Layout

```
assets/source/
└── hair/<hairId>/
    ├── meta.json    { "id", "name", "tags": { length, volume, bangs, parting }, "license" }
    └── ...          hairstyle source (none shipped yet; the catalog's hair list is empty)
```
