// mesh.js — try to extract real Item mesh from decompressed GBX
// v1: heuristic scan for vertex-like float blocks and index-like int blocks
// If fails, returns {geometries:[], reason}

export function parseMesh(decomp){
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len=decomp.length;
  // Strategy 1: Look for large contiguous float32 arrays that look like positions
  // Trackmania item verts are usually in range -20..20, with normals unit length.
  // We scan for runs of float triples where values are finite and within bounds.

  // Quick heuristic: find region with many valid verts
  let best={count:0, off:-1, stride:0};
  for(let off=0; off<len-12; off+=4){
    // try to count consecutive float3 where each component |x|<64 and not NaN
    let cnt=0, o=off;
    while(o+12 <= len && cnt<50000){
      const x=dv.getFloat32(o,true), y=dv.getFloat32(o+4,true), z=dv.getFloat32(o+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) break;
      if(Math.abs(x)>200 || Math.abs(y)>200 || Math.abs(z)>200) break;
      // Avoid obviously not verts: if values are integers 0..100000 maybe it's counts
      cnt++; o+=12;
      // stop if we encounter a long run of zeros or 0xFFFFFFFF
      if(cnt>20 && x===0 && y===0 && z===0) { // allow some zeros but break if many
        // check next few are zeros -> likely padding
        let zeros=0;
        for(let k=0;k<5;k++){ if(o+k*12+11>=len) break; const xx=dv.getFloat32(o+k*12,true); if(xx===0) zeros++; }
        if(zeros>=4) break;
      }
    }
    if(cnt>best.count && cnt>=50){
      best={count:cnt, off, stride:12};
    }
    if(cnt>100) off+=cnt*12-4; // skip ahead
  }

  if(best.count>=100){
    // Try to find following normal+uv? Common layout: pos(12) + normal(12) + uv(8) = 32 bytes stride
    // Check if after pos block there is normal-like data
    const posOff=best.off;
    const vertCount=best.count;
    // Heuristic: look for index buffer after verts
    // Index buffer is array of uint16 or uint32 tri indices < vertCount
    let ibOff=-1, ibCount=0, isU16=true;
    // Search within next 4k bytes after verts for plausible index array
    const searchStart = posOff + vertCount*12;
    const searchEnd = Math.min(len-2, searchStart+20000);
    for(let s=searchStart; s<searchEnd-6; s+=2){
      // try to read triCount? Often first 4 bytes is count
      const maybeCount = dv.getUint32(s,true);
      if(maybeCount>0 && maybeCount<vertCount*3 && maybeCount%3===0 && maybeCount<20000){
        // check next maybeCount indices are valid
        let ok=true;
        for(let j=0;j<Math.min(12,maybeCount);j++){
          const idx = (dv.getUint32(s+4+j*4,true)>>>0);
          if(idx>=vertCount){ ok=false; break; }
        }
        if(ok){
          ibOff=s+4; ibCount=maybeCount; isU16=false; break;
        }
      }
      // try uint16 path: first 2 bytes count?
      const c16 = dv.getUint16(s,true);
      if(c16>0 && c16<vertCount*3 && c16%3===0 && c16<20000){
        let ok=true;
        for(let j=0;j<Math.min(12,c16);j++){
          const idx=dv.getUint16(s+2+j*2,true);
          if(idx>=vertCount){ ok=false; break; }
        }
        if(ok){ ibOff=s+2; ibCount=c16; isU16=true; break; }
      }
    }

    // Build geometry descriptor
    const positions = new Float32Array(vertCount*3);
    for(let i=0;i<vertCount;i++){
      positions[i*3]=dv.getFloat32(posOff+i*12,true);
      positions[i*3+1]=dv.getFloat32(posOff+i*12+4,true);
      positions[i*3+2]=dv.getFloat32(posOff+i*12+8,true);
    }
    let indices=null;
    if(ibOff>=0){
      if(isU16){
        indices=new Uint16Array(ibCount);
        for(let i=0;i<ibCount;i++) indices[i]=dv.getUint16(ibOff+i*2,true);
      }else{
        indices=new Uint32Array(ibCount);
        for(let i=0;i<ibCount;i++) indices[i]=dv.getUint32(ibOff+i*4,true);
      }
    }

    return {
      geometries:[{positions, indices, normals:null, uvs:null, vertCount, ibOff, posOff}],
      reason:`heuristic vert block @${posOff} count ${vertCount}${ibOff>=0?` ib @${ibOff} count ${ibCount} ${isU16?'u16':'u32'}`:''}`,
      best
    };
  }

  // Strategy 2: look for CPlugSurface pattern: try to find 0x0900C000 etc (we didn't find earlier but try again with different alignment)
  return {geometries:[], reason:"no vertex block found – item may use external mesh or compressed verts"};
}

export function createThreeGeometry(THREE, desc){
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(desc.positions,3));
  if(desc.normals) geom.setAttribute('normal', new THREE.BufferAttribute(desc.normals,3));
  else geom.computeVertexNormals();
  if(desc.indices) geom.setIndex(Array.from(desc.indices));
  if(desc.uvs) geom.setAttribute('uv', new THREE.BufferAttribute(desc.uvs,2));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
