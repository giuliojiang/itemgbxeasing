export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);

  function tryFaces(posOff, cnt, faceOff) {
    if (faceOff + 4 > len) return null;
    const fc = dv.getInt32(faceOff, true);
    if (fc < 10 || fc > 10000) return null;
    let p = faceOff + 4;
    for (let isNew of [false, true]) {
      let pp = p, ok = true, tris = [];
      for (let f = 0; f < Math.min(fc, 20); f++) {
        if (pp + (isNew ? 1 : 4) > len) { ok = false; break; }
        let vc = isNew ? dv.getUint8(pp) + 3 : dv.getInt32(pp, true);
        if (vc < 3 || vc > 12) { ok = false; break; }
        pp += isNew ? 1 : 4;
        if (pp + vc * (isNew ? 2 : 4) > len) { ok = false; break; }
        let inds = [];
        for (let i = 0; i < vc; i++) {
          let idx = isNew ? dv.getUint16(pp, true) : dv.getInt32(pp, true);
          pp += isNew ? 2 : 4;
          if (idx < 0 || idx >= cnt) { ok = false; break; }
          inds.push(idx);
        }
        if (!ok) break;
        if (pp + vc * 8 + 8 > len) { ok = false; break; }
        pp += vc * 8 + 8;
        for (let i = 1; i < vc - 1; i++) tris.push([inds[0], inds[i], inds[i + 1]]);
      }
      if (ok && tris.length >= 10) {
        let full = [...tris];
        for (let f = 20; f < fc; f++) {
          if (pp + (isNew ? 1 : 4) > len) break;
          let vc = isNew ? dv.getUint8(pp) + 3 : dv.getInt32(pp, true);
          if (vc < 3 || vc > 12) break;
          pp += isNew ? 1 : 4;
          if (pp + vc * (isNew ? 2 : 4) > len) break;
          let inds = [];
          for (let i = 0; i < vc; i++) {
            let idx = isNew ? dv.getUint16(pp, true) : dv.getInt32(pp, true);
            pp += isNew ? 2 : 4;
            if (idx < 0 || idx >= cnt) break;
            inds.push(idx);
          }
          if (inds.length !== vc) break;
          if (pp + vc * 8 + 8 > len) break;
          pp += vc * 8 + 8;
          for (let i = 1; i < vc - 1; i++) full.push([inds[0], inds[i], inds[i + 1]]);
        }
        if (full.length >= 20) return { tris: full, fc, mode: isNew ? 'new' : 'old' };
      }
    }
    return null;
  }

  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt < 60 || cnt > 8000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) continue;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let ok = true;
    for (let i = 0; i < Math.min(cnt, 20); i++) {
      const x = dv.getFloat32(posOff + i * 12, true), y = dv.getFloat32(posOff + i * 12 + 4, true), z = dv.getFloat32(posOff + i * 12 + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
      if (Math.abs(x) > 50 || Math.abs(y) > 50 || Math.abs(z) > 50) { ok = false; break; }
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    if (!ok) continue;
    const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
    if (size < 0.15 || size > 15) continue;
    const after = posOff + cnt * 12;
    if (after + 4 > len) continue;
    const ec = dv.getInt32(after, true);
    if (ec >= 0 && ec <= cnt * 5) {
      if (after + 4 + ec * 4 <= len) {
        let eok = true;
        for (let i = 0; i < Math.min(ec, 8); i++) {
          const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
          if (a >= cnt || b >= cnt) { eok = false; break; }
        }
        if (eok) {
          const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
          for (let i = 0; i < ec; i++) {
            const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
            if (a < cnt && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
          }
          let tris = [], seen = new Set();
          for (let i = 0; i < cnt; i++) {
            const nb = [...adj.get(i)];
            for (let j = 0; j < nb.length; j++) for (let k = j + 1; k < nb.length; k++) {
              const a = nb[j], b = nb[k];
              if (adj.get(a).has(b)) {
                const key = [i, a, b].sort((x, y) => x - y).join(",");
                if (!seen.has(key)) { seen.add(key); tris.push([i, a, b]); }
              }
            }
          }
          if (tris.length >= 20) {
            const pos = new Float32Array(cnt * 3);
            for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
            const idx = new Uint32Array(tris.length * 3);
            for (let i = 0; i < tris.length; i++) { idx[i * 3] = tris[i][0]; idx[i * 3 + 1] = tris[i][1]; idx[i * 3 + 2] = tris[i][2]; }
            console.log(`Crystal u16 edges: cnt ${cnt} @${off} tris ${tris.length}`);
            return { positions: pos, indices: idx, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-u16`, edgeCount: ec, posOffset: posOff };
          }
        }
      }
      if (after + 4 + ec * 8 <= len) {
        let eok = true;
        for (let i = 0; i < Math.min(ec, 8); i++) {
          const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
          if (a < 0 || a >= cnt || b < 0 || b >= cnt) { eok = false; break; }
        }
        if (eok) {
          const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
          for (let i = 0; i < ec; i++) {
            const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
            if (a >= 0 && a < cnt && b >= 0 && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
          }
          let tris = [], seen = new Set();
          for (let i = 0; i < cnt; i++) {
            const nb = [...adj.get(i)];
            for (let j = 0; j < nb.length; j++) for (let k = j + 1; k < nb.length; k++) {
              const a = nb[j], b = nb[k];
              if (adj.get(a).has(b)) {
                const key = [i, a, b].sort((x, y) => x - y).join(",");
                if (!seen.has(key)) { seen.add(key); tris.push([i, a, b]); }
              }
            }
          }
          if (tris.length >= 20) {
            const pos = new Float32Array(cnt * 3);
            for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
            const idx = new Uint32Array(tris.length * 3);
            for (let i = 0; i < tris.length; i++) { idx[i * 3] = tris[i][0]; idx[i * 3 + 1] = tris[i][1]; idx[i * 3 + 2] = tris[i][2]; }
            console.log(`Crystal int32 edges: cnt ${cnt} @${off} tris ${tris.length}`);
            return { positions: pos, indices: idx, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-int32`, edgeCount: ec, posOffset: posOff };
          }
        }
      }
      for (let es of [4, 8]) {
        const fo = after + 4 + ec * es;
        const fr = tryFaces(posOff, cnt, fo);
        if (fr) {
          const pos = new Float32Array(cnt * 3);
          for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
          const idx = new Uint32Array(fr.tris.length * 3);
          for (let i = 0; i < fr.tris.length; i++) { idx[i * 3] = fr.tris[i][0]; idx[i * 3 + 1] = fr.tris[i][1]; idx[i * 3 + 2] = fr.tris[i][2]; }
          console.log(`Crystal faces: cnt ${cnt} @${off} ${fr.mode} tris ${fr.tris.length}`);
          return { positions: pos, indices: idx, vertCount: cnt, triCount: fr.tris.length, offset: off, size, method: `crystal-faces-${fr.mode}`, edgeCount: ec, posOffset: posOff };
        }
      }
    }
  }

  let candidates = [];
  for (let off = 0; off < len - 12; off += 4) {
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (Math.abs(x) > 50 || Math.abs(y) > 50 || Math.abs(z) > 50) continue;
    let minx = x, miny = y, minz = z, maxx = x, maxy = y, maxz = z;
    let cnt = 1, o = off + 12;
    while (o + 12 <= len && cnt < 8000) {
      const xx = dv.getFloat32(o, true), yy = dv.getFloat32(o + 4, true), zz = dv.getFloat32(o + 8, true);
      if (!Number.isFinite(xx) || !Number.isFinite(yy) || !Number.isFinite(zz)) break;
      if (Math.abs(xx) > 50 || Math.abs(yy) > 50 || Math.abs(zz) > 50) break;
      if (xx < minx) minx = xx; if (yy < miny) miny = yy; if (zz < minz) minz = zz;
      if (xx > maxx) maxx = xx; if (yy > maxy) maxy = yy; if (zz > maxz) maxz = zz;
      const sz = Math.max(maxx - minx, maxy - miny, maxz - minz);
      if (sz > 15) break;
      cnt++; o += 12;
    }
    if (cnt < 60) continue;
    const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
    if (size < 0.15 || size > 15) continue;
    candidates.push({ offset: off, vertCount: cnt, size, posOffset: off });
    if (candidates.length >= 12) break;
  }

  for (const cand of candidates) {
    const cnt = cand.vertCount, posOff = cand.posOffset;
    const after = posOff + cnt * 12;
    for (let delta = 0; delta < 4096; delta += 4) {
      const fo = after + delta;
      if (fo + 4 > len) break;
      const fr = tryFaces(posOff, cnt, fo);
      if (fr) {
        const pos = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
        const idx = new Uint32Array(fr.tris.length * 3);
        for (let i = 0; i < fr.tris.length; i++) { idx[i * 3] = fr.tris[i][0]; idx[i * 3 + 1] = fr.tris[i][1]; idx[i * 3 + 2] = fr.tris[i][2]; }
        console.log(`Raw faces: cnt ${cnt} @${cand.offset} delta ${delta} ${fr.mode} tris ${fr.tris.length}`);
        return { positions: pos, indices: idx, vertCount: cnt, triCount: fr.tris.length, offset: cand.offset, size: cand.size, method: `raw-faces-${fr.mode}`, posOffset: posOff };
      }
    }
    const searchEnd = Math.min(len - 6, after + 300000);
    for (let s = after; s < searchEnd; s += 2) {
      if (s + 2 + 60 > len) continue;
      const ic = dv.getUint16(s, true);
      if (ic < 60 || ic > cnt * 6 || ic % 3 !== 0) continue;
      if (s + 2 + ic * 2 > len) continue;
      let ok = true, maxIdx = 0;
      for (let i = 0; i < ic; i++) {
        const idx = dv.getUint16(s + 2 + i * 2, true);
        if (idx >= cnt || idx === 0xFFFF) { ok = false; break; }
        if (idx > maxIdx) maxIdx = idx;
      }
      if (!ok) continue;
      if (maxIdx < cnt * 0.2) continue;
      const ia = dv.getUint16(s + 2, true), ib = dv.getUint16(s + 4, true), ic0 = dv.getUint16(s + 6, true);
      const ax = dv.getFloat32(posOff + ia * 12, true), ay = dv.getFloat32(posOff + ia * 12 + 4, true), az = dv.getFloat32(posOff + ia * 12 + 8, true);
      const bx = dv.getFloat32(posOff + ib * 12, true), by = dv.getFloat32(posOff + ib * 12 + 4, true), bz = dv.getFloat32(posOff + ib * 12 + 8, true);
      const cx = dv.getFloat32(posOff + ic0 * 12, true), cy = dv.getFloat32(posOff + ic0 * 12 + 4, true), cz = dv.getFloat32(posOff + ic0 * 12 + 8, true);
      const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
      const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
      const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;
      if (area < 1e-6 || area > 10) continue;
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
      const idx = new Uint32Array(ic);
      for (let i = 0; i < ic; i++) idx[i] = dv.getUint16(s + 2 + i * 2, true);
      console.log(`Raw ib u16: cnt ${cnt} @${cand.offset} ib ${ic} tris ${ic/3} max ${maxIdx}`);
      return { positions: pos, indices: idx, vertCount: cnt, triCount: ic / 3, offset: cand.offset, size: cand.size, method: `raw-ib-u16`, posOffset: posOff };
    }
    for (let s = after; s < searchEnd; s += 4) {
      if (s + 4 + 60 > len) continue;
      const ic = dv.getInt32(s, true);
      if (ic < 60 || ic > cnt * 6 || ic % 3 !== 0 || ic > 100000) continue;
      if (s + 4 + ic * 4 > len) continue;
      let ok = true, maxIdx = 0;
      for (let i = 0; i < ic; i++) {
        const idx = dv.getInt32(s + 4 + i * 4, true);
        if (idx < 0 || idx >= cnt) { ok = false; break; }
        if (idx > maxIdx) maxIdx = idx;
      }
      if (!ok) continue;
      if (maxIdx < cnt * 0.2) continue;
      const ia = dv.getInt32(s + 4, true), ib = dv.getInt32(s + 8, true), ic0 = dv.getInt32(s + 12, true);
      const ax = dv.getFloat32(posOff + ia * 12, true), ay = dv.getFloat32(posOff + ia * 12 + 4, true), az = dv.getFloat32(posOff + ia * 12 + 8, true);
      const bx = dv.getFloat32(posOff + ib * 12, true), by = dv.getFloat32(posOff + ib * 12 + 4, true), bz = dv.getFloat32(posOff + ib * 12 + 8, true);
      const cx = dv.getFloat32(posOff + ic0 * 12, true), cy = dv.getFloat32(posOff + ic0 * 12 + 4, true), cz = dv.getFloat32(posOff + ic0 * 12 + 8, true);
      const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
      const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
      const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;
      if (area < 1e-6 || area > 10) continue;
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { pos[i * 3] = dv.getFloat32(posOff + i * 12, true); pos[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); pos[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
      const idx = new Uint32Array(ic);
      for (let i = 0; i < ic; i++) idx[i] = dv.getInt32(s + 4 + i * 4, true);
      console.log(`Raw ib u32: cnt ${cnt} @${cand.offset} ib ${ic} tris ${ic/3} max ${maxIdx}`);
      return { positions: pos, indices: idx, vertCount: cnt, triCount: ic / 3, offset: cand.offset, size: cand.size, method: `raw-ib-u32`, posOffset: posOff };
    }
  }

  if (candidates.length) {
    let best = candidates[0];
    for (const c of candidates) if (c.vertCount > best.vertCount) best = c;
    const pos = new Float32Array(best.vertCount * 3);
    for (let i = 0; i < best.vertCount; i++) {
      pos[i * 3] = dv.getFloat32(best.posOffset + i * 12, true);
      pos[i * 3 + 1] = dv.getFloat32(best.posOffset + i * 12 + 4, true);
      pos[i * 3 + 2] = dv.getFloat32(best.posOffset + i * 12 + 8, true);
    }
    console.log(`Point cloud: cnt ${best.vertCount} @${best.offset} sz ${best.size.toFixed(2)}`);
    return { positions: pos, indices: null, vertCount: best.vertCount, triCount: 0, offset: best.offset, size: best.size, method: `points-fallback`, posOffset: best.posOffset };
  }
  return null;
}
export function parseMesh(d){ const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`}; }
export function createThreeGeometry(THREE,desc){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3)); if(desc.indices&&desc.indices.length>=30){ g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals(); } g.computeBoundingBox(); g.computeBoundingSphere(); return g; }
