/**
 * mesh.js – Robust Crystal mesh extractor for Item.Gbx
 * v5 – solid for 3333v via u16 edges + Face triangulation
 */

export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;

  function tryFaceTriangulation(posOff, cnt, faceOff) {
    if (faceOff + 4 > len) return null;
    const faceCnt = dv.getInt32(faceOff, true);
    if (faceCnt < 20 || faceCnt > 8000) return null;
    let p = faceOff + 4;
    let tris = [];
    // Try two modes: old (vertCount int32, inds int32) and new (vertCount byte+3, inds u16)
    for (let mode = 0; mode < 2; mode++) {
      const isNew = mode === 1;
      let pp = p;
      let ok = true;
      let tmpTris = [];
      for (let f = 0; f < Math.min(faceCnt, 30); f++) {
        if (pp + (isNew ? 1 : 4) > len) { ok = false; break; }
        let vc;
        if (isNew) {
          const b = dv.getUint8(pp);
          vc = b + 3;
          if (vc < 3 || vc > 12) { ok = false; break; }
          pp += 1;
        } else {
          vc = dv.getInt32(pp, true);
          if (vc < 3 || vc > 12) { ok = false; break; }
          pp += 4;
        }
        if (pp + vc * (isNew ? 2 : 4) > len) { ok = false; break; }
        let inds = [];
        for (let i = 0; i < vc; i++) {
          let idx;
          if (isNew) {
            idx = dv.getUint16(pp, true);
            pp += 2;
          } else {
            idx = dv.getInt32(pp, true);
            pp += 4;
          }
          if (idx < 0 || idx >= cnt) { ok = false; break; }
          inds.push(idx);
        }
        if (!ok) break;
        // UVs
        if (pp + vc * 8 > len) { ok = false; break; }
        pp += vc * 8;
        // mat + grp
        if (pp + 8 > len) { ok = false; break; }
        pp += 8;
        // triangulate fan
        for (let i = 1; i < vc - 1; i++) {
          tmpTris.push([inds[0], inds[i], inds[i + 1]]);
        }
        if (tmpTris.length > cnt * 4) { ok = false; break; }
      }
      if (ok && tmpTris.length >= 20) {
        // parse rest to get full tris count
        let fullTris = [...tmpTris];
        for (let f = 30; f < faceCnt; f++) {
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
          for (let i = 1; i < vc - 1; i++) fullTris.push([inds[0], inds[i], inds[i + 1]]);
          if (fullTris.length > cnt * 4) break;
        }
        return { tris: fullTris, faceCnt, mode: isNew ? 'new-byte+3-u16' : 'old-int32', nextP: pp };
      }
    }
    return null;
  }

  // 1. Crystal with int32 edges (old)
  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt < 80 || cnt > 6000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) continue;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let ok = true, zero = 0;
    for (let i = 0; i < Math.min(cnt, 60); i++) {
      const x = dv.getFloat32(posOff + i * 12, true), y = dv.getFloat32(posOff + i * 12 + 4, true), z = dv.getFloat32(posOff + i * 12 + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
      if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6) zero++;
      if (Math.abs(x) > 30 || Math.abs(y) > 30 || Math.abs(z) > 30) { ok = false; break; }
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    if (!ok || zero > 30) continue;
    const sx = maxx - minx, sy = maxy - miny, sz = maxz - minz;
    const size = Math.max(sx, sy, sz);
    if (size < 0.2 || size > 12) continue;
    if (Math.min(sx, sy, sz) < size * 0.02 && cnt > 200) continue;
    const after = posOff + cnt * 12;
    if (after + 4 > len) continue;
    const edgeCnt = dv.getInt32(after, true);
    if (edgeCnt < cnt * 0.3 || edgeCnt > cnt * 3) continue;
    if (after + 4 + edgeCnt * 8 > len) continue;
    let edgesOk = true;
    for (let i = 0; i < Math.min(edgeCnt, 16); i++) {
      const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
      if (a < 0 || a >= cnt || b < 0 || b >= cnt || a === b) { edgesOk = false; break; }
    }
    if (!edgesOk) continue;
    // Try edge->tris
    const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
    for (let i = 0; i < edgeCnt; i++) {
      const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
      if (a >= 0 && a < cnt && b >= 0 && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
    }
    let tris = []; let seen = new Set();
    for (let i = 0; i < cnt; i++) {
      const neigh = [...adj.get(i)];
      if (neigh.length < 2) continue;
      for (let j = 0; j < neigh.length; j++) for (let k = j + 1; k < neigh.length; k++) {
        const a = neigh[j], b = neigh[k];
        if (adj.get(a).has(b)) {
          const s = [i, a, b].sort((x, y) => x - y).join(",");
          if (!seen.has(s)) { seen.add(s); tris.push([i, a, b]); }
        }
      }
      if (tris.length > cnt * 4) break;
    }
    if (tris.length >= cnt * 0.3 && tris.length <= cnt * 3 && tris.length >= 20) {
      const positions = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
        positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
        positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
      }
      const indices = new Uint32Array(tris.length * 3);
      for (let i = 0; i < tris.length; i++) { indices[i * 3] = tris[i][0]; indices[i * 3 + 1] = tris[i][1]; indices[i * 3 + 2] = tris[i][2]; }
      const faceOff = after + 4 + edgeCnt * 8;
      const faceCnt = faceOff + 4 <= len ? dv.getInt32(faceOff, true) : 0;
      console.log(`Crystal mesh int32 edges: cnt ${cnt} @${off} sz ${size.toFixed(2)} edge ${edgeCnt} face ${faceCnt} tris ${tris.length}`);
      return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-int32`, faceCount: faceCnt, edgeCount: edgeCnt, posOffset: posOff };
    }
    // Try face triangulation
    const faceOff = after + 4 + edgeCnt * 8;
    const faceRes = tryFaceTriangulation(posOff, cnt, faceOff);
    if (faceRes && faceRes.tris.length >= 20) {
      const positions = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
        positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
        positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
      }
      const indices = new Uint32Array(faceRes.tris.length * 3);
      for (let i = 0; i < faceRes.tris.length; i++) { indices[i * 3] = faceRes.tris[i][0]; indices[i * 3 + 1] = faceRes.tris[i][1]; indices[i * 3 + 2] = faceRes.tris[i][2]; }
      console.log(`Crystal mesh via faces int32 edges: cnt ${cnt} @${off} faces ${faceRes.faceCnt} ${faceRes.mode} tris ${faceRes.tris.length}`);
      return { positions, indices, vertCount: cnt, triCount: faceRes.tris.length, offset: off, size, method: `crystal-faces-${faceRes.mode}`, faceCount: faceRes.faceCnt, edgeCount: edgeCnt, posOffset: posOff };
    }
  }

  // 2. Crystal with u16 edges (newer, Version>=35)
  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt < 80 || cnt > 6000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) continue;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let ok = true;
    for (let i = 0; i < Math.min(cnt, 40); i++) {
      const x = dv.getFloat32(posOff + i * 12, true), y = dv.getFloat32(posOff + i * 12 + 4, true), z = dv.getFloat32(posOff + i * 12 + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
      if (Math.abs(x) > 30 || Math.abs(y) > 30 || Math.abs(z) > 30) { ok = false; break; }
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    if (!ok) continue;
    const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
    if (size < 0.2 || size > 12) continue;
    const after = posOff + cnt * 12;
    if (after + 4 > len) continue;
    const edgeCnt = dv.getInt32(after, true);
    if (edgeCnt < cnt * 0.3 || edgeCnt > cnt * 3) continue;
    if (after + 4 + edgeCnt * 4 > len) continue;
    let edgesOk = true;
    for (let i = 0; i < Math.min(edgeCnt, 16); i++) {
      const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
      if (a >= cnt || b >= cnt || a === b) { edgesOk = false; break; }
    }
    if (!edgesOk) continue;
    const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
    for (let i = 0; i < edgeCnt; i++) {
      const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
      if (a < cnt && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
    }
    let tris = []; let seen = new Set();
    for (let i = 0; i < cnt; i++) {
      const neigh = [...adj.get(i)];
      if (neigh.length < 2) continue;
      for (let j = 0; j < neigh.length; j++) for (let k = j + 1; k < neigh.length; k++) {
        const a = neigh[j], b = neigh[k];
        if (adj.get(a).has(b)) {
          const s = [i, a, b].sort((x, y) => x - y).join(",");
          if (!seen.has(s)) { seen.add(s); tris.push([i, a, b]); }
        }
      }
      if (tris.length > cnt * 4) break;
    }
    if (tris.length >= cnt * 0.3 && tris.length <= cnt * 3 && tris.length >= 20) {
      const positions = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
        positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
        positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
      }
      const indices = new Uint32Array(tris.length * 3);
      for (let i = 0; i < tris.length; i++) { indices[i * 3] = tris[i][0]; indices[i * 3 + 1] = tris[i][1]; indices[i * 3 + 2] = tris[i][2]; }
      const faceOff = after + 4 + edgeCnt * 4;
      const faceCnt = faceOff + 4 <= len ? dv.getInt32(faceOff, true) : 0;
      console.log(`Crystal mesh u16 edges: cnt ${cnt} @${off} sz ${size.toFixed(2)} edge ${edgeCnt} face ${faceCnt} tris ${tris.length}`);
      return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-u16`, faceCount: faceCnt, edgeCount: edgeCnt, posOffset: posOff };
    }
    const faceOff = after + 4 + edgeCnt * 4;
    const faceRes = tryFaceTriangulation(posOff, cnt, faceOff);
    if (faceRes && faceRes.tris.length >= 20) {
      const positions = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
        positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
        positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
      }
      const indices = new Uint32Array(faceRes.tris.length * 3);
      for (let i = 0; i < faceRes.tris.length; i++) { indices[i * 3] = faceRes.tris[i][0]; indices[i * 3 + 1] = faceRes.tris[i][1]; indices[i * 3 + 2] = faceRes.tris[i][2]; }
      console.log(`Crystal mesh via faces u16 edges: cnt ${cnt} @${off} faces ${faceRes.faceCnt} ${faceRes.mode} tris ${faceRes.tris.length}`);
      return { positions, indices, vertCount: cnt, triCount: faceRes.tris.length, offset: off, size, method: `crystal-faces-u16-${faceRes.mode}`, faceCount: faceRes.faceCnt, edgeCount: edgeCnt, posOffset: posOff };
    }
  }

  // 3. Point cloud + ib search
  let candidates = [];
  for (let off = 0; off < len - 12; off += 4) {
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (Math.abs(x) > 30 || Math.abs(y) > 30 || Math.abs(z) > 30) continue;
    let minx = x, miny = y, minz = z, maxx = x, maxy = y, maxz = z;
    let cnt = 1, o = off + 12;
    while (o + 12 <= len && cnt < 6000) {
      const xx = dv.getFloat32(o, true), yy = dv.getFloat32(o + 4, true), zz = dv.getFloat32(o + 8, true);
      if (!Number.isFinite(xx) || !Number.isFinite(yy) || !Number.isFinite(zz)) break;
      if (Math.abs(xx) > 30 || Math.abs(yy) > 30 || Math.abs(zz) > 30) break;
      if (xx < minx) minx = xx; if (yy < miny) miny = yy; if (zz < minz) minz = zz;
      if (xx > maxx) maxx = xx; if (yy > maxy) maxy = yy; if (zz > maxz) maxz = zz;
      const sz = Math.max(maxx - minx, maxy - miny, maxz - minz);
      if (sz > 12) break;
      cnt++; o += 12;
    }
    if (cnt < 80) continue;
    const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
    if (size < 0.15 || size > 12) continue;
    candidates.push({ offset: off, vertCount: cnt, size, posOffset: off });
    if (candidates.length >= 8) break;
  }

  for (const cand of candidates) {
    const cnt = cand.vertCount;
    const posOff = cand.posOffset;
    const searchStart = posOff + cnt * 12;
    const searchEnd = Math.min(len - 6, searchStart + 250000);
    for (let s = searchStart; s < searchEnd; s += 2) {
      if (s + 2 + 60 > len) continue;
      const icnt = dv.getUint16(s, true);
      if (icnt < 60 || icnt > cnt * 4 || icnt % 3 !== 0) continue;
      if (s + 2 + icnt * 2 > len) continue;
      let ok = true;
      for (let i = 0; i < Math.min(30, icnt); i++) { const idx = dv.getUint16(s + 2 + i * 2, true); if (idx >= cnt) { ok = false; break; } }
      if (!ok) continue;
      const ia = dv.getUint16(s + 2, true), ib = dv.getUint16(s + 4, true), ic = dv.getUint16(s + 6, true);
      if (ia >= cnt || ib >= cnt || ic >= cnt) continue;
      const ax = dv.getFloat32(posOff + ia * 12, true), ay = dv.getFloat32(posOff + ia * 12 + 4, true), az = dv.getFloat32(posOff + ia * 12 + 8, true);
      const bx = dv.getFloat32(posOff + ib * 12, true), by = dv.getFloat32(posOff + ib * 12 + 4, true), bz = dv.getFloat32(posOff + ib * 12 + 8, true);
      const cx = dv.getFloat32(posOff + ic * 12, true), cy = dv.getFloat32(posOff + ic * 12 + 4, true), cz = dv.getFloat32(posOff + ic * 12 + 8, true);
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const crx = aby * acz - abz * acy, cry = abz * acx - abx * acz, crz = abx * acy - aby * acx;
      const area = Math.sqrt(crx * crx + cry * cry + crz * crz) * 0.5;
      if (area < 1e-6 || area > 10) continue;
      const positions = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { positions[i * 3] = dv.getFloat32(posOff + i * 12, true); positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true); positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true); }
      const indices = new Uint32Array(icnt);
      for (let i = 0; i < icnt; i++) indices[i] = dv.getUint16(s + 2 + i * 2, true);
      console.log(`Mesh via ib: cnt ${cnt} @${cand.offset} sz ${cand.size.toFixed(2)} ib ${icnt} @${s} tris ${icnt/3}`);
      return { positions, indices, vertCount: cnt, triCount: icnt / 3, offset: cand.offset, size: cand.size, method: `heuristic-ib-u16`, posOffset: posOff, ibOffset: s + 2 };
    }
  }

  if (candidates.length) {
    let best = candidates[0];
    for (const c of candidates) if (c.vertCount > best.vertCount) best = c;
    const positions = new Float32Array(best.vertCount * 3);
    for (let i = 0; i < best.vertCount; i++) {
      positions[i * 3] = dv.getFloat32(best.posOffset + i * 12, true);
      positions[i * 3 + 1] = dv.getFloat32(best.posOffset + i * 12 + 4, true);
      positions[i * 3 + 2] = dv.getFloat32(best.posOffset + i * 12 + 8, true);
    }
    console.log(`Point cloud: cnt ${best.vertCount} @${best.offset} sz ${best.size.toFixed(2)}`);
    return { positions, indices: null, vertCount: best.vertCount, triCount: 0, offset: best.offset, size: best.size, method: `points-fallback`, posOffset: best.posOffset };
  }

  return null;
}

export function parseMesh(decomp){
  const single=findMesh(decomp);
  if(!single) return { geometries: [], reason: `no valid mesh after scan` };
  const reason = single.method.startsWith('crystal')
    ? `Crystal mesh: cnt ${single.vertCount} @${single.offset} sz ${single.size.toFixed(2)} edge ${single.edgeCount} face ${single.faceCount} tris ${single.triCount} ${single.method}`
    : single.indices
      ? `verts ${single.vertCount} @${single.offset} size ${single.size.toFixed(2)}m, ib ${single.triCount*3} tris ${single.triCount} ${single.method}`
      : `verts ${single.vertCount} @${single.offset} size ${single.size.toFixed(2)}m, no ib (points) ${single.method}`;
  return { geometries: [single], reason };
}

export function createThreeGeometry(THREE, desc){
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(desc.positions, 3));
  if(desc.indices && desc.indices.length>=30){
    geom.setIndex(new THREE.BufferAttribute(desc.indices, 1));
    geom.computeVertexNormals();
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
