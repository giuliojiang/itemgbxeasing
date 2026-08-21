# Plan v5 – Point cloud fallback still triggers (3333 verts @600) → need solid

## User report 2026-08-21 12:44
- After reloads, past the MIME error, loading user's mesh:
  - `Point cloud: cnt 3333 @600 sz 6.49` and renders as points (screenshot shows sparse dots)
- Wants Plan, not fix yet

## Current state
- Balloons: solid 2856v 2695tris via crystal-edges (edgeCnt 4800 faceCnt 1428) – works
- Santa: 1789v 171tris via ib u16 – low but solid
- Duck: null
- New mesh: 3333v @600 sz 6.49 – point cloud fallback, no ib found

## Why point cloud fallback triggers
`findMesh` does:
1. Crystal edge->tris (int32 edges) – requires edgeCnt plausible and edges valid
2. Point cloud + ib search (u16/u32 count prefix + area check) within 250k after verts
3. Largest point cloud

For 3333 @600, step 1 failed (edgeCnt not plausible or edges invalid), step 2 failed (no ib with count prefix), so step 3 returned points.

## Hypotheses for 3333 mesh
- Could be Crystal but with Version>=35 → edges are optimized (ReadArrayOptimizedInt2, uint16 pairs, 4 bytes/edge, not 8)
  - Then our int32 edge check fails, we skip crystal path
- Could be Crystal with faceCount after edges, but faces use byte+3 vertCount and optimized inds (uint16 for 3333 verts)
  - Our ib search looks for standalone ib, not Faces
- Could be CPlugSolid2Model (Solid2Model) not Crystal – uses VertexStream + IndexBuffer chunks
  - Need to handle Solid2Model path

## Investigation steps (no code change yet)
1. Dump around 3333 mesh in decomp:
   - At posOff = 600+4 = 604, after = 604+3333*12 = 40600
   - Read int32 at 40600 (edgeCnt?), uint16 at 40600, int32 at 40604 etc.
   - Validate edges as int32 pairs and u16 pairs
2. Brute-force face parsing:
   - Try faceCnt int32 at after+4+edgeCnt*8 and after+2+edgeCnt*4
   - For each candidate fc 20-5000, try to parse 10 faces:
     - vertCount as int32 and as byte+3
     - inds as uint16 (for 3333) and as byte/uint16/int32 via ReadOptimizedInt logic
     - skip UVs (vc*8) and mat/grp (8 bytes), check next vertCount plausible
3. Solid2Model check:
   - Search for VertexStream signature: count + Vec3 + normals etc.
   - Look for IndexBuffer: flags + count + uint16 indices

## Fix plan (when approved)
1. Extend crystal path to handle u16 edges:
   - Try both int32 (8-byte) and u16 (4-byte) edge encodings
   - For each, build adjacency and tris as before
2. Add proper Face triangulation (no ib fallback):
   - After edges, read faceCount
   - If Version>=35, vertCount = byte+3 else int32
   - inds = ReadArrayOptimizedInt(vertCount, Positions.Length) → uint16 for 3333
   - Triangulate fan: (0,1,2), (0,2,3), ... for n-gon
   - Collect all tris, return solid
3. Keep ib search as secondary for Solid2Model meshes
4. Test against 4 samples: Balloons 2856, Santa 1789, Duck ?, new 3333 – all solid, double-sided MeshStandardMaterial, centered, smooth

## Acceptance
- New 3333 mesh renders solid, not point cloud
- Balloons still solid 2695 tris, Santa solid, no regression
- No PointsMaterial fallback for meshes >100 verts unless truly no triangles found (with clear console reason)

## Risks
- Optimized int encoding depends on Positions.Length – need to replicate GBX.NET ReadOptimizedInt exactly
- Version detection before Positions is hard – brute-force both int32 and byte+3 paths
- Solid2Model may need different chunk parsing – scope creep, but handle after Crystal

