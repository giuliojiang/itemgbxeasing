# Plan v6 – Raw ib u16 13779 tris 4593 fails WebGL (65536 verts needed, only 3333 supplied)

## User report 2026-08-21 13:33
- After fix for 3333 raw verts, log shows:
  - `Raw ib u16: cnt 3333 @600 ib 13779 tris 4593`
  - WebGL warning: `drawElementsInstanced: Indexed vertex fetch requires 65536 vertices, but attribs only supply 3333`
  - Nothing renders (32 warnings then silent)
- Wants Plan, not fix yet

## Root cause
`findMesh` for raw verts @600 does:
- Finds 3333 verts @600 size 6.49 (float triples)
- Searches ib within 300k after verts: looks for u16 count prefix + 20 indices < cnt + first tri area check
- Found ib 13779 @some offset, first 20 indices <3333, area plausible, so returns it
- But later indices in that ib are >=3333, up to 65535 (0xFFFF), causing WebGL out-of-bounds

Validation too weak: only first 20 indices checked, not all 13779.

13779 indices / 3 = 4593 tris. For 3333 verts, tris should be ~0.5-2x verts (1500-6000 tris), so 4593 is plausible count-wise, but indices invalid.

Possible reasons ib is wrong:
- It's a combined ib for multiple meshes (other meshes have more verts, up to 65535)
- It's actually u32 ib, not u16, and we misinterpreted u32 as u16, getting high values from high bytes
- It contains 0xFFFF sentinel (primitive restart) which is common in index buffers
- It's for a different vert block (not 3333 @600 but another candidate)

## Investigation steps
1. Dump ib 13779 around found offset:
   - Log offset where ib found, dump first 40 and last 40 indices, check max, check for 0xFFFF, 0xFFFE, etc.
   - Check if all indices <3333 or if many >=3333
   - Check if ib as u32 (count/2) gives valid indices <3333
2. Brute-force ib search with full validation:
   - For each candidate ib, check ALL indices < cnt, not just first 20
   - Reject if any index >= cnt or == 0xFFFF or == 0xFFFFFFFF
   - Also check that ib uses at least 30% of verts and not too many degenerate tris
3. Try u32 ib search for 3333:
   - At same offset, try reading as u32 count prefix, check all indices < cnt
4. Try face triangulation for raw verts:
   - Our current tryFaces looks for faceCount int32 right after verts, then vertCount byte+3 / int32 + inds + UVs + mat/grp
   - For 3333, after=600+3333*12=40600, faceCount at 40600 might be invalid, but maybe faces start later (after some padding)
   - Search for faceCount within 1k after verts, not just at after

## Fix plan (when approved)
1. Strengthen ib validation:
   - Check ALL indices < cnt, reject if any >= cnt
   - Reject if contains 0xFFFF (u16) or 0xFFFFFFFF (u32) sentinel
   - Check that max index >= cnt*0.3 (uses decent range) and that ib doesn't have too many duplicate tris
   - For u16, also check that ib count is even and not too large (>cnt*6)
2. Add u32 ib search with same full validation
3. For raw verts, also try face triangulation with search window:
   - Instead of only at after, search faceCount within after .. after+4096
   - Try both old and new face encodings
4. Fallback: if ib still invalid, try to build mesh via convex hull or keep point cloud but with clear reason "ib invalid – indices out of range"
5. Test against 4 samples: Balloons 2856 solid, Santa 1789 solid, Duck ?, new 3333 solid – all with no WebGL warnings, centered, double-sided

## Acceptance
- 3333 mesh renders solid, no WebGL warnings, no point cloud
- Balloons and Santa still solid, no regression
- Console shows `Raw ib u16` or `Raw faces` with valid tris, not `Point cloud`

## Risks
- Full validation is slower (checking 13k indices) but still okay in JS ( <1ms)
- 3333 mesh might actually be multiple sub-meshes with separate ibs – need to handle multiple geometries (return up to 2 best as before)
- Could be Solid2Model with VertexStream that has stride >12 (e.g., 24 with normals) – our raw scan assumes stride 12, might need stride 24/32 search

