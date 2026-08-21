# Plan – Proper triangles (v2) – no more point cloud

## User feedback
- Camera centering works, big progress
- Mesh now shows as point cloud (white dots), not solid mesh
- Wants proper solid mesh, not fallback/proxy
- Asks to search web if needed, investigate deeper

## What we found (deep dive)

### Real structure is NOT raw vert+ib scan
Heuristic scanning for float triples + index buffer is wrong for old Item.Gbx. It finds random float blocks (lightmap, physics) and gives point clouds.

**Actual mesh for old Items is `CPlugCrystal 0x09003000`:**

From GBX.NET `CPlugCrystal.cs` + `GbxReader.cs`:

```
Crystal:
  Version int32 ( >=21 )
  if Version>=13: U01 int32=4, VisualLevels array
  if Version>=23: AnchorInfos array
  if Version>=22: Groups (Parts) array
  if Version>=25:
    if Version<29: IsEmbedded bool x2
    IsEmbedded bool (as byte if >=34)
    if Version>=33: U02,U03 int32
  if !IsEmbedded → not supported (external .Gbx)
  Positions = ReadArray<Vec3>   // count int32 + count*12 bytes (3 float32 LE)
  edgeCount int32
  Edges = HasFacedEdges ? ReadArray<Int2>(edgeCount) : ReadArrayOptimizedInt2()
  faceCount int32
  if Version>=37:
    texCoords = ReadArray<Vec2>
    texCoordIndices = ReadArrayOptimizedInt()
  Faces[faceCount]:
    vertCount = Version>=35 ? ReadByte()+3 : ReadInt32()
    inds = Version>=34 ? ReadArrayOptimizedInt(vertCount, Positions.Length) : ReadArray<int32>(vertCount)
    // inds are indices into Positions – THIS IS THE TRIANGLE DATA
    for each vert in face:
      if Version<27: uvCount = min(ReadInt32(), vertCount) … reads Vec2 per vert + Vec3 normal
      else if Version<37: for each vert: TexCoord=ReadVec2()
      else: TexCoord=texCoords[texCoordIndices[faceVertexIndex++]]
    materialIndex int32 (or optimized)
    groupIndex int32 (optimized if >=33)
    // then per face skips: ReadInt32() etc depending on Version
  U04 int32 etc…
```

**Faces are polygons**, not necessarily triangles. `vertCount` is 3+ (tri, quad, n-gon). `inds` are indices into `Positions`. That’s the mesh.

ObjExporter does:
```csharp
foreach face in Crystal.Faces
  for each vertex in face.Vertices
    pos = Positions[vertex.Index]
    uv = vertex.TexCoord
  write f pos/uv
```
So to get solid mesh, we need to triangulate polygons (fan triangulation).

### Why we got point clouds
- Our 3813 verts @46244 size 0.95m is actually `Positions` array! 3813 Vec3 = 11439 floats = 45756 bytes. That matches.
- No ib found because ib doesn’t exist as flat buffer – faces store their own index arrays with variable length and optimized ints.
- Point cloud rendering of Positions alone looks like scattered dots forming rough shape (screenshot) – that’s expected.

### Critical discovery: ReadArrayOptimizedInt is NOT varint
From `GbxReader.cs:1363`:
```csharp
public int ReadOptimizedInt(int determineFrom) => (uint)determineFrom switch
{
    > ushort.MaxValue => ReadInt32(),
    > byte.MaxValue => ReadUInt16(),
    _ => ReadByte()
};
public int[] ReadArrayOptimizedInt(int length, int? determineFrom = null)
{
    return (uint)determineFrom.GetValueOrDefault(length) switch
    {
        >= ushort.MaxValue => ReadArray<int>(length),
        >= byte.MaxValue => Array.ConvertAll(ReadArray<ushort>(length), x => (int)x),
        _ => Array.ConvertAll(ReadBytes(length), x => (int)x)
    };
}
```
So if `Positions.Length` = 3813 ( >255, <65535 ), indices are stored as **uint16** (2 bytes each). If >65535, int32. If <256, byte.

That explains why our uint32 ib search failed – we were looking for int32 count + int32 indices, but real is uint16.

### For newer Items (CPlugSolid2Model)
- Uses `CPlugVisualIndexedTriangles 0x0901E000` → inherits `CPlugVisualIndexed 0x0906A000` → `CPlugVisual3D 0x0902C000`
- Visual has `VertexStreams[]` and `Vertices[]` and `IndexBuffer` (`CPlugIndexBuffer 0x09057000`)
- `CPlugIndexBuffer` chunk 0x000: flags + count + uint16 indices, or 0x001: delta-encoded int16
- Positions in `VertexStreams[0].Positions` or `Vertices[].Position`

