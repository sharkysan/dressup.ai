# Source assets

Inputs to the asset pipeline (`npm run assets`). The realistic base is built by `npm run assets:base`
(Blender, see `tools/blender`) from MakeHuman assets downloaded into `.blender/`; it needs nothing
here. Licences for third-party files are listed in `../LICENSES.md`.

Hair sources return in M3. Until then only the catalog reads this directory, and its hair list is empty.

## Layout

```
assets/source/
└── hair/<hairId>/
    ├── meta.json    { "id", "name", "tags": { length, volume, bangs, parting }, "license" }
    └── ...          hairstyle source (none shipped yet)
```
