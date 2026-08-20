# itemgbxeasing

GBX Moving Item Editor – pure HTML+JS, no workers (works in sandboxed iframe and GitHub Pages).

- Drop `*.Item.Gbx` (Tested: RotBalloons, MovingDuck, Santa)
- Decompresses BUCR → BUUR body via JS LZO (fast, chunked UI)
- Heuristic scan for `CPlugAnimLocSimple` – version / RotPeriod / TransPeriod / TransY / Axis / RotMax / TransMax / RotFunc / RotAngle
- Web-like easing tracks (translate / rotate) – bake to mover
- Export BUUR uncompressed (game loads it)

## Live

Enable Pages: Settings → Pages → Deploy from branch `main` `/` → https://giuliojiang.github.io/itemgbxeasing/

## Perf fix

Previous build froze for minutes: decompress + full scan on main thread. This build:
- `lzo.js` ES module, no Worker needed (Pages CSP friendly)
- `decompressYielding` + `scanMoversChunked` yields every 16k steps via `setTimeout(0)`
- Virtual hex preview (1KB only)

