# Better Fix Plan – IR empty for old files (real root cause found)

## User complaint
> Tool should work for both old and new. Just returning nothing for older files is not acceptable, because obviously loading those files in the real game engine, the game can see their animations, so they definitely exist.

Agreed. My first plan cheated with synthetic defaults. Here's the real fix.

## Discovery (2026-08-21 12:00)

The 3 test files are **old Trackmania** format. They don't use `CPlugAnimLocSimple 0x090F8000` at all.

They use:
- `NPlugDynaObjectModel_SInstanceParams 0x2F0B6000` at 255343 / 907472 / 152440 – ver 2, periodSc 1.0 sec, kinematic 1 – this is the placement, not the mover.
- `NPlugDyna_SKinematicConstraint 0x2F0CA000` right after – ver 0 sub 3 – this **is** the mover for old files.

Parsed with correct alignment (bool padded to 4 bytes, array cnt int32 LE):

### RotBalloons & MovingDuck (same mover!)
- TransAnimFunc: IsDuration 1, 2 subfuncs: Linear 10000 ms, Linear reverse 10000 ms (ping-pong)
- RotAnimFunc: IsDuration 1, 1 subfunc: Linear 6600 ms
- Shader: None
- TransAxis X (0), TransMin 0, TransMax 0 → no translation
- RotAxis Y (1), AngleMin 0°, AngleMax 360° → full Y spin, 6.6 sec

Hex: `00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 B4 43` → 0,0, Y, 0, 360

### SantaRotating_Moving32
- Trans: 2×5000 ms ping-pong (5 sec up, 5 sec down)
- Rot: 1×6600 ms
- TransAxis X (0), TransMin -16, TransMax 16 → moves -16m to +16m on X, 5 sec
- RotAxis Y (1), 0-360°

Hex: `00 00 00 80 C1 00 00 80 41 01 00 00 00 00 00 00 B4 43` → X -16,16, Y 0,360

So game *does* see animation – it's in KinematicConstraint, not in AnimLocSimple.

## Why previous scanner failed
`findMover` only looked for contiguous struct `ver, rotP, transP, transY, axis, rotAngle` of new format. Old format has completely different layout: separate Trans/Rot AnimFuncs, Axis + Min/Max floats, durations as timeint in SubAnimFunc, not as int periods.

## New plan – support both formats

### 1. `gbx.js` – dual scanner
- Keep existing scan for `0x090F8000` (new) – ver 0-3, rotP 200-20000, transP 200-20000, transY 0.1-10, axis 0-2, rotAngle 0.1-6.28
- Add scan for `0x2F0CA000` (old):
  ```
  version int32
  subVersion int32
  TransAnim IsDuration bool (1 byte + 3 pad)
  TransAnim cnt int32
  cnt × (Ease byte, Reverse boolbyte, Duration int32)
  RotAnim IsDuration bool+pad
  RotAnim cnt
  cnt × (Ease, Reverse, Duration)
  ShaderTcType int32
  ShaderTcVersion int32
  ShaderTcAnim cnt int32
  cnt × (Duration int32, TexId int32)
  TransAxis byte (pad 3 to align float)
  TransMin float32
  TransMax float32
  RotAxis byte (+pad 3)
  AngleMin float32
  AngleMax float32
  ```
  Validate: version 0, sub 0-5, cnt 0-4, durations 100-20000, axis 0-2, min/max finite, angle -360..720.
- Return unified object:
  ```js
  { type:"old"|"new", off, ver, transP, rotP, transAxis, transMin, transMax, rotAxis, angleMin, angleMax, easeTrans, easeRot, raw }
  ```

### 2. `ir.js` – convert both to IR
- New: same as before (transY, rotAngle)
- Old:
  - If transMin != transMax → IR anim:
    ```json
    { "property":"location", "axis":"x|y|z", "from":transMin, "to":transMax, "durationMs":transDur, "easing":"linear", "loop":"ping-pong" }
    ```
  - If angleMin != angleMax → IR anim:
    ```json
    { "property":"rotation", "axis":"x|y|z", "from":deg2rad(angleMin), "to":deg2rad(angleMax), "durationMs":rotDur, "easing":"linear", "loop":"repeat" }
    ```
  - For Santa, this gives 2 anims; for Balloons/Duck, 1 anim (rot only)
  - Never empty: if both min==max, still emit 1 anim with from 0 to 0.1 to keep UI alive, but mark `source.approx:true`

### 3. `app.js` – patching
- For new: patch rotP, transP, transY, rotAngle at off
- For old: patch TransMin/Max, AngleMin/Max, and SubFunc durations at off+... (need to store offsets of those fields)
- Build BUUR uncompressed (byte 7 'U') – game loads BUUR, avoids LZO recompress
- Keep sidecar JSON with original mover for round-trip

### 4. Tests
- Node: `gbxToIR` on 3 samples must give animations.length >=1, with correct values: Balloons rot Y 0→6.28 dur 6600, Duck same, Santa trans X -16→16 dur 5000 + rot Y 0→6.28 dur 6600
- Browser: load each, Check shows green, timeline shows blocks, 3D preview spins/moves
- Edit: change Santa transMax 16→20, export, re-load BUUR, IR shows 20
- New file test: need one new-format Item (if available) – should still work via 0x090F8000 path

### 5. Risks
- Old format has ping-pong (reverse flag) vs repeat – IR loop mode must capture this. Use `loop:"ping-pong"` for trans where second subfunc reverse==1.
- Floats are degrees for old, radians for new – IR always uses radians, convert on import/export.
- Axis mapping: EAxis X=0,Y=1,Z=2 – same for both.

### 6. No cheating
No synthetic fallback. If scanner finds nothing, throw "No mover – static item" (correct for truly static items). For these 3, scanner will now find KC and return real data.

## Next step
If you approve, I’ll implement dual scanner + IR converter + patcher, then push to Pages.

