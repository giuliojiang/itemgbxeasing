# GBX Item Mover + Mesh Research – 2026-08-21

## Files

- `zzz_RotBalloons.Item.Gbx` – 147K comp, 256590 decomp, header 1780, bPtr 1805, classId 0x2E002000
- `MovingDuck.Item.Gbx` – 563K comp, 908008 decomp, header 1180, bPtr 1188
- `SantaRotating_Moving32.Item.Gbx` – 65K comp, 153687 decomp, header 1851, bPtr 1859

All are `GBX\x06\x00BUCR` (LZO), `FACADE01` at 76539/14217/63846. Decompress via `lzo.js` ES module `export function decompress` – verified 256590→256590, 908008→908008, 153687→153687.

## Header / Body Structure

```
GBX header: 0-3 "GBX", 4-6 version 06 00, 7 'B' (BUCR), 8-9 classId 0x2E002000, 13-16 userDataSize, 17-17+userDataSize header chunks, then body: 8 bytes uncomp/comp, then LZO bytes.
```

Decomp first bytes:

```
0: 09 10 00 2e 05 00 00 00 49 74 65 6d 73   // 0x2E001009 size 5 "Items"
13: 00 00 00 00 03 00 00 00 ff ff ff ff     // ID 0 size 3 data -1? (CGameItemModel chunk 0x000? maybe Vehicle null)
25: 0b 10 00 2e ff ff ff ff                 // 0x2E00100B size -1 skip (Ident)
33: 1a 00 00 00 00 00 00 40 16 00 00 00 43 69 30 62... // next chunk? 0x0000001A size 0x40000000 huge – likely misaligned due to lookback strings / NodeRefs, not simple chunk walk
```

Simple chunk walk (ID+size) breaks after first 2 chunks because GBX.NET's body includes lookback string table and NodeRef indices before true chunks. Need proper GBX.NET-style reader, not raw ID+size scan.

Collector chunks observed:

- `0x2E001009` at 0 size 5 "Items" (CGameCtnCollector.Ident header? actually chunk 0x009 = collector name?)
- `0x2E00100B` at 25 size -1 skip (Ident)
- `0x2E00100C` at 244/217/228 size 0xFFFFFFFF skip=1 (collector name)
- `0x2E00200C` at 244/217/228 size 0xFFFFFFFF skip=1 (CGameItemModel.0x00C RaceInterfaceFid)
- `0x2E002019` at 292/265/276 size 15 (model) – data `ff ff ff ff ff ff ff ff ff ff ff ff 00 00 00 00` + 00? Actually 3x -1 + 0. This is CGameItemModel.0x019 which should contain EntityModelEdition NodeRef. Its data being all -1 suggests no Edition? But items are moving, so Edition must be elsewhere or version-gated.

Aux nodes after 0x2E002019:

- `0x09145000` at 328/301/312 size 11 (CPlugPrefab? actually 0x09145000 = CPlugPrefab? GBX.NET ID 0x09145000)
- `0x090BB000` at 384,388 (CPlug?) appears twice
- `0x0901E000` at 436/449/480 (CPlugMaterial?)

## Mover – CPlugAnimLocSimple 0x090F8000

From GBX.NET `CPlugAnimLocSimple.chunkl`:

```
0x000 int version int RotPeriod int TransPeriod float TransY v1+ int Axis v2+ int RotPeriodMax int TransPeriodMax v3+ byte RotFunc float RotAngle
```

And `CGameCommonItemEntityModelEdition 0x2E026000` chunkl:

```
0x000: ItemType, MeshCrystal, U01, CPlugSolid U02, CPlugFileImg[] U03, SpriteParam[], CPlugParticleEmitterModel U04, CPlugAnimLocSimple U05, LightBallStateSimple[] U06, float U07-U13, iso4 U14, v3+ Mass, bool U15...
```

