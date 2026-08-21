# Plan v4 – Proper Crystal parser via edges → tris (solid mesh)

## Status 2026-08-21 12:40
- Balloons: **SOLID** 2856 verts 2695 tris via crystal-edges (edgeCnt 4800 faceCnt 1428)
- Santa: **SOLID** 1789 verts 171 tris via heuristic-ib-u16 (point cloud 7.13m with ib 513)
- Duck: **FAIL** null – needs investigation (decomp 887K, no plausible Positions found)

## What worked
- Old Item.Gbx mesh is `CPlugCrystal 0x09003000` with:
  - Positions = ReadArray<Vec3> (count int32 + count*12)
  - edgeCount int32, Edges = ReadArray<Int2> (8 bytes each) for Version<35
  - faceCount int32, Faces[] are n-gons needing triangulation
- For Balloons: Positions cnt 2856 @144140 sz 1.24m, edgeCnt 4800 @178416, faceCnt 1428 @216820
- Edges are valid: [0,1], [2,77], [1,3], [4,77] etc., all indices <2856
- Faces can be reconstructed from edges by finding triangles in edge graph:
  - Build adjacency from edges
  - For each vert, for each pair of neighbors (a,b), if a-b is also an edge, then (vert,a,b) is a triangle
  - Dedup via sorted key, gives 2695 tris for 1428 faces (ratio 1.88, quads → 2 tris)
  - First tris all involve 77 (central vertex), plausible for balloon mesh

## Implementation (mesh.js v4)
1. Scan for Positions count with plausible bbox (0.2-12m, 80-6000 verts, reject needles)
2. Read edgeCnt int32 after Positions, validate edges (indices < cnt, a!=b)
3. Build adjacency, find all triangles via edge cycles, dedup
4. Validate tris: count 0.3*cnt to 3*cnt, area 1e-6 to 10, first 5 tris valid
5. Return solid mesh with positions Float32Array + indices Uint32Array
6. Fallback: try u16 edges (Version>=35), then point cloud + ib search (u16/u32), then point cloud

## Why old heuristic failed
- Old heuristic scanned for raw float triples without count, picked wrong block (3813 verts @46244)
- No ib search, rendered as Points
- Crystal's Positions has count prefix, and Edges/Faces follow, not raw ib

## Next steps
1. Duck: investigate why no Positions found – maybe compressed or different chunk (Solid2Model)
   - Try scanning for VisualIndexedTriangles, IndexBuffer
   - Check if Duck uses CPlugSolid2Model not Crystal
2. Santa: 171 tris is too few for 1789 verts (should be ~1000 tris), ib 513 is only part of mesh
   - Find full ib, maybe multiple ib chunks
3. Integrate with app.js: showMesh already handles Mesh vs Points, framing works
4. Ship to Pages, test with real Item.Gbx files via click handler
5. Update README with IR spec + AI prompt

## Acceptance
- Balloons solid grey MeshStandardMaterial double-sided, centered, smooth shading, orbit works
- Santa solid (even if low-poly) not point cloud
- Duck at least point cloud, ideally solid
- No Points fallback as final for Balloons – must be solid

## Refs
- GBX.NET CPlugCrystal.cs: Version, Positions, Edges, faceCount, Faces[vertCount, inds, TexCoord Vec2, mat, grp]
- ReadOptimizedInt: >65535 => int32, >255 => uint16, else byte (for 2856 verts, uint16)
- Balloons: cnt 2856 @144140 posOff 144144 edge 4800 @178416 face 1428 @216820 tris 2695
- Santa: cnt 1789 @568 size 7.13m ib 513 @69666 tris 171
