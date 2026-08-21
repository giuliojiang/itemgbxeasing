/**
 * mesh.js – Robust Crystal mesh extractor for Item.Gbx
 * v5.1 – more permissive for 3333v, debug logs
 */

export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;

  function tryFaceTriangulation(posOff, cnt, faceOff, label) {
    if (faceOff + 4 > len) return null;
    const faceCnt = dv.getInt32(faceOff, true);
    if (faceCnt < 10 || faceCnt > 10000) return null;
    let p = faceOff + 4;
    let tris = [];
    for (let mode = 0; mode < 2; mode++) {
      const isNew = mode === 1;
      let pp = p;
      let ok = true;
      let tmpTris = [];
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
          if (full.length > cnt * 5) break;
        }
        if (full.length >= 20) return { tris: full, faceCnt, mode: isNew ? 'new' : 'old', nextP: pp };
      }
    }
    return null;
  }

  // Try crystal with more permissive edge range for 3333 case
  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt < 60 || cnt > 8000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) continue;
    // quick bbox
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    let ok = true;
    for (let i = 0; i < Math.min(cnt, 30); i++) {
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
    const edgeCnt = dv.getInt32(after, true);
    // be more permissive for 3333
    if (cnt === 3333) console.log(`3333 candidate @${off} after edgeCnt ${edgeCnt} size ${size.toFixed(2)}`);
    if (edgeCnt < 0 || edgeCnt > cnt * 5) continue;
    if (edgeCnt > 0 && after + 4 + edgeCnt * 8 > len && after + 4 + edgeCnt * 4 > len) continue;
    // Try int32 edges
    if (edgeCnt >= cnt * 0.2 && edgeCnt <= cnt * 5 && after + 4 + edgeCnt * 8 <= len) {
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
          if (tris.length > cnt * 5) break;
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
          const faceOff = after + 4 + edgeCnt * 8;
          const faceCnt = faceOff + 4 <= len ? dv.getInt32(faceOff, true) : 0;
          console.log(`Crystal int32 edges: cnt ${cnt} @${off} edge ${edgeCnt} face ${faceCnt} tris ${tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-int32`, faceCount: faceCnt, edgeCount: edgeCnt, posOffset: posOff };
        }
        const faceOff = after + 4 + edgeCnt * 8;
        const fr = tryFaceTriangulation(posOff, cnt, faceOff, `int32-${cnt}`);
        if (fr) {
          const positions = new Float32Array(cnt * 3);
          for (let i = 0; i < cnt; i++) {
            positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
            positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
            positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
          }
          const indices = new Uint32Array(fr.tris.length * 3);
          for (let i = 0; i < fr.tris.length; i++) { indices[i * 3] = fr.tris[i][0]; indices[i * 3 + 1] = fr.tris[i][1]; indices[i * 3 + 2] = fr.tris[i][2]; }
          console.log(`Crystal faces int32 edges: cnt ${cnt} @${off} faces ${fr.faceCnt} ${fr.mode} tris ${fr.tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: fr.tris.length, offset: off, size, method: `crystal-faces-int32-${fr.mode}`, faceCount: fr.faceCnt, edgeCount: edgeCnt, posOffset: posOff };
        }
      }
    }
    // Try u16 edges
    if (edgeCnt >= cnt * 0.2 && edgeCnt <= cnt * 5 && after + 4 + edgeCnt * 4 <= len) {
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
          if (tris.length > cnt * 5) break;
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
          const faceOff = after + 4 + edgeCnt * 4;
          const faceCnt = faceOff + 4 <= len ? dv.getInt32(faceOff, true) : 0;
          console.log(`Crystal u16 edges: cnt ${cnt} @${off} edge ${edgeCnt} face ${faceCnt} tris ${tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: tris.length, offset: off, size, method: `crystal-edges-u16`, faceCount: faceCnt, edgeCount: edgeCnt, posOffset: posOff };
        }
        const faceOff = after + 4 + edgeCnt * 4;
        const fr = tryFaceTriangulation(posOff, cnt, faceOff, `u16-${cnt}`);
        if (fr) {
          const positions = new Float32Array(cnt * 3);
          for (let i = 0; i < cnt; i++) {
            positions[i * 3] = dv.getFloat32(posOff + i * 12, true);
            positions[i * 3 + 1] = dv.getFloat32(posOff + i * 12 + 4, true);
            positions[i * 3 + 2] = dv.getFloat32(posOff + i * 12 + 8, true);
          }
          const indices = new Uint32Array(fr.tris.length * 3);
          for (let i = 0; i < fr.tris.length; i++) { indices[i * 3] = fr.tris[i][0]; indices[i * 3 + 1] = fr.tris[i][1]; indices[i * 3 + 2] = fr.tris[i][2]; }
          console.log(`Crystal faces u16 edges: cnt ${cnt} @${off} faces ${fr.faceCnt} ${fr.mode} tris ${fr.tris.length}`);
          return { positions, indices, vertCount: cnt, triCount: fr.tris.length, offset: off, size, method: `crystal-faces-u16-${fr.mode}`, faceCount: fr.faceCnt, edgeCount: edgeCnt, posOffset: posOff };
        }
      }
    }
    // Also try no edges (face only)
    if (cnt === 3333) {
      const faceOff = after + 4;
      const fr = tryFaceTriangulation(posOff, cnt, faceOff, `no-edge-${cnt}`);
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
    }
  }

  // Fallback point cloud
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
