# Item Move Studio — IR Plan (JSON intermediate language)

## Goal
Make moving Trackmania items editable by humans *and* by other AI agents without touching binary GBX.

We want:
1. `Item.Gbx -> IR`  (parse)
2. `IR (pasted/modified) -> Validate + 3D preview` on Check
3. `IR -> Item.Gbx` (export)

IR doesn't need to be pretty for humans — it needs to be obvious for an LLM that it's "standard web animation stuff".

---

## 1. What we learned about GBX

- GBX Item is `BUCR` (Binary U ref / C body). Body is LZO compressed.
- Decompressed body starts with collector chunks, then `CGameItemModel` chunks.
- Mover lives in `CGameCommonItemEntityModelEdition` (`0x2E026000`) field `U05` which is a `CPlugAnimLocSimple` (`0x090F8000`).
- Struct (from gbx-net):

```
int version (0..3)
int RotPeriod
int TransPeriod
float TransY
int Axis (0=X,1=Y,2=Z)  // v1+
int RotPeriodMax
int TransPeriodMax      // v2+
byte RotFunc            // v3+ 0=linear 1=smooth etc
float RotAngle
```

Some items have 0 movers (static). Most have 1. We treat 1 as canonical; array for future.

Game loops these two oscillators forever. That's it. No keyframe list in GBX — we simulate chaining by baking.

**Mesh / actual model** — Item.Gbx also embeds the visual mesh we need for real preview:
- `CGameItemModel` chunk `0x2E00200C` holds Mesh crystal reference (`CPlugCrystal` / `CPlugSolid2Model` `0x09003000` family)
- Crystal -> `0x09005000` Layers -> Surfaces -> `CPlugSurface` with vertex buffer (float3 pos, float3 normal, float2 uv), index buffer (uint16/32 tris)
- Materials are `CPlugMaterial` / `CPlugShader` refs in aux nodes `0x0901E000`, `0x09006000`
- We do NOT need full material graph for preview — we render geometry with neutral `MeshStandardMaterial` + optional vertex colors, fallback wireframe if parse fails
- Samples: `zzz_RotBalloons` ~few k verts, `MovingDuck` larger, `SantaRotating` medium — all should be extractable client-side without GBX.NET

---

## 2. IR Design — `ItemAnimIR v1`

File is pure JSON. One object, top-level keys self-describing.

```json
{
  "irVersion": 1,
  "source": {
    "fileName": "zzz_RotBalloons.Item.Gbx",
    "classId": "0x2E002000",
    "decompressedSize": 256590,
    "moverOffset": 1247,
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
  "composition": {
    "mode": "parallel",
    "note": "parallel = Promise.all, sequence = chain with delays like Web Animations API"
  },
  "baking": {
    "strategy": "maxDuration",
    "notes": "Game only has 1 loop. We bake animations into RotPeriod/TransPeriod/TransY/RotAngle by taking max duration per property"
  }
}
```

### Why this is LLM-friendly
- Uses Web Animations API vocabulary: `property`, `from`, `to`, `durationMs`, `delayMs`, `easing`, `loop`
- `axis` as string not int — `x/y/z` obvious
- `id` + `description` for agent to reason
- `composition.mode` = `parallel` | `sequence` — maps to `Promise.all` vs `await`
- Easing limited to `linear | easeInOut | easeIn | easeOut | spring | bounce` — all map to our `RotFunc` + sin.

We keep `source.originalMover` so export can diff and so agent knows what game actually supports.

### Easing mapping to GBX
- `linear` -> RotFunc 0
- `easeInOut` -> RotFunc 1
- `spring` -> RotFunc 2
- `bounce` -> RotFunc 3 (we clamp)

Loop:
- `restart` = 0->to->0 loop
- `pingPong` = 0->to->0->to (we model via sin for translation)

---

## 3. Conversions

### GBX -> IR
1. Parse header, decompress body via `lzo.js`
2. Scan for mover candidate (existing findMover). If none, animations=[]
3. Build 1 or 2 animation entries from mover fields.
4. Emit IR JSON.

### IR -> GBX
1. Validate IR (schema + semantic)
2. Compute baked mover:
   - `TransPeriod = max(durationMs of translation anims)`
   - `RotPeriod = max(durationMs of rotation anims)`
   - `TransY = max(|to-from| of translation)`
   - `RotAngle = first rotation to-from` (or sum if parallel)
   - `Axis = first rotation axis`
   - `RotFunc = easing->int`