So mover is field U05 inside Edition, stored as NodeRef (index into aux nodes), not inline in Edition chunk.

Our JS `findMover` in `gbx.js` currently scans decomp for contiguous pattern `ver,rotP,transP,transY,axis,rotMax,transMax,rf,ra` with strict filters (rotP/transP 50-20000, transY -30..30, axis 0-2, rotMax close to rotP, etc). It fails on all 3 samples:

- `zzz_RotBalloons`: no mover (0 cands after filtering, 11 permissive cands all ver0, transY 0)
- `MovingDuck`: no mover (8 permissive cands ver0)
- `SantaRotating_Moving32`: no mover (67 permissive cands ver0)

Permissive scan (ver 0-6, rotP/transP 0-100000, transY -50..50, axis 0-2, rotMax/transMax 0-100000, rf 0-3, ra -10..10) finds only ver0 noise, no ver2/3 with plausible transY/ra.

Header scan (userData) also 0 cands.

Implications:

- Mover is not stored as raw contiguous struct in decomp with our assumed layout, or it's compressed/obfuscated, or it's stored as a separate node with its own class header (0x090F8000) and size prefix that we haven't accounted for.
- ClassID scan for 0x090F8000 in decomp finds 0 hits for all 3 files. For 0x09003000 (Crystal) 0 hits, 0x2E026000 (Edition) 0 hits, 0x0900C000 (Surface) 1 hit each at 144116/658499/104885 with size 151044099 (0x0900C000 as little-endian? Actually bytes at that offset decode to 0x0900C000 but next 4 bytes size is huge, suggests false positive or misaligned).

So where is mover?

Hypothesis 1: Mover is inside the prefab chain (0x09145000) which itself contains a CPlugAnimLocSimple reference. Our aux node walk didn't follow NodeRefs.

Hypothesis 2: GBX.NET's failure `Unknown class ID: 0xFFFFFFFF` occurs when reading CPlugPrefab which contains a NodeRef -1 (null) that it tries to resolve as class ID. The -1 is actually a valid null ref, but our parser misreads it as class ID because we didn't handle lookback.

Hypothesis 3: The true mover is not in decomp but in an external ref (e.g., a separate .Gbx file) – unlikely for these items, they are self-contained.

Next steps for mover:

- Use GBX.NET properly with `Gbx.LZO = new Lzo(); Gbx.Parse(...)` to get `CGameItemModel` and then `EntityModelEdition` and `U05`. The current dumpproj failed due to `0xFFFFFFFF` class ID – need to init LZO and also handle `CPlugSurface` reading NodeRef correctly. The error is `Unknown class ID: 0xFFFFFFFF` which is -1 (null) being read as class ID – indicates a NodeRef was read as class ID because the chunk version mismatch.
- Alternatively, brute-force search for mover by looking for plausible mover values near known good offsets: earlier monolithic index.html's heuristic scanner found mover (even if noisy) – its thresholds were looser (rotP/transP 0-500k, transY -20..20). It found candidates but with many false positives. We tightened too much.
- Try scanning for mover with version first being 2 or 3 (common for moving items) and rotP/transP in 100..20000, transY 0.1..10, axis 0-2, rotMax==rotP, transMax==transP, rf 0-3, ra 0.1..6.28. For these 3 files, expected values (from game behavior):
  - RotBalloons: rotP ~3000-5000, transP ~2000-4000, transY ~1-3, axis 1 (Y), ra ~3.14
  - MovingDuck: transP ~2000-4000, transY ~2-5, rotP 0 or small
  - SantaRotating: rotP ~3000-6000, transP 0 or 1000, ra ~1.5-3.14
- Test by patching candidate and exporting BUUR and loading in Trackmania – not possible here, but we can at least score candidates by `off>300 && off<decomp.length*0.8 && ver==2||3 && (rotMax==rotP||transMax==transP)`.

