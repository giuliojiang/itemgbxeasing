# Plan – Proper solid mesh (v3) – deep dive, no fallback

## User feedback
- Camera centering works – big progress
- Mesh now shows as point cloud (white dots), not solid – screenshot shows scattered dots forming rough shape
- Wants proper solid mesh, no proxy/fallback, proper working feature
- Asked to search web / investigate deeper

## Deep investigation – what the mesh really is

### Web / GBX.NET research
- Searched GBX.NET docs and GitHub: `Item.Gbx` = `CGameItemModel`, mesh lives in `CPlugCrystal 0x09003000` for old TM items (our 3 samples), or `CPlugSolid2Model 0x090BB000` + `CPlugVisualIndexedTriangles` for newer items.
- Found `ObjExporter` tool in GBX.NET repo (`Tools/ObjExporter/Program.cs`) – it exports Item.Gbx via `edition.MeshCrystal.ExportToObj()` or `model.StaticObject.Mesh.ExportToObj()`. That is the reference implementation we should replicate in JS.
- `CPlugCrystal` structure from `CPlugCrystal.cs` + `CPlugCrystal.chunkl` + `GbxReader.cs`:

```
Crystal {
  Version int32 (>=21, old items 30-34)
  if Version>=13: U01=4, VisualLevels[]
  if Version>=23: AnchorInfos[]
  if Version>=22: Groups[] (Parts)
  if Version>=25:
    IsEmbedded bool (as byte if >=34)
    if >=33: U02,U03 int32
  Positions = ReadArray<Vec3>  // count int32 + count*12 bytes
  edgeCount int32
  Edges = Version<35 ? ReadArray<Int2>(edgeCount) : ReadArrayOptimizedInt2()
  faceCount int32
  if Version>=37: texCoords[] + texCoordIndices[]
  Faces[faceCount]:
    vertCount = Version>=35 ? byte+3 : int32
    inds = Version>=34 ? ReadArrayOptimizedInt(vertCount, Positions.Length) : ReadArray<int32>(vertCount)
    // inds are indices into Positions – THIS IS THE MESH
    for each vert: TexCoord Vec2 (8 bytes) if Version<37
    materialIndex, groupIndex (int32 or optimized)
    // per-face skips depending on Version
}
```

### Critical: ReadOptimizedInt is NOT varint
From `GbxReader.cs:1363`:
```csharp
ReadOptimizedInt(determineFrom) => determineFrom switch {
  >65535 => ReadInt32(),
  >255 => ReadUInt16(),
  _ => ReadByte()
}
ReadArrayOptimizedInt(len, determineFrom) => 
  determineFrom>=65535 ? ReadArray<int32>(len) :
  determineFrom>=256 ? ReadArray<uint16>(len) as int :
  ReadArray<byte>(len)
```
So for Positions.Length=2856 (>255, <65535), face indices are stored as **uint16** (2 bytes each), not int32. That’s why our old ib search for int32 count+int32 indices failed.

### What we found in the 3 decomp files
- Brute-force scan for plausible Positions arrays:
  - **Balloons**: found `cnt=2856 @144140`, size 1.29m, `edgeCnt=4800`, `faceCnt=1428` @216820 – this looks like the real Crystal (2856 verts, 4800 edges ~1.68x verts, 1428 faces plausible for 4 balloons)
  - Duck & Santa: no candidate with same simple scan – their Crystal may be smaller, or edges are optimized (not 8 bytes), so our `edgeCnt*8` skip is wrong. Need to try optimized edge encoding.

- Tried to parse Balloons faces at 216820:
  - `faceCnt=1428`, next int32 = 1429 – that’s not a valid vertCount (3-10), it’s faceCnt+1. Means our edge skip is wrong – edges are NOT 8 bytes each for this Version.
  - Tried `edgeCnt*4` (uint16 pairs) → faceCnt=715, next vc=716 – still not 3-10.
  - Tried byte+3 for vertCount (Version>=35) → byte 149 → vc 152 – also invalid.
  - Conclusion: we need to know Crystal Version to know edge encoding and vertCount encoding. Version is stored *before* Positions, not after.

