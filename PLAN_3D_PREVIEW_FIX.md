# Plan – 3D preview shows nothing (Check + Preview)

## Symptom
User loads any Item.Gbx, IR anims now show correctly (1-2 anims), but 3D canvas stays black/empty even after Check + Preview. Proxy icosahedron also not visible.

## Current stack
- `index.html` importmap: `"three": "https://unpkg.com/three@0.160.0/build/three.module.js"`
- `app.js` imports `OrbitControls` from `https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js`
- `mesh.js` heuristic: scan stride 12/24/32/36 for vert blocks, then ib search within 80k after verts
- `preview.js` sampleIR returns trans vec + rot vec, `app.js` animate loop applies to `itemRoot`
- Canvas in `.canvasWrap` height 460px, renderer `setSize(r.width,r.height,false)`, `setPixelRatio`

## Hypotheses (most likely first)

### H1 – Import / CORS breaks Three entirely
OrbitControls from unpkg does `import * as THREE from 'three'` – relies on importmap. Some browsers (Safari, older Chrome) ignore importmap for nested imports, so `THREE` is undefined and script throws before renderer is created. Canvas stays blank, no error shown in UI.

Evidence: Console would show `Uncaught TypeError: Failed to resolve module specifier "three"` or `OrbitControls is not a constructor`.

### H2 – Canvas size 0 because previewCard hidden at init
`resize()` called at startup when `#previewCard` is `display:none`. `getBoundingClientRect()` returns 0×0, renderer size 0×0. After file load we set `previewCard.style.display='block'` but never call `resize()` again, so WebGL still 0×0. Nothing draws.

### H3 – Mesh geometry invalid / invisible
- Positions all NaN or huge (>200 filtered but still large) → Box3 empty → camera framed at infinity or looking at 0,0,0 while mesh at 100,100,100
- No normals + MeshStandardMaterial black on black background → invisible
- Indices out of range or 32-bit needed but we give Uint16 → Three throws `computeVertexNormals` error, caught and we fall back to proxy, but proxy also invisible due to H1/H2
- Duck has 84 points, no ib – we try to render as Mesh with no indices → invisible (should be Points)

### H4 – Lighting / material
Standard material needs lights – we have ambient 0.9 + dir 1.2, should be ok, but if mesh is inside-out (normals inverted) and we cull backfaces, it appears black.

### H5 – Animation moves object out of view
Santa X -16→16 moves 32m, camera framed to maxDim*1.8 ~ 3m, object flies off-screen instantly. SampleIR adds trans.x to position.x, so at t=0 pos -16, off-screen.

## Investigation steps (do before fixing)

1. Open Pages with DevTools console, load file, note any red errors (importmap, OrbitControls, THREE undefined)
2. Add temporary `console.log('three', THREE.REVISION, 'controls', OrbitControls)` after imports – if undefined, H1 confirmed
3. Log `renderer.domElement.width/height` after loadFile and after showing previewCard – if 0, H2 confirmed
4. Log `parseMesh` result: `verts`, `ibCount`, first 3 positions, Box3 size, is finite
5. Force showProxy alone (skip mesh) – does icosahedron appear? If no, bug is not mesh, it's renderer/controls
6. Try minimal cube scene without OrbitControls to isolate Three setup
7. Check material: switch to `MeshBasicMaterial` wireframe – if it appears, lighting issue

## Fix plan (once confirmed)

### Fix A – Make Three imports bulletproof
- Vendor `three.module.js` + `OrbitControls.js` locally in repo (copy from 0.160.0) and import via relative `./three/...` – no importmap needed, works everywhere
- Or use `es-module-shims` + importmap polyfill

### Fix B – Resize after showing
- In `loadFile`, after `previewCard.style.display='block'`, call `resize()` and `renderer.setSize`
- Also call `resize()` on `window` resize and on `ResizeObserver` for canvasWrap
- Ensure `renderer.setSize(r.width, r.height, false)` + `canvas.style.width/height = 100%`

### Fix C – Always-visible proxy + fallback
- `showProxy` should use `MeshBasicMaterial` with bright color + wireframe false, double-sided, so it’s visible even without lights
- Add grid + axes helper, ensure camera looks at 0,0,0 initially, not at box center that might be NaN
- If `parseMesh` fails, still show proxy and log reason in UI

### Fix D – Mesh robustness
- Validate positions finite, discard blocks with NaN
- Compute normals only if indices exist, else skip
- If no indices and vertCount >=30, render as `THREE.Points` with `PointsMaterial` size 0.05
- For indices, always use Uint32 if vertCount>65535, else Uint16, and set `geo.setIndex` correctly
- Double-sided material: `side: THREE.DoubleSide`

### Fix E – Preview motion clamping
- For preview only, scale translation down to fit view: divide trans by 4 if |trans|>4, or use normalized lerp -1→1 for preview
- Or keep camera framing but also move camera target with object? Simpler: preview trans scaled to 0.3× for visibility
- Keep real export values untouched – preview scaling is visual only

### Fix F – Debug UI
- Add small debug panel in preview card: “verts 9526, ib 4800, box size 2.1, renderer 420×460, THREE r160”
- Log any mesh build errors to `meshInfo`

## Acceptance test
- Load RotBalloons, MovingDuck, Santa – each shows *something* (real mesh or bright proxy) immediately after file load, without pressing Check
- Press Check + Preview – proxy/mesh starts moving (spin or slide), orbit drag works, wheel zoom works
- No console red errors
- Points file (Duck 84) shows as small cloud, not blank
- Resize window – canvas resizes, still visible

## No-go
Don’t rewrite mesh extractor to full CPlugCrystal parser yet – keep heuristic, just make it robust and always fall back to visible proxy.

