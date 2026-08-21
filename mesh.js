export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);

  function tryFaces(posOff, cnt, stride, faceOff, log) {
    if (faceOff + 4 > len) return null;
    const fc = dv.getInt32(faceOff, true);
    if (fc < 10 || fc > 10000) {
      if (log) console.log(`  faces @${faceOff} fc ${fc} reject`);
      return null;
    }
    if (log) console.log(`  trying faces @${faceOff} fc ${fc}`);
    let p = faceOff + 4;
    for (let isNew of [false, true]) {
      let pp = p, ok = true, tris = [];
      for (let f = 0; f < Math.min(fc, 20); f++) {
        if (pp + (isNew ? 1 : 4) > len) { ok = false; break; }
        let vc = isNew ? dv.getUint8(pp) + 3 : dv.getInt32(pp, true);
        if (vc < 3 || vc > 12) { ok = false; break; }
        pp += isNew ? 1 : 4;
        if (pp + vc * (isNew ? 2 : 4) > len) { ok = false; break; }
        for (let i = 0; i < vc; i++) {
          let idx = isNew ? dv.getUint16(pp, true) : dv.getInt32(pp, true);
          pp += isNew ? 2 : 4;
          if (idx < 0 || idx >= cnt) { ok = false; break; }
        }
        if (!ok) break;
        if (pp + vc * 8 + 8 > len) { ok = false; break; }
        pp += vc * 8 + 8;
        for (let i = 1; i < vc - 1; i++) tris.push(1);
      }
      if (ok && tris.length >= 10) {
        if (log) console.log(`    faces ${isNew?'new':'old'} first 20 ok tris~${tris.length}`);
        let full = [...tris];
        for (let f = 20; f < fc; f++) {
          if (pp + (isNew ? 1 : 4) > len) break;
          let vc = isNew ? dv.getUint8(pp) + 3 : dv.getInt32(pp, true);
          if (vc < 3 || vc > 12) break;
          pp += isNew ? 1 : 4;
          if (pp + vc * (isNew ? 2 : 4) > len) break;
          let ok2 = true;
          for (let i = 0; i < vc; i++) {
            let idx = isNew ? dv.getUint16(pp, true) : dv.getInt32(pp, true);
            pp += isNew ? 2 : 4;
            if (idx < 0 || idx >= cnt) { ok2 = false; break; }
          }
          if (!ok2) break;
          if (pp + vc * 8 + 8 > len) break;
          pp += vc * 8 + 8;
          for (let i = 1; i < vc - 1; i++) full.push(1);
        }
        if (full.length >= 20) {
          // Rebuild real tris for return
          pp = p;
          let realTris = [];
          for (let f = 0; f < fc; f++) {
            if (pp + (isNew ? 1 : 4) > len) break;
            let vc = isNew ? dv.getUint8(pp) + 3 : dv.getInt32(pp, true);
            if (vc < 3 || vc > 12) break;
            pp += isNew ? 1 : 4;
            if (pp + vc * (isNew ? 2 : 4) > len) break;
            let inds = [];
            for (let i = 0; i < vc; i++) {
              let idx = isNew ? dv.getUint16(pp, true) : dv.getInt32(pp, true);
              pp += isNew ? 2 : 4;
              inds.push(idx);
            }
            if (pp + vc * 8 + 8 > len) break;
            pp += vc * 8 + 8;
            for (let i = 1; i < vc - 1; i++) realTris.push([inds[0], inds[i], inds[i + 1]]);
          }
          return { tris: realTris, fc, mode: isNew ? 'new' : 'old' };
        }
      }
    }
    if (log) console.log(`  faces @${faceOff} no mode worked`);
    return null;
  }

  function getPos(off, stride, i) {
    return [dv.getFloat32(off + i * stride, true), dv.getFloat32(off + i * stride + 4, true), dv.getFloat32(off + i * stride + 8, true)];
  }

  let candidates = [];
  for (let off = 0; off < len - 12; off += 4) {
    for (let stride of [12, 24, 32, 36]) {
      if (off + stride > len) continue;
      const x0 = dv.getFloat32(off, true), y0 = dv.getFloat32(off + 4, true), z0 = dv.getFloat32(off + 8, true);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(z0)) continue;
      if (Math.abs(x0) > 50 || Math.abs(y0) > 50 || Math.abs(z0) > 50) continue;
      let minx = x0, miny = y0, minz = z0, maxx = x0, maxy = y0, maxz = z0;
      let cnt = 1, o = off + stride;
      while (o + 12 <= len && cnt < 8000) {
        const xx = dv.getFloat32(o, true), yy = dv.getFloat32(o + 4, true), zz = dv.getFloat32(o + 8, true);
        if (!Number.isFinite(xx) || !Number.isFinite(yy) || !Number.isFinite(zz)) break;
        if (Math.abs(xx) > 50 || Math.abs(yy) > 50 || Math.abs(zz) > 50) break;
        if (xx < minx) minx = xx; if (yy < miny) miny = yy; if (zz < minz) minz = zz;
        if (xx > maxx) maxx = xx; if (yy > maxy) maxy = yy; if (zz > maxz) maxz = zz;
        const sz = Math.max(maxx - minx, maxy - miny, maxz - minz);
        if (sz > 15) break;
        cnt++; o += stride;
      }
      if (cnt < 60) continue;
      const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
      if (size < 0.15 || size > 15) continue;
      if (candidates.some(c => c.offset === off && c.stride === stride)) continue;
      candidates.push({ offset: off, vertCount: cnt, size, posOffset: off, stride, minx, miny, minz, maxx, maxy, maxz });
      if (candidates.length >= 20) break;
    }
    if (candidates.length >= 20) break;
  }
  candidates.sort((a, b) => b.vertCount - a.vertCount);
  console.log(`found ${candidates.length} raw candidates`);
  for (let ci = 0; ci < Math.min(candidates.length, 5); ci++) {
    const c = candidates[ci];
    console.log(` cand ${ci}: cnt ${c.vertCount} @${c.offset} stride ${c.stride} sz ${c.size.toFixed(2)}`);
  }

  for (const cand of candidates) {
    const cnt = cand.vertCount, posOff = cand.posOffset, stride = cand.stride;
    const after = posOff + cnt * stride;
    const isBig = cnt > 1000;
    if (isBig) {
      let hex = '', ints = '', u16s = '';
      for (let i = 0; i < 32 && after + i < len; i++) hex += dv.getUint8(after + i).toString(16).padStart(2, '0') + ' ';
      for (let i = 0; i < 4 && after + i * 4 + 4 <= len; i++) ints += dv.getInt32(after + i * 4, true) + ' ';
      for (let i = 0; i < 8 && after + i * 2 + 2 <= len; i++) u16s += dv.getUint16(after + i * 2, true) + ' ';
      console.log(`candidate cnt ${cnt} @${cand.offset} stride ${stride} sz ${cand.size.toFixed(2)} after ${after} hex ${hex} | int32 ${ints} | u16 ${u16s}`);
    }
    // faces
    for (let delta = 0; delta < 4096; delta += 4) {
      const fo = after + delta;
      if (fo + 4 > len) break;
      const fr = tryFaces(posOff, cnt, stride, fo, isBig && delta === 0);
      if (fr) {
        const pos = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { const p = getPos(posOff, stride, i); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
        const idx = new Uint32Array(fr.tris.length * 3);
        for (let i = 0; i < fr.tris.length; i++) { idx[i * 3] = fr.tris[i][0]; idx[i * 3 + 1] = fr.tris[i][1]; idx[i * 3 + 2] = fr.tris[i][2]; }
        console.log(`Raw faces: cnt ${cnt} @${cand.offset} stride ${stride} delta ${delta} ${fr.mode} tris ${fr.tris.length}`);
        return { positions: pos, indices: idx, vertCount: cnt, triCount: fr.tris.length, offset: cand.offset, size: cand.size, method: `raw-faces-${fr.mode}`, posOffset: posOff, stride };
      }
      if (isBig && delta === 0) console.log(`  no faces at after`);
    }
    const searchEnd = Math.min(len - 6, after + 300000);
    let ibTries = 0, ibRejectBad = 0, ibRejectRange = 0;
    for (let s = after; s < searchEnd; s += 2) {
      if (s + 2 + 60 > len) continue;
      const ic = dv.getUint16(s, true);
      if (ic < 60 || ic > cnt * 6 || ic % 3 !== 0) continue;
      if (s + 2 + ic * 2 > len) continue;
      ibTries++;
      if (ibTries > 2000) break;
      let ok = true, maxIdx = 0, bad = 0;
      for (let i = 0; i < ic; i++) {
        const idx = dv.getUint16(s + 2 + i * 2, true);
        if (idx === 0xFFFF) continue;
        if (idx >= cnt) { bad++; if (bad > ic * 0.15) { ok = false; break; } }
        else if (idx > maxIdx) maxIdx = idx;
      }
      if (!ok) { ibRejectBad++; continue; }
      if (maxIdx < cnt * 0.15) { ibRejectRange++; continue; }
      // area
      let first = -1;
      for (let i = 0; i < ic - 2; i++) {
        const a = dv.getUint16(s + 2 + i * 2, true), b = dv.getUint16(s + 2 + (i + 1) * 2, true), c = dv.getUint16(s + 2 + (i + 2) * 2, true);
        if (a >= cnt || b >= cnt || c >= cnt || a === 0xFFFF || b === 0xFFFF || c === 0xFFFF) continue;
        first = i; break;
      }
      if (first === -1) continue;
      const ia = dv.getUint16(s + 2 + first * 2, true), ib = dv.getUint16(s + 2 + (first + 1) * 2, true), ic0 = dv.getUint16(s + 2 + (first + 2) * 2, true);
      const pa = getPos(posOff, stride, ia), pb = getPos(posOff, stride, ib), pc = getPos(posOff, stride, ic0);
      const abx = pb[0] - pa[0], aby = pb[1] - pa[1], abz = pb[2] - pa[2], acx = pc[0] - pa[0], acy = pc[1] - pa[1], acz = pc[2] - pa[2];
      const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
      const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;
      if (area < 1e-6 || area > 10) continue;
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { const p = getPos(posOff, stride, i); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
      let out = [];
      for (let i = 0; i < ic; i++) {
        const idx = dv.getUint16(s + 2 + i * 2, true);
        if (idx === 0xFFFF || idx >= cnt) continue;
        out.push(idx);
      }
      out = out.slice(0, Math.floor(out.length / 3) * 3);
      if (out.length < 60) continue;
      const idx = new Uint32Array(out);
      console.log(`Raw ib u16: cnt ${cnt} @${cand.offset} stride ${stride} ib ${ic} @${s} valid ${out.length} tris ${out.length/3} max ${maxIdx} bad ${bad}`);
      return { positions: pos, indices: idx, vertCount: cnt, triCount: out.length / 3, offset: cand.offset, size: cand.size, method: `raw-ib-u16`, posOffset: posOff, stride };
    }
    if (isBig) console.log(`  u16 ib: tried ${ibTries} rejectBad ${ibRejectBad} rejectRange ${ibRejectRange}`);
    // u32
    let ib32Tries = 0;
    for (let s = after; s < searchEnd; s += 4) {
      if (s + 4 + 60 > len) continue;
      const ic = dv.getInt32(s, true);
      if (ic < 60 || ic > cnt * 6 || ic % 3 !== 0 || ic > 100000) continue;
      if (s + 4 + ic * 4 > len) continue;
      ib32Tries++;
      if (ib32Tries > 2000) break;
      let ok = true, maxIdx = 0;
      for (let i = 0; i < ic; i++) {
        const idx = dv.getInt32(s + 4 + i * 4, true);
        if (idx < 0 || idx >= cnt) { ok = false; break; }
        if (idx > maxIdx) maxIdx = idx;
      }
      if (!ok) continue;
      if (maxIdx < cnt * 0.15) continue;
      const ia = dv.getInt32(s + 4, true), ib = dv.getInt32(s + 8, true), ic0 = dv.getInt32(s + 12, true);
      const pa = getPos(posOff, stride, ia), pb = getPos(posOff, stride, ib), pc = getPos(posOff, stride, ic0);
      const abx = pb[0] - pa[0], aby = pb[1] - pa[1], abz = pb[2] - pa[2], acx = pc[0] - pa[0], acy = pc[1] - pa[1], acz = pc[2] - pa[2];
      const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
      const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;
      if (area < 1e-6 || area > 10) continue;
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { const p = getPos(posOff, stride, i); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
      const idx = new Uint32Array(ic);
      for (let i = 0; i < ic; i++) idx[i] = dv.getInt32(s + 4 + i * 4, true);
      console.log(`Raw ib u32: cnt ${cnt} @${cand.offset} stride ${stride} ib ${ic} @${s} tris ${ic/3} max ${maxIdx}`);
      return { positions: pos, indices: idx, vertCount: cnt, triCount: ic / 3, offset: cand.offset, size: cand.size, method: `raw-ib-u32`, posOffset: posOff, stride };
    }
    if (isBig) console.log(`  u32 ib tried ${ib32Tries}`);
  }

  if (candidates.length) {
    let best = candidates[0];
    for (const c of candidates) if (c.vertCount > best.vertCount) best = c;
    const pos = new Float32Array(best.vertCount * 3);
    for (let i = 0; i < best.vertCount; i++) { const p = getPos(best.posOffset, best.stride, i); pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
    console.log(`Point cloud: cnt ${best.vertCount} @${best.offset} stride ${best.stride} sz ${best.size.toFixed(2)}`);
    return { positions: pos, indices: null, vertCount: best.vertCount, triCount: 0, offset: best.offset, size: best.size, method: `points-fallback`, posOffset: best.posOffset, stride: best.stride };
  }
  return null;
}
export function parseMesh(d){ const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`}; }
export function createThreeGeometry(THREE,desc){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3)); if(desc.indices&&desc.indices.length>=30){ g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals(); } g.computeBoundingBox(); g.computeBoundingSphere(); return g; }
