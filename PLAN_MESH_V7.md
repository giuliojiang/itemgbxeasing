# Plan v7 – 3333 still point cloud after ib validation fix

## User report 2026-08-21 13:58 (with screenshot)
- After v6 fix (full ib validation), now:
  - `findMesh len 97617`
  - `Point cloud: cnt 3333 @600 sz 6.49`
  - No `Raw ib u16` log, no WebGL error, but renders as points (as screenshot)
- Wants Plan, not fix yet

## What changed
- v6 rejected bad ib 13779 (indices >=3333) correctly – no more WebGL 65536 warning
- But no other valid ib found, and no faces found, so falls back to points
- So 3333 mesh has no valid u16/u32 ib within 300k that passes full validation, and no faces within 4k

## Hypotheses for 3333
1. **Stride >12**: Verts are not 12-byte Vec3 but 24/32-byte (Pos + Normal + UV). Our raw scan assumes 12, finds 3333*12=39996 bytes of plausible floats, but real verts are interleaved, so after=40600 is wrong offset. Faces/ib are after real verts, not after our guessed 3333*12.
2. **Solid2Model VertexStream**: GBX.NET `CPlugSolid2Model` stores `VertexStream` with `Decl`, `Stride`, `Count`, `Buffer`. Could be stride 24/32, count 3333, but buffer is not 3333*12 contiguous floats – it's stride-separated. Our scan finds Pos only, but ib expects original indexing which may be different.
3. **Multiple sub-meshes**: 3333 verts might be 2-3 meshes combined (e.g., 1500+1800), each with own ib. Our single-ib search fails because ib for first sub-mesh is <3333 but second ib has indices that overlap or are offset.
4. **Triangle strips / fans**: Ib might be strip with 0xFFFF restart, which we reject entirely. Should allow restart and split into lists.
5. **Faces encoding different**: For Solid2Model, faces are not `CPlugCrystal` style. Could be `CPlugVisualIndexedTriangles` with `Indices` as `ReadArrayOptimizedInt` – i.e., count-prefixed with byte/uint16/int32 depending on vert count. Our `tryFaces` only tries int32 and byte+3, not optimized.

## Investigation steps (debug build)
1. Dump bytes after 3333 verts:
   - At `after=600+3333*12=40600`, dump next 256 bytes as hex + int32/u16 interprets
   - Look for plausible faceCount, edgeCount, ibCount, or Visual header `0x0901E000`
   - Log: `after hex: ...`
2. Try stride 24/32:
   - For 3333, try stride 24: read 3333*24 bytes, extract every 24 bytes first 12 as pos, compute bbox, see if size still 6.49 and if after+stride leads to faces
   - Same for stride 32
3. Brute-force ib with restart:
   - Allow 0xFFFF in u16 ib, split on it, validate each chunk separately
   - Count how many valid tris remain after splitting
4. Search for `CPlugVisualIndexed` signature:
   - Scan for chunk id `0x0901E000` or `0x0906A000` near after, parse as Visual
5. Ask user for file type:
   - What is this 3333 file? Is it new format vs old? Item name? Could help guess if it's Solid2Model vs Crystal

## Fix plan (when approved)
1. Add stride detection for raw verts:
   - Try stride 12, 24, 32, 36 – for each, extract pos, check bbox, then try faces/ib at after=stride*cnt
   - Keep best that gives solid
2. Allow ib strip restart:
   - In u16 ib validation, allow 0xFFFF but split, count valid tris, reject only if >20% are invalid
3. Add optimized index read for Visual:
   - Implement `ReadOptimizedInt` logic: if cnt>65535 read int32, else if >255 read u16 else byte – same for ib count
   - Try both u16 and u32 ib but with optimized prefix
4. If still points, add second geometry:
   - If 3333 is actually 2 meshes, return both with their ibs (like before we returned up to 2)
5. Fallback: keep point cloud but with reason "no valid ib/faces – need sample file"

## Acceptance
- 3333 renders solid, no WebGL warnings, centered
- Balloons 2856 and Santa 1789 still solid
- Console shows `Raw faces` or `Raw ib u16/u32` with max<cnt, not `Point cloud`

## Risks
- Stride detection is slower but okay (3x scan)
- Strip handling adds complexity, need to triangulate strip -> list
- Optimized indices need to know cnt to decide byte/u16/int32 – we already have cnt, so can try both