3. Patch decompressed body at `moverOffset`
4. Rebuild GBX as BUUR (uncompressed) — game loads it. Recompression optional later via GBX.NET CLI.

We keep `moverOffset` from source; if IR comes from elsewhere without offset, we rescan target GBX to find slot.

---

## 4. Modules

```
index.html   — shell UI
lzo.js       — decompress (already works)
gbx.js       — parseGBX, findMover, patchMover, buildBUUR, parseHeader
mesh.js      — parseCrystal / parseSolid2Model -> { geometries: BufferGeometryDesc[], materials: [] }
               pure JS, no GBX.NET. Walks aux nodes after 0x2E002019 to find 0x09005000 / 0x09003000 / 0x0900C000
               returns { positions: Float32Array, normals, uvs, indices, hasNormals }
ir.js        — gbxToIR, irToMover, createEmptyIR
validator.js — JSON Schema + semantic checks, returns {ok, errors[]}
preview.js   — Three.js scene, takes mesh.js output, creates THREE.Mesh, blendedSample(time, IR) -> {y, rot, axis}
app.js       — UI wiring
```

All ES modules, no workers (GH Pages CSP).

mesh.js strategy:
- Reuse collector node reader from gbxinspect: nodes are [classID uint32][size uint32][data]
- Scan for `CPlugCrystal` classID `0x09005000` (or `0x09003000` for Solid2)
- Inside crystal: layers array -> each layer has surfaces array -> each surface has vb/ib
- vb layout: [vertCount int32][Float32 pos x,y,z, normal x,y,z, uv u,v] repeating, or separate streams — we detect by size
- ib layout: [triCount int32][uint16 or uint32 indices]
- We build `THREE.BufferGeometry` with attributes, compute normals if missing
- If crystal not found (some items use external shape), we fall back to placeholder but log warning to IR

---

## 5. UI Flow (no code knowledge needed, but also paste-friendly for AI)

Top bar: Help button.

Left panel:
- [Choose Item.Gbx] -> loads, auto shows IR in textarea
- Textarea `#irInput` with monaco-like? Simple textarea for now, copy button
- [Check] button -> validates + updates preview + shows errors inline
- [Export .Item.Gbx] disabled until Check passes

Right panel:
- 3D canvas (balloon stand-in for now, later optional mesh preview if we parse mesh)
- Timeline bars from IR animations
- Pill: "Found mover @..." + validation status

Flow:
1. User loads GBX -> `irInput.value = JSON.stringify(gbxToIR(...), null, 2)`
2. User copies IR to ChatGPT/Claude to edit ("make it spin faster and float higher") — agent edits JSON intuitively
3. User pastes edited IR back, clicks Check
4. App validates, shows preview live, shows warnings (e.g., period 0)
5. User exports

We also keep "Quick presets" that generate IR snippets.

---

## 6. Validation

JSON Schema (draft) + extra:

- `irVersion == 1`
- `animations` is array, 1..8 entries
- each has `property` in `translation|rotation`
- `axis` in `x|y|z`
- `durationMs` 100..20000, `delayMs` 0..10000
- `easing` in allowed set
- If `property==translation` then `axis` should be y for now (warn otherwise)
- If no animations, warn "static item"
- If source.moverOffset out of range, error

Validator returns list, UI shows green/red.

---

## 7. 3D Preview — Real model

**We must render the actual Item mesh, not a sphere placeholder.**

Pipeline:
1. On load, `mesh.js` tries to extract `BufferGeometry` from decomp body.
   - Success: `geoms = [{positions, indices, normals, uvs, materialIndex}]`
   - Fail: `geoms = []`, use placeholder but warn in UI "mesh parse failed, showing proxy"
2. `preview.js` creates `THREE.Group` `itemRoot`:
   - For each geom, `new THREE.Mesh(geom, mat)` where mat is `MeshStandardMaterial({color:0xcccccc, metalness:0.1, roughness:0.7})`
   - If material info has baseColor from `CPlugMaterial`, use it
   - Add to `itemRoot`
