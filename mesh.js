export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);
  function tryFaceTriangulation(posOff, cnt, faceOff) {
    if (faceOff + 4 > len) return null;
    const faceCnt = dv.getInt32(faceOff, true);
    if (faceCnt < 10 || faceCnt > 10000) return null;
    let p = faceOff + 4;
    for (let mode = 0; mode < 2; mode++) {
      const isNew = mode === 1;
      let pp = p, ok = true, tmpTris = [];
      for (let f = 0; f < Math.min(faceCnt, 20); f++) {
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
        for (let i = 1; i < vc - 1; i++) tmpTris.push([inds[0], inds[i], inds[i + 1]]);
      }
      if (ok && tmpTris.length >= 10) {
        let full = [...tmpTris];
        for (let f = 20; f < faceCnt; f++) {
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
        if (full.length >= 20) return { tris: full, faceCnt, mode: isNew ? 'new' : 'old' };
      }
    }
    return null;
  }

  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt === 3333) console.log(`seen cnt 3333 @${off} len ${len} posOff+cnt*12 ${off+4+cnt*12}`);
    if (cnt < 60 || cnt > 8000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) {
      if (cnt === 3333) console.log(`  3333 len fail`);
      continue;
    }
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let ok = true;
    for (let i = 0; i < Math.min(cnt, 30); i++) {
      const x = dv.getFloat32(posOff + i * 12, true), y = dv.getFloat32(posOff + i * 12 + 4, true), z = dv.getFloat32(posOff + i * 12 + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; if (cnt===3333) console.log(`  3333 bad float ${i} ${x},${y},${z}`); break; }
      if (Math.abs(x) > 50 || Math.abs(y) > 50 || Math.abs(z) > 50) { ok = false; if (cnt===3333) console.log(`  3333 abs>50 ${i} ${x},${y},${z}`); break; }
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    if (!ok) continue;
    const size = Math.max(maxx - minx, maxy - miny, maxz - minz);
    if (cnt === 3333) console.log(`  3333 size ${size.toFixed(2)} min ${minx.toFixed(2)},${miny.toFixed(2)},${minz.toFixed(2)} max ${maxx.toFixed(2)},${maxy.toFixed(2)},${maxz.toFixed(2)}`);
    if (size < 0.15 || size > 15) {
      if (cnt===3333) console.log(`  3333 size reject`);
      continue;
    }
    const after = posOff + cnt * 12;
    if (after + 4 > len) continue;
    const edgeCnt = dv.getInt32(after, true);
    if (cnt === 3333) console.log(`  3333 after ${after} edgeCnt ${edgeCnt}`);
    if (edgeCnt < 0 || edgeCnt > cnt * 5) {
      if (cnt===3333) console.log(`  3333 edgeCnt out of range`);
      // try face-only even if edgeCnt bad
      const faceOff = after + 4;
      const fr = tryFaceTriangulation(posOff, cnt, faceOff);
      if (fr) {
        const positions = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) {
          positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
          positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
          positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
        }
        const indices = new Uint32Array(fr.tris.length * 3);
        for (let i = 0; i < fr.tris.length; i++) { indices[i * 3] = fr.tris[i][0]; indices[i * 3 + 1] = fr.tris[i][1]; indices[i * 3 + 2] = fr.tris[i][2]; }
        console.log(`Crystal faces no edges: cnt ${cnt} @${off} faces ${fr.faceCnt} ${fr.mode} tris ${fr.tris.length}`);
        return { positions, indices, vertCount: cnt, triCount: fr.tris.length, offset: off, size, method: `crystal-faces-no-edge-${fr.mode}`, faceCount: fr.faceCnt, edgeCount: 0, posOffset: posOff };
      }
      continue;
    }
    // Try u16 edges first for 3333
    if (after + 4 + edgeCnt * 4 <= len) {
      let edgesOk = true;
      for (let i = 0; i < Math.min(edgeCnt, 10); i++) {
        const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
        if (a >= cnt || b >= cnt) { edgesOk = false; break; }
      }
      if (edgesOk) {
        const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
        for (let i = 0; i < edgeCnt; i++) {
          const a = dv.getUint16(after + 4 + i * 4, true), b = dv.getUint16(after + 4 + i * 4 + 2, true);
          if (a < cnt && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
        }
        let tris = [], seen = new Set();
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
        }
        if (tris.length >= 20) {
          const positions = new Float32Array(cnt * 3);
          for (let i = 0; i < cnt; i++) {
            positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
            positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
            positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
          }
          const indices = new Uint32Array(tris.length * 3);
          for (let i = 0; i < tris.length; i++) { indices[i * 3] = tris[i][0]; indices[i * 3 + 1] = tris[i][1]; indices[i * 3 + 2] = tris[i][2]; }
          console.log(`Crystal u16 edges: cnt ${cnt} @${off} edge ${edgeCnt} tris ${tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-u16`, edgeCount: edgeCnt, posOffset: posOff };
        }
      }
    }
    // int32 edges
    if (after + 4 + edgeCnt * 8 <= len) {
      let edgesOk = true;
      for (let i = 0; i < Math.min(edgeCnt, 10); i++) {
        const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
        if (a < 0 || a >= cnt || b < 0 || b >= cnt) { edgesOk = false; break; }
      }
      if (edgesOk) {
        const adj = new Map(); for (let i = 0; i < cnt; i++) adj.set(i, new Set());
        for (let i = 0; i < edgeCnt; i++) {
          const a = dv.getInt32(after + 4 + i * 8, true), b = dv.getInt32(after + 4 + i * 8 + 4, true);
          if (a >= 0 && a < cnt && b >= 0 && b < cnt) { adj.get(a).add(b); adj.get(b).add(a); }
        }
        let tris = [], seen = new Set();
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
        }
        if (tris.length >= 20) {
          const positions = new Float32Array(cnt * 3);
          for (let i = 0; i < cnt; i++) {
            positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
            positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
            positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
          }
          const indices = new Uint32Array(tris.length * 3);
          for (let i = 0; i < tris.length; i++) { indices[i * 3] = tris[i][0]; indices[i * 3 + 1] = tris[i][1]; indices[i * 3 + 2] = tris[i][2]; }
          console.log(`Crystal int32 edges: cnt ${cnt} @${off} edge ${edgeCnt} tris ${tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-int32`, edgeCount: edgeCnt, posOffset: posOff };
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
    while (o + 12 <= len && cnt < 6000) {
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
    if (candidates.length >= 8) break;
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
  if(!single) return { geometries: [], reason: `no valid mesh` };
  const reason = single.method.startsWith('crystal')
    ? `Crystal ${single.vertCount} @${single.offset} sz ${single.size.toFixed(2)} edge ${single.edgeCount} tris ${single.triCount} ${single.method}`
    : `verts ${single.vertCount} @${single.offset} sz ${single.size.toFixed(2)} ${single.method}`;
  return { geometries: [single], reason };
}
export function createThreeGeometry(THREE, desc){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(desc.positions,3));
  if(desc.indices && desc.indices.length>=30){ g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals(); }
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
