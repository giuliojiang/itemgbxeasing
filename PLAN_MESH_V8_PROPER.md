# Plan v8 – Proper Mesh Parsing (Stop Guessing)

## Problem
Current heuristic float-run + direct offset finds plausible buffers but hits NaN:
- `97617` file: `ib @40680 cnt 3366 max 997` paired with `998 @28704 stride12 gap0 sz1.44 valid20` but positions contain NaN -> THREE `computeBoundingBox NaN`
- `MovingDuck` 908k: 0 raw candidates before, now direct finds `2501 @70725` but may also have hidden NaN for other files
- Santa/Balloons work by accident, not by spec

Root cause: We are scanning for any float32 run that looks like positions, not parsing the actual `CPlugVertexStream` / `CPlugVisualIndexed` / `CPlugIndexBuffer` chunks. Real files interleave positions, normals, UVs, tangents with stride 24/32/36 and DataDecl describing offset.

## What we must research (not guess)

1. **GBX.NET source – proper spec**
   - `CPlugVertexStream` Chunk `0x09056000` (and variants `0x09006000` etc): `Version int32`, `count int32`, `flags uint32`, `streamModel NodeRef`, `DataDecl[]` where `version = Version | (count<<3)`, `DataDecl` = `flags1 uint32`, `flags2 uint32`, `Type = (flags1>>9)&0x1FF`, `Offset uint16`, `WeightCount = flags1 & 0x1FF`
   - `CPlugVisualIndexed` `0x0906A000`: contains `VertexStreams[]` and `IndexBuffer`
   - `CPlugIndexBuffer` `0x09057001` new: `flags int32`, `count int32`, `indices delta int16` (`cur+=ReadInt16`), `0x09057000` old: `flags`, `count`, `uint16[]`
   - `CPlugSolid2Model` `0x090BB000`: contains `ShadedGeoms[]` each with `Visuals[]`

   Need to find actual Type enum values: `Float3 = 2?`, `Float2 = 1?`, `Dec3N = ?`, `Position = 0?`, `Normal = 1?`, `TexCoord = 2?`

2. **Why 998@28704 has NaN**
   - Dump 998*12 bytes at 28704 for 97617 file, check for 0xFF 0xFF 0xFF 0xFF patterns, or values >1e10
   - If NaN present, that buffer is NOT positions – it's maybe normals (Dec3N) or padding
   - True positions likely at 600 (3333 verts) with stride 12, size 6.49, no NaN – that one never had NaN in logs
   - ib max 997 with 3333 verts is valid (uses subset), but then why stretched? Because we used 3333 verts with ib that expects 998 verts but indices 0..997 map to first 998 verts of 3333, which should be valid and not stretched. Stretched suggests we used wrong vertex buffer (e.g., normals as positions)

3. **Proper parser steps**
   - Find all `0x09056000` chunks in decomp, parse count and DataDecls, extract Positions array offset correctly
   - For each VisualIndexed, get its VertexStream count and IndexBuffer count, pair them by proximity and by count matching (count should equal maxI+1 or larger)
   - Validate: all positions finite, size 0.1..50, triArea sample > 5 valid, no NaN
   - If multiple Visuals, return all as separate geometries (user's file may have 2-3 submeshes), not just one

4. **Testing**
   - Use 3 local files + 97617 file (need user to provide) + 899 file (153687 len but different)
   - For each, dump via GBX.NET (once API fixed) to get ground truth positions/indices, compare to JS parser
   - Ensure no regression: Balloons 2856 crystal, Santa 649/899, Duck 2501, 97617 3333 or 998, all solid, no NaN, no sphere fallback

## What to do now (no code yet)
- Get 97617 file from user (the one that gives NaN) – we don't have it in workspace
- Fix GBX.NET dump tool to use `Gbx.Parse` new API, export positions/indices to JSON for ground truth
- Write JS chunk reader for VertexStream that mirrors C# logic, not float-run heuristic
- Then implement, test, push

## Do not do
- Do not add more gap values, stride guesses, or candidate heuristics
- Do not hardcode file-specific offsets (600, 28704, 70725, 40680)
- Do not push until plan reviewed