3. Animation:
   - `sampleIR(IR, timeMs)` computes `tY` and `rA` exactly as before (easing + loop + composition)
   - Apply to `itemRoot.position.y = tY` and `itemRoot.rotation[axis] = rA`
   - This matches in-game mover (translation along local Y, rotation around axis)
4. Camera:
   - Frame item via `Box3` after load, auto orbit controls (OrbitControls from three/addons)
   - Grid + ground shadow optional
5. Validation preview:
   - When user clicks Check, we re-sample IR and restart loop, no reload needed
   - If IR invalid, we tint item red and show errors

Fallback:
- If mesh extraction fails, we show icosahedron proxy + message, but still allow export (mover is independent of mesh)

Performance:
- Geometries are cached in memory; dispose on new file load
- Draco not needed — Item meshes < 200k verts


---

## 8. Export

- Keep original `origBytes` + `bodyPtr`
- Apply `irToMover` -> patch decomp
- Build new Uint8Array: header copy + decomp
- Set byte 7 to 'U' (0x55)
- Download

No recompression needed for v1. We note in IR that BUUR is fine.

---

## 9. File layout after implementation

```
/index.html
/lzo.js
/gbx.js
/ir.js
/validator.js
/preview.js
/app.js
/PLAN.md (this file)
/README.md
```

---

## 10. Implementation steps

1. **Research mesh layout** — run `gbxinspect` (GBX.NET CLI) on 3 samples to dump `CGameItemModel` / `CPlugCrystal` / `CPlugSolid2Model` fields. Log chunk IDs `0x2E00200C`, `0x09005000`, `0x09003000`, `0x0900C000`, `0x09006000`. Capture vb/ib offsets.
2. **Extract modules** from current monolithic index.html -> `gbx.js`, `mesh.js` (stub), `ir.js`, etc (no behavior change)
3. **Implement mesh.js v0** — find crystal by classID scan, parse first surface, return BufferGeometry. Test in Node with decomp bins `/tmp/decomp_*.bin` if available, else browser console. Render in preview.
4. **Define IR JSON schema** in `ir.js` + example in PLAN
5. **Implement `gbxToIR` and `irToMover`** with tests on 3 sample files (use node test harness)
6. **Build validator** with clear error messages for LLM
7. **Rewrite UI** to textarea + Check + Preview wiring — now preview uses real mesh group
8. **Wire export** from IR — mesh untouched, only mover patched
9. **Add presets** that emit IR (optional)
10. **Test round-trip**: GBX -> IR -> GBX, load in game, visually compare real mesh anim vs in-game
11. **Update README** with IR spec + prompt example for other AIs + note "real mesh preview"


---

## 11. Risks / Open

- Multiple movers in one item? We support array but export picks first for now.
- Items with no mover — IR empty, export should not crash, preview still shows static mesh.
- `RotPeriodMax/TransPeriodMax` — currently mirrors Period, do we need to expose? Keep in source.originalMover, bake sets same.
- Mesh parse complexity:
  - Items may use external reference model (MeshFile path) not embedded crystal — then we have no geom, need placeholder + warning
  - Crystal may have multiple LODs, multiple materials, vertex colors — v1 takes LOD0, first material, ignores vertex colors
  - Index size (16 vs 32) detection, endianness, compressed vb (some crystals use half-float) — need heuristic
  - If JS parser too fragile, fallback to asking GBX.NET WASM? But we stay JS-only for GH Pages — so we tolerate some items failing preview
- LZO recompress to BUCR — not needed, BUUR works, but note for final tool.
- Texture preview — we ignore textures v1, neutral material only. Could later parse `CPlugBitmap` but heavy.

---

## 12. Prompt snippet for other AIs

> You are editing Trackmania ItemAnimIR v1. It's a JSON with `animations` array. Each animation is like Web Animations API: `property` translation/rotation, `axis` x/y/z, `from`/`to` numbers, `durationMs`, `delayMs`, `easing` linear/easeInOut/spring/bounce, `loop` restart/pingPong. `composition.mode` is parallel (all together) or sequence (chain). Edit values but keep schema. Don't change irVersion.

---

## 13. What we will NOT do in v1

- No binary diff of whole GBX, only mover patch (mesh is read-only)
- No LZO recompress
- No texture / bitmap import — neutral material only
- No worker

---

Ready to implement once you approve.