Current `findMover` in `gbx.js` needs to be relaxed: allow ver 0-3, rotP/transP 0-20000 but at least one >0, transY -20..20, axis 0-2, rotMax/transMax 0-20000, rf 0-3, ra -7..7, and score by `rotMax==rotP` + `transMax==transP` + `off>400` + `transY!=0` + `ra!=0` + `ver==2||3`. Return best.

## Mesh – Real Model

Goal: replace proxy icosahedron with actual item mesh.

GBX.NET IDs:

- `CPlugCrystal` Id `0x09003000` (151007232)
- `CPlugSolid` Id `0x09005000` (151015424) – actually Crystal is 0x09003000, Solid is 0x09005000, Surface is 0x0900C000 (151044096)
- `CPlugSurface` Id `0x0900C000`

`CGameCommonItemEntityModelEdition` contains `MeshCrystal` (CPlugCrystal) and `CPlugSolid` U02.

In decomp, we searched for `0x0900C000` and found 1 hit each at 144116/658499/104885 with size 151044099 (which is 0x0900C000 itself? No, size 151044099 = 0x0900C003, close to 0x0900C000). This suggests false positive where the class ID bytes are actually part of vertex data.

Heuristic `parseMesh` in `mesh.js`:

- Scans for float3 runs where |x|<200, finite, count>=50.
- Finds best run: RotBalloons @524 count 9526, Santa @568 count 1789, Duck none.
- Then tries to find index buffer after verts by searching for count then indices < vertCount. Finds ib @115098 count 3 (implausible) for Balloons, 513 for Santa.
- Builds `Float32Array` positions, `Uint16Array`/`Uint32Array` indices, returns `geometries`.

This is fragile:

- Balloons verts 9526 is plausible (balloon mesh), but ib count 3 is not (should be ~10000).
- Santa verts 1789 plausible, ib 513 plausible but small.
- Duck fails entirely – maybe its mesh is compressed or external.

Better approach per PLAN.md v2:

- Parse `CPlugCrystal` / `CPlugSolid2` properly: they contain Layers → Surfaces → `vb`/`ib` (vertex buffer / index buffer).
- `CPlugCrystal` chunkl (from GBX.NET) includes `Crystal` struct with `Layers` array, each Layer has `Surfaces` array, each Surface has `Material`, `vb`, `ib`, etc.
- We need to find `CPlugCrystal` node in aux list, then read its `Layers`.
- Fallback: if no Crystal, try `CPlugSolid2` (0x09003000 is actually Solid2, not Crystal – need to check: GBX.NET says `CPlugCrystal` Id `0x09003000`, `CPlugSolid` Id `0x09005000`, but `CPlugSolid2` might be 0x09003000).
- For now, heuristic is acceptable for v1, but we should improve `parseMesh` to also try stride 32 (pos+normal+uv) and to validate indices by checking that they form plausible triangles (not degenerate, within bounds).
- Also need to handle multiple geometries (item may have multiple meshes).

External mesh refs: none found (no `File:` or `.Mesh.Gbx` strings). Only `Material` ascii hints in decomp (e.g., "Material" at 45). So meshes are embedded.

`mesh.js` API for v2:

```
export function parseMesh(decomp) -> {geometries: [{positions: Float32Array, indices: Uint16Array|Uint32Array|null, normals, uvs, vertCount, posOff, ibOff}], reason: string}
export function createThreeGeometry(THREE, desc) -> THREE.BufferGeometry
```

Real preview in `preview.js`/`app.js`:

- `itemRoot = new THREE.Group()`
- `THREE.MeshStandardMaterial` neutral
- `OrbitControls`, `Box3` framing
- `sampleIR` drives `itemRoot.position.y` and `rotation.y` etc based on IR.

## IR (Intermediate Representation) v1

