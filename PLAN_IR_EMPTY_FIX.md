# Fix Plan – IR animations always empty

## Symptom
User loads any `*.Item.Gbx` in the studio (https://giuliojiang.github.io/itemgbxeasing/). The IR textarea shows:

```json
"animations": []
```

Expected: 1-2 anims (float and/or spin) derived from mover.

## Where it breaks
Flow: `File → parseGBX → decompress → findMover → gbxToIR → textarea`

Current code in `app.js`:
```js
let mover=null;
try{ mover=findMover(out) } catch(e){ mover=null }
irObj=gbxToIR({mover,...})
```

`gbxToIR` in `ir.js` only creates anims if `mover` exists and has `transP>0` or `rotP>0` with plausible `transY`/`rotAng`.

If `findMover` throws, `mover=null` → `anims=[]`.

## Why it likely throws
1. Strict first pass in `gbx.js` requires `|transY|>=0.02` when `transP>0` and `|rotAng|>=0.02` when `rotP>0`. Real mover in these files may have version 0/1 where those fields are stored differently, or are in `NPlugDynaObjectModel_SInstanceParams` not `CPlugAnimLocSimple`.
2. Fallback second pass still needs `axis 0-2` and finite floats. If decomp on Pages (minilzo JS) differs by 1 byte from Node python-lzo, offset shifts and scan misses.
3. Even when fallback returns a synthetic mover (transP 2), `gbxToIR` may filter it out if `transY` tiny or `rotAng` tiny.

Result: user sees empty array for all items, including the 3 test items.

## Plan to fix (do not implement yet)

### 1. Make `gbxToIR` never empty when a file loaded
- If `mover==null`, create default IR with 1 gentle float + 1 spin based on file name heuristics:
  - filename contains "Rot" → spin 3.14 rad, 4000 ms
  - "Mov" or "Float" → float 1.5 m, 2500 ms
  - else → both with safe defaults
- This guarantees textarea is never `[]`, unblocks user.

### 2. Fix `findMover` to not throw on these files
- Add third pass: search for `PeriodSc` in `NPlugDynaObjectModel_SInstanceParams` (0x2F0B6000) – we already found it at 255k/907k/152k. Its `period` float is mover period.
- If found, synthesize mover from it: `rotP = period*1000`, `transP = period*1000`, `transY=1.5`, `axis=1`, `rotAng=3.14`.
- Log which pass succeeded (`strict`/`fallback`/`dynaParams`) in `source.moverOffset` note.

### 3. Update `ir.js` placeholder logic
- Currently placeholder only added if `mover` exists but anims empty. Change to: if `mover` exists and both periods zero → still emit 1 float with `to = transY||1`.
- Ensure `gbxToIR` always returns >=1 anim when called from file load.

### 4. Tests (before push)
- Node tests on 3 samples: `zzz_RotBalloons`, `MovingDuck`, `SantaRotating` must produce `animations.length >=1`.
- Browser manual: load each file, check textarea JSON has `animations[0]`, Check button shows green, timeline shows block, 3D preview moves.
- Export test: modify `to` from 1.5→2.5, export BUUR, re-load exported file (BUUR path) → IR still has edited value.

### 5. Rollout
- Commit `gbx.js`, `ir.js`, `app.js` with message "Fix empty IR – always emit at least 1 anim, add DynaParams fallback"
- Push to main, verify Pages hard-refresh loads new `gbx.js`.

## Risks
- Synthetic mover offset is not true game mover – patching it may not affect in-game movement. Mitigation: note in UI "approx mover – real offset not found" and allow user to still export (game will load BUUR but may not move as expected). Better than empty IR.

## Open question for you
Do you want IR to default to both float+spin for all items, or try to guess from filename?
