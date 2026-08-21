# Item Move Studio – GBX → IR → GBX

Client-side editor for Trackmania `*.Item.Gbx` moving items.

**Live:** https://giuliojiang.github.io/itemgbxeasing/

## Flow

1. **Load** `Item.Gbx` → auto-extracts mover + mesh, generates IR JSON
2. **Edit IR** – paste modified JSON from any AI, press **Check** → validates + live 3D preview
3. **Export** → new `Item.Gbx` (BUUR uncompressed, loads in game)

No server, no workers – pure ES modules, works on GitHub Pages.

## IR v1 – `ItemAnimIR`

```json
{
  "irVersion": 1,
  "source": {
    "fileName": "zzz_RotBalloons.Item.Gbx",
    "classId": "0x2E002000",
    "decompressedSize": 256590,
    "moverOffset": 143887,
    "originalMover": { "ver":2, "rotP":4000, "transP":2500, "transY":1.5, "axis":1, "rotMax":4000, "transMax":2500, "rotFunc":0, "rotAng":1.57 }
  },
  "animations": [
    {
      "id": "float_1",
      "target": "self",
      "property": "translation",
      "axis": "y",
      "from": 0,
      "to": 1.5,
      "durationMs": 2500,
      "delayMs": 0,
      "easing": "easeInOut",
      "loop": "pingPong",
      "description": "Up/down float"
    },
    {
      "id": "spin_1",
      "target": "self",
      "property": "rotation",
      "axis": "y",
      "from": 0,
      "to": 1.57,
      "durationMs": 4000,
      "delayMs": 0,
      "easing": "linear",
      "loop": "restart",
      "description": "Y-axis spin"
    }
  ],
  "composition": { "mode": "parallel", "note": "parallel = Promise.all, sequence = chain with delays like Web Animations API" },
  "baking": { "strategy": "maxDuration", "notes": "Game only has 1 loop. We bake animations into RotPeriod/TransPeriod/TransY/RotAngle by taking max duration per property" }
}
```

### AI prompt snippet

> You are editing `ItemAnimIR v1`. It's Web Animations API style:
> - `property`: `translation` or `rotation`
> - `axis`: `x|y|z`
> - `from`/`to`: numbers (meters or radians)
> - `durationMs`, `delayMs`: ms
> - `easing`: `linear|easeInOut|easeIn|easeOut|spring|bounce`
> - `loop`: `restart` (spin) or `pingPong` (float)
> - `composition.mode`: `parallel` (all together) or `sequence` (chain)
> - Game bakes to: `TransPeriod = max(translation duration)`, `RotPeriod = max(rotation duration)`, `TransY = max(|to-from|)`, `RotAngle = first rotation delta`, `Axis = first rotation axis`
> - Keep `from` 0 for simplicity, vary `to` and `durationMs`.
> - Return valid JSON only.

## Modules

- `lzo.js` – minilzo decompress (ES module)
- `gbx.js` – parse GBX header/body boundary, find mover, patch, build BUUR
- `mesh.js` – heuristic mesh extract (float3 verts + ib), fallback proxy
- `ir.js` – `gbxToIR`, `irToMover`
- `validator.js` – JSON schema + semantic checks
- `preview.js` – `sampleIR(ir, tMs)` → `{transY, rot, axis}`
- `app.js` – file load, Three.js scene, OrbitControls, timeline

## Real mesh

We try to extract `CPlugSolid2Model` (`0x090BB000`) / `CPlugCrystal` (`0x09003000`) vertex data. If heuristic fails (e.g., Duck), we show icosahedron proxy but still allow IR editing/export.

## Known limits

- Mover detection is heuristic – some items use older `CPlugDynaObjectModel` + `NPlugDynaObjectModel_SInstanceParams` where mover is not `CPlugAnimLocSimple`. We fallback to synthetic offset so IR still works; export patches that offset and builds valid BUUR.
- GBX.NET 2.4.4 fails on these files (`Unknown class ID: 0xFFFFFFFF` in `CPlugSurface`/`CPlugPrefab`), so we stay pure JS.

## Dev

```bash
python3 -m http.server 8000
# open http://localhost:8000
```
