# Plan – Point cloud shows, but no solid mesh (triangles missing)

## Current state (big progress)
- Camera centering works – user sees something immediately without dragging
- Mesh loader now returns points (3813 verts Balloons, 874 Santa) instead of mangled needle – screenshot shows scattered white dots forming rough shape of item, not solid
- No console errors, proxy fallback works
- Still showing as Points, not Mesh with triangles

## Why triangles missing
Current `parseMesh`:
- Finds vert block by scanning for float triples with size 0.15-12m, rejects many zeros
- Then searches for ib within 120k after verts, requiring:
  - count >=60, count >= vertCount*0.4, count %3==0
  - indices < vertCount and maxIdx >= vertCount*0.3
  - first 3 tris have area 1e-5..20

For Balloons 3813 verts, ib should be ~6000-10000 indices (2000-3000 tris). Our search didn't find it within 120k after verts, or found but rejected because area check failed (maybe stride wrong so triangle area huge/tiny).

For Santa 874 verts, similar.

Old heuristic found ib 4800 @178420 for 9526 verts – that ib was 4800 indices = 1600 tris, plausible for 9526 verts (ratio 0.5). But we now reject 9526 verts because size 12.99m was borderline and zeroCount high.

Point cloud is better than needle, but not what user expects – they want solid mesh.

## What real mesh looks like in GBX
From GBX.NET:
- `CPlugCrystal 0x09003000` contains layers, each layer has geometry
- `CPlugSolid2Model 0x090BB000` has `ShadedGeom` with VisualIndex/MaterialIndex and LodMask
- Vertices likely in `CPlugVertexStream` or `CPlugSurface` with explicit `Positions`, `Normals`, `TexCoords`, `Indices`
- Item.Gbx old format stores meshes as `CPlugStaticObjectModel` which references `CPlugSolid2Model`

We haven't parsed those NodeRefs – we just scan raw floats. That's why we get point clouds (positions only) but miss indices which are stored elsewhere (maybe compressed or in different chunk).

## Investigation needed

1. Dump decomp around vert block for Balloons 3813 @46244 – what’s at 46244+3813*12 = 92000? Is there an ib there? Log first 100 uint32 after verts, see if any look like indices (0..3812)
2. Try different strides: 12 is pos-only, but real vert may be 24 (pos+normal) or 32 (pos+normal+uv). Our 3813 verts at stride 12 size 0.95m – try stride 24 at same off, see if vertCount halves but size similar and ib appears
3. Look for `CPlugVertexStream` header: search for classID 0x0900... that contains vertex count. Grep decomp for `0x090...` near vert blocks
4. Check if indices are 16-bit not 32-bit for these meshes – our u16 search may be too strict (requires count>=60 and >=vert*0.4, but 3813*0.4=1525, so 60 is okay, but we also require maxIdx>=vert*0.3 which should pass)

## Fix plan

### Fix A – Loosen ib search, keep validation but allow smaller ib
- Allow ibCount >= 60 even if < vertCount*0.4, as long as triangle count >=20 and area plausible
- Search further: up to 500k after verts, not just 120k – ib may be far from verts (different chunk)
- Try both u16 and u32, and also try direct tri array without count prefix (some meshes store raw tris)

### Fix B – Try multiple vert interpretations at same offset
- For each plausible vert off, try stride 12,24,32,36 – for each, try to find ib. Keep the combo that gives most valid tris with plausible area and box size 0.2-5m
- For Balloons, 3813 verts stride12 size 0.95m no ib – try same off with stride 24 → 1906 verts, size maybe 0.95m, ib maybe 3000 indices – could be real mesh

### Fix C – If still no ib, synthesize ib via simple triangulation (temporary)
- If we have points that look like a closed shape but no ib, we can run a quick Delaunay or just show as Points with bigger size for now, but note in UI “points only – triangles not found”
- Better: fallback to proxy if points look like random noise (size <0.2 or >5, or zeroCount high)

### Fix D – Real fix (stretch, not required for v1)
- Parse `CPlugSolid2Model` properly: read its `ShadedGeom` array, get `VisualIndex` → `CPlugVisual` → `CPlugVertexStream` → exact Positions/Indices offsets. That would give us perfect mesh, no heuristic.
- For now, keep heuristic but make it return solid Mesh when possible, Points otherwise, Proxy otherwise – never needle.

## Acceptance
- Balloons: solid grey mesh, 4 balloons recognizable, not just dots, centered, 1-2k tris
- Duck: solid duck mesh, ~1k verts, 1-2k tris, or if truly points-only item, show as Points with note
- Santa: solid Santa mesh, sled visible
- If mesh still not found, bright proxy icosahedron (not points) so user knows it’s fallback
- No mangled needles, no blank, no point cloud that looks like noise

## What we won’t do yet
- Full material/texture support – keep grey double-sided standard
- LOD selection – just pick largest plausible mesh
- Physics mesh – ignore