But our 3 test files are old, so they are Crystal.

## Plan – Implement proper Crystal parser in JS

### Step 1 – Find Crystal in decomp
Crystal is inside `CGameItemModel` → `CPlugCrystal` node. In decomp, search for Crystal version pattern.
Simpler: scan decomp for plausible Crystal header:
- Look for `Version` 22-38 (int32) followed by small U01=4, then array counts, then Positions count that makes sense.
- Or find `CPlugCrystal` classID `0x09003000`? No, Crystal is not a NodeRef with classID in old format – it’s embedded struct.
- Better: use GBX.NET logic: after reading header, walk NodeRefs to find `CPlugCrystal`. In JS we can brute-force: look for Positions array signature: count int32 (100-10000) followed by that many Vec3 where all coords finite and box size 0.2-20m, then edgeCount small, then faceCount (10-5000).

We already have a near-correct Positions block at 46244 for Balloons – that IS the Positions array, including its count prefix! Our current scan starts at 46244 but we treat 46244 as first float, but actually 46244-4 is count. Check: if we read int32 at 46240, what is it?

**Todo:** dump Balloons decomp at 46240: `count`, first 3 Positions, edgeCount, faceCount, first face vertCount and first 3 inds – to confirm Crystal layout. Use Node script to parse.

### Step 2 – Parse Crystal fully (JS)
Write `parseCrystal(decomp, posOff)` that:
- Reads `count = dv.getInt32(off-4, true)` (Positions length)
- Validates 50 < count < 20000
- Positions = count Vec3 from off
- edgeCount = dv.getInt32(off+count*12, true)
- Edges: if Version<35, edges are Int2 = 2 int32 each (8 bytes), else optimized. For old versions, skip `edgeCount*8`
- faceCount = next int32
- Then loop faceCount faces parsing vertCount, inds
  - vertCount = dv.getInt32(...) (or byte+3 if Version>=35 – need to know Version, we can try both)
  - inds: if Positions.Length >=65535, 4 bytes each, else if >=256, 2 bytes each (uint16), else 1 byte
- For each face, also need to skip UVs: if Version<37, each vert has Vec2 (8 bytes). So skip `vertCount*8`
- Then materialIndex (4 bytes) and groupIndex (4 bytes or optimized)
- Then extra skips per Version

**Key:** we need Crystal Version. We can try to guess Version by trying to parse from a plausible Version location before Positions. Or we can brute-force Version 30-36 and see which gives valid faceCount and vertCounts 3-10.

Simpler v1: assume Version 30-33 (common for old items). Then vertCount = int32, inds = uint16, UVs = Vec2 per vert, material+group = int32 each.

### Step 3 – Triangulate
Once we have Faces with `indices[]` (3+ per face), triangulate:
- For face with 3 verts: 1 tri (0,1,2)
- 4 verts: 2 tris (0,1,2) (0,2,3)
- n verts: fan from 0 (0,i,i+1) for i=1..n-2

Build Float32 positions (from Positions array) and Uint32 indices (triangulated). Keep Positions as is, don’t deduplicate.

### Step 4 – Render as Mesh
- `geometry.setAttribute('position', new BufferAttribute(positions,3))`
- `geometry.setIndex(triIndices)` – use Uint32 if >65535 else Uint16
- `computeVertexNormals()` for smooth shading
- `DoubleSide` material, grey, `MeshStandardMaterial`

### Step 5 – Integrate
- New `parseCrystalMesh(decomp)` tries to find Crystal, returns `{positions, indices, reason}` or null
- `parseMesh` tries Crystal first, then falls back to old heuristic (but old heuristic should be removed – it gives point clouds)
- If Crystal fails, show proxy with reason, not points

## Investigation todo (before coding)

1. Dump Balloons decomp at 46240: count, first 3 Positions, edgeCount, faceCount, first face vertCount and first 3 inds – to confirm Crystal layout
2. Write quick Node test `test_crystal.mjs` that tries Version 30-35 and parses 10 faces, logs their vertCounts and indices, checks if indices < Positions.Length
3. If that works, triangulate and compute total tris – should be ~2-4k for Balloons

## Acceptance

- Balloons: solid mesh, 4 balloons + strings, ~1-3k tris, not dots, centered, smooth shading
- Santa: solid Santa + sled, ~1k tris
- Duck: solid duck
- No point cloud unless item truly has no faces (unlikely)
- No proxy unless parse fails – then proxy with reason logged
- Works client-side, no worker, no WASM

## What we won’t do

- Materials/textures – grey only
- Lightmap UVs – ignore for v1
- Newer Solid2Model parsing – only if old Crystal works, then add later