```
{
  irVersion: 1,
  source: {fileName, classId, decompressedSize, moverOffset, originalMover},
  animations: [{id, target:"self", property:"translation"|"rotation", axis:"x"|"y"|"z", from, to, durationMs, delayMs, easing:"linear"|"easeInOut"|"spring"|"bounce", loop:"restart"|"pingPong", description}],
  composition: {mode:"parallel"|"sequence", note},
  baking: {strategy:"maxDuration", notes}
}
```

Baking: `TransPeriod = max(durationMs translation)`, `RotPeriod = max(durationMs rotation)`, `TransY = max(|to-from|)`, `RotAngle = first rotation delta`, `Axis = first rotation axis`, `easing linear→0, easeInOut→1, spring→2, bounce→3`, `loop restart vs pingPong` (game only has pingPong for trans, restart for rot?).

## Current Repo State

`/tmp/itemgbxeasing`:

- `index.html` (9.1K) shell with importmap three, textarea, Check+Export, Help modal
- `lzo.js` (3.9K) ES module `export function decompress`
- `gbx.js` (3.9K) parseGBX, findMover (too strict), patchMover, buildBUUR
- `ir.js` (3.6K) gbxToIR, irToMover, createEmptyIR
- `mesh.js` (4.9K) heuristic parseMesh
- `validator.js` (2.8K) JSON schema + semantic
- `preview.js` (2.2K) sampleIR
- `app.js` (9.9K) wiring, Three, OrbitControls, file load, presets, Check, Export
- `PLAN.md` (325 lines) v2 with real mesh plan

Commits: `d74958f`, `9712f1f`, `9de9f1a`, `203e93e`, `29d20e8`, `3a692d4`, `c5d5322`, `642c1df`, `8645a28`, `908d33c`, `42e5bc5`, `059a2ec`

Pages: https://giuliojiang.github.io/itemgbxeasing/ (needs hard-refresh)

## What Still Needs Doing

1. Fix `findMover` – relax thresholds, test on 3 samples, ensure it finds mover with ver 2/3, rotP/transP plausible, transY/ra non-zero. If still fails, implement proper aux node walk to find `0x090F8000`.
2. Improve `parseMesh` – try stride 32, validate ib, handle multiple surfaces, fallback to proxy but log reason.
3. Wire `app.js` flow: Load GBX → auto-fill IR textarea → user edits IR → Check validates + updates 3D → Export BUUR (byte 7 `U`).
4. Test round-trip: GBX → IR → GBX byte-identical except edited fields; ensure `lzo.js` works on Pages.
5. Update README with IR spec + prompt snippet for AI.

## Raw Dumps for Reference

- Decomp 0-200 hexdump (RotBalloons) – see `/tmp/hexdump.mjs` output.
- `mesh_scan.json` at `/tmp/mesh_scan.json` (float-dense region off 768 score 64/64)
- Decomp bins `/tmp/decomp_*.bin` 251K/887K/151K present.

## GBX.NET Reflection (2026-08-21)

- `CPlugCrystal` Id 0x09003000
- `CPlugSolid` Id 0x09005000
- `CPlugSurface` Id 0x0900C000
- `CPlugAnimLocSimple` Id 0x090F8000
- `CGameCommonItemEntityModelEdition` Id 0x2E026000
- Edition chunkl: ItemType, MeshCrystal, U01, CPlugSolid U02, CPlugFileImg[] U03, SpriteParam[], U04, CPlugAnimLocSimple U05, LightBallStateSimple[] U06, float U07-U13, iso4 U14, v3+ Mass, bool U15 etc
- Attempted dotnet parse failed `Unknown class ID: 0xFFFFFFFF` due to CPlugSurface reading NodeRef, needs LZO init `Gbx.LZO = new Lzo()` – dotnet project `dumpproj` built with GBX.NET 2.4.4 + GBX.NET.LZO 2.1.6 but still fails on null ref handling.

---
*This research was auto-generated from JS scans on 2026-08-21. Mover offset and mesh extraction still need proper GBX.NET-assisted parsing to be 100% reliable.*
