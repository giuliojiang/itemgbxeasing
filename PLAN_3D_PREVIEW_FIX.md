# Plan – 3D preview shows nothing / mangled (updated with user screenshot)

## New evidence (2026-08-21 12:15)
User screenshot: grid visible, long spiky grey shard floating above grid, not recognizable as Balloons/Duck/Santa. User says:
- Initially saw nothing, had to drag randomly to find it → camera not centered
- No console errors → rules out Three import / OrbitControls failure (H1 in v1 plan is out)
- Object is mangled, not just off-center

Screenshot shows ~8m long needle with jagged sides, centered above grid, grid 10×10. Looks like vertex buffer mis-interpreted (stride wrong, or reading normals/UVs as positions).

## Revised root causes

### R1 – Camera framing broken (confirmed)
`showMesh()` does:
```js
box.setFromObject(itemRoot)
ctr=box.getCenter()
controls.target.copy(ctr)
maxDim=Math.max(sz.x,sz.y,sz.z,1)
camera.position.set(ctr.x+maxDim*1.8, ctr.y+maxDim*1.2, ctr.z+maxDim*1.8)
camera.lookAt(ctr)
```
If Box3 is huge (because verts are huge or contain NaN/inf) or empty (no verts), `maxDim` is 1 or 1000, camera ends up looking at 0,0,0 while mesh is at 50,50,50. User has to orbit blindly to find it.

Also `resize()` not called after `previewCard` becomes visible, but user did see *something* after dragging, so renderer is at least non-zero – H2 is secondary.

### R2 – Mesh heuristic picks wrong block (main mangling cause)
Current `parseMesh`:
- Scans stride 12/24/32/36 for any run of float triples where |x|,|y|,|z| <=200
- Picks largest count (e.g., 9526 verts for Balloons)
- Then searches for ib within 80k after verts

Problem: Many float triples in GBX decomp look like positions but are actually:
- Normals (also small floats)
- UVs, colors, animation keys
- Physics hulls, lightmap data
- 9526 verts could be a physics tri-mesh or a lightmap, not visual mesh

Index buffer heuristic also weak: looks for `count + indices` where indices < vertCount. If vertCount is wrong (9526), many random uint32 blocks will satisfy `idx < 9526`, so we pick a fake ib that stitches unrelated verts into long needles.

Screenshot needle shape is classic symptom of stride mismatch: reading a 36-byte vertex (pos 12 + normal 12 + uv 8 + color 4) as 12-byte pos-only → every 3rd float is actually a normal component, causing vertices to jump far.

Or we merged multiple meshes into one (all balloons + strings) without respecting sub-mesh boundaries.

### R3 – Duck 84 points case
No ib found → we return `geometries` with points but `createThreeGeometry` tries to make a Mesh with no index → invisible. Should be Points.

## Investigation still needed (quick checks)

1. Log for each file: best candidate `count`, `stride`, `off`, first 5 positions, Box3 size, isFinite, ibCount. Compare Balloons 9526 vs Santa 1789 vs Duck 84 – are positions plausible? (Balloons should be ~2m tall, not 200m)
2. Try stride detection that validates: compute bounding box of candidate verts, reject if size >50 or <0.01, reject if 90% verts are colinear
3. Check actual visual mesh location in GBX.NET: look at `CPlugStaticObjectModel` or `CPlugSolid2Model` – where are `Positions` stored? Might be in `CPlugVertexStream`
4. Test with known good: export Item.Gbx from game as FBX and compare vert count to our heuristic

## Fix plan v2 (do after user approves)

### Fix 1 – Camera always finds object
- After `showMesh`/`showProxy`, compute Box3. If Box3 empty or size >100 or contains NaN, fallback to proxy at 0,0,0 and frame to 2m cube
- Always call `resize()` after `previewCard.style.display='block'`
- Set `controls.target.set(0,0,0)` initially, camera at (3,2,3), look at 0,0,0 – so even if mesh is at 10,10,10 user sees grid and can orbit to it
- Add `controls.update()` and `camera.updateProjectionMatrix()`
- Add mini debug overlay: `box 2.1m @ 0,0,0 – verts 9526`

### Fix 2 – Robust mesh heuristic
- Prefer smaller, plausible meshes: reject candidates where Box3 size >30m or <0.05m
- Try stride 12, 24, 32, 36, 40, 44 – for each, compute avg edge length of first 10 tris using fake ib scan; reject if avg edge >5m (indicates stride wrong)
- For ib search, require: count %3==0, all indices < vertCount, and resulting tris have plausible area (not zero, not huge)
- If multiple meshes found (e.g., Balloons has 4 balloons), return *all* geometries, not just largest – create Group with each Mesh
- If no ib, return Points with `PointsMaterial` size 0.03, not Mesh

### Fix 3 – Validate against real file layout (stretch goal, not required for v1)
- Look for `CPlugVisual` chunks: `0x09003000` Crystal, `0x090BB000` Solid2, `0x0900C000` Surface – they contain `CPlugVertexStream` with explicit stride/count. If we can parse those NodeRefs, we get exact vert buffer offset.
- For now, keep heuristic but add tight validation so mangled needle is rejected and we fall back to proxy (better than showing wrong mesh)

### Fix 4 – Preview motion scaling
- Santa X -16→16 moves object 32m off grid instantly → looks broken. Scale preview translation by 0.2× for display only, keep export values full.
- Or clamp preview trans to -2..2 range visually

## Acceptance (updated)
- Load Balloons: shows recognizable balloon cluster (4 balloons + strings), centered in view without needing to drag hunt
- Duck: shows duck mesh or at least duck-shaped point cloud, centered
- Santa: shows Santa on sled, centered, slides -2→2 in preview (but exports -16→16)
- If mesh still not found, bright proxy icosahedron is centered and visible immediately
- No mangled needles, no blank canvas, console clean
- Orbit drag + wheel zoom works, resize window keeps object visible

## What we will NOT do yet
- Full CPlugCrystal parser (too heavy) – keep heuristic but make it reject bad candidates
- Texture / materials – keep grey standard material, double-sided