### Why point cloud appears
Our current `mesh.js` finds Positions alone (3813 verts @46244 size 0.95m) and treats it as mesh, with no Faces → we render as `Points`. That’s exactly the screenshot: white dots forming rough balloon shape. Positions alone is not a mesh – Faces + triangulation is.

## Proper fix – implement Crystal parser correctly (no fallback)

### Step 1 – Find Crystal start, not just Positions
Don’t scan for Positions count alone. Scan for Crystal header:
- Look for `Version` 25-38 (int32) then `U01=4`, then small VisualLevels count (0-5), then AnchorInfos count, then Groups count, then IsEmbedded=1, then Positions count 50-12000.
- The Positions count we found at 144140 is *inside* Crystal, but we need to walk backwards to find Version to know how to parse edges/faces.

Simpler v1: use GBX.NET ObjExporter to export our 3 samples to .obj (ground truth), then compare vert counts and face counts to our heuristic. That gives us expected numbers, and we can hard-code a parser that works for these Versions.

### Step 2 – Parse Faces with correct encoding
Once we have Version:
- `edgeCount = ReadInt32()`
- `Edges`: if Version<35, `edgeCount` × `Int2` (8 bytes). Else `ReadArrayOptimizedInt2(edgeCount, Positions.Length)` – which for 2856 verts is uint16 pairs (4 bytes per edge).
- `faceCount`
- For each face:
  - `vertCount = Version>=35 ? ReadByte()+3 : ReadInt32()`
  - `inds = ReadArrayOptimizedInt(vertCount, Positions.Length)` → for 2856 verts, 2 bytes per idx
  - Skip `vertCount` × `Vec2` (8 bytes) for UVs
  - `materialIndex`, `groupIndex` (int32 or optimized)
  - Extra skips: if !IsEmbedded, ReadInt32() etc.

### Step 3 – Triangulate
- Faces are n-gons (3-10 verts typical). Fan triangulate: (0,1,2), (0,2,3), … (0,n-2,n-1)
- Build `Float32Array` positions from `Positions` (no dedup) and `Uint32Array` indices (triangulated)
- Compute bounds to verify size 0.2-10m

### Step 4 – Render as solid Mesh
- `BufferGeometry`, `setAttribute('position')`, `setIndex()`
- `computeVertexNormals()` for smooth shading
- `MeshStandardMaterial` double-sided, grey
- No Points fallback – if Crystal parse fails, show error in UI and log, don’t show proxy silently

### Step 5 – Handle both old and new
- Try Crystal parser first (old items)
- If fails, try `CPlugSolid2Model` → `CPlugVisualIndexedTriangles` parser (new items): `VertexStreams[0].Positions` + `IndexBuffer.Indices` (uint16 or delta-encoded int16)
- If both fail, show clear error: “mesh not found – Crystal version not supported” with dump of counts, so we can add support

## What we will NOT do
- Heuristic float scan – delete it, it’s the source of point clouds and needles
- Proxy fallback as final – proxy only for debugging, not as shipped feature
- Materials/textures – grey only for v1
- Lightmap UVs – ignore

## Acceptance
- Balloons: solid mesh, 4 balloons + strings visible as solid grey, ~2-4k tris, centered, orbit works, not dots
- Duck: solid duck mesh, ~1k tris
- Santa: solid Santa + sled
- No point cloud, no needle, no proxy in normal load
- Console clean, no “proxy: …” message unless parse truly fails
- Works client-side, no worker, no WASM, pure JS

## Next steps to execute
1. Run GBX.NET ObjExporter on 3 samples to get ground-truth .obj (vert/face counts)
2. Implement `parseCrystal()` in `mesh.js` with Version detection and optimized int reading
3. Test triangulation, render as Mesh, push to Pages
