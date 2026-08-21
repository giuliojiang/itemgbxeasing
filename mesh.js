// mesh.js — heuristic mesh extractor for Item.Gbx decomp
export function parseMesh(decomp){
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len=decomp.length;

  function scanStride(stride, posOffInStride){
    let best={count:0, off:-1};
    for(let off=0; off<len-stride; off+=4){
      let cnt=0, o=off;
      while(o+stride <= len && cnt<50000){
        const x=dv.getFloat32(o+posOffInStride,true), y=dv.getFloat32(o+posOffInStride+4,true), z=dv.getFloat32(o+posOffInStride+8,true);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) break;
        if(Math.abs(x)>200 || Math.abs(y)>200 || Math.abs(z)>200) break;
        // reject if all zeros for 4 consecutive
        if(x===0&&y===0&&z===0){
          let zc=0;
          for(let k=0;k<4;k++){
            if(o+k*stride+posOffInStride+11>=len) break;
            if(dv.getFloat32(o+k*stride+posOffInStride,true)===0) zc++;
          }
          if(zc>=3) break;
        }
        cnt++; o+=stride;
      }
      if(cnt>best.count && cnt>=50){
        best={count:cnt, off, stride, posOff:posOffInStride};
      }
      if(cnt>150) off+=cnt*stride-4;
    }
    return best;
  }

  // try stride 12 (pos only), 24 (pos+normal), 32 (pos+normal+uv), 36 (pos+normal+uv+color?)
  const candidates=[];
  for(const [stride,posOff] of [[12,0],[24,0],[32,0],[36,0]]){
    const b=scanStride(stride,posOff);
    if(b.count>=100) candidates.push(b);
  }
  if(!candidates.length){
    // also try stride 12 best even if <100
    const b12=scanStride(12,0);
    if(b12.count>=50) candidates.push(b12);
  }
  if(!candidates.length){
    return {geometries:[], reason:`no vert block found`};
  }
  // pick largest count, prefer smaller stride (more plausible)
  candidates.sort((a,b)=> b.count - a.count);
  const best=candidates[0];

  const posOff=best.off;
  const vertCount=best.count;
  const stride=best.stride;

  // ib search
  let ibOff=-1, ibCount=0, isU16=true;
  const searchStart = posOff + vertCount*stride;
  const searchEnd = Math.min(len-2, searchStart+80000);
  for(let s=searchStart; s<searchEnd-12; s+=4){
    const maybeCount = dv.getUint32(s,true);
    if(maybeCount>=30 && maybeCount<vertCount*3 && maybeCount%3===0 && maybeCount<120000){
      let ok=true;
      for(let j=0;j<Math.min(30,maybeCount);j++){
        const idx = dv.getUint32(s+4+j*4,true);
        if(idx>=vertCount){ ok=false; break; }
      }
      if(ok){ ibOff=s+4; ibCount=maybeCount; isU16=false; break; }
    }
    const c16 = dv.getUint16(s,true);
    if(c16>=30 && c16<vertCount*3 && c16%3===0 && c16<120000){
      let ok=true;
      for(let j=0;j<Math.min(30,c16);j++){
        const idx=dv.getUint16(s+2+j*2,true);
        if(idx>=vertCount){ ok=false; break; }
      }
      if(ok){ ibOff=s+2; ibCount=c16; isU16=true; break; }
    }
    // direct tri array without count
    const a=dv.getUint32(s,true), b_=dv.getUint32(s+4,true), c_=dv.getUint32(s+8,true);
    if(a<vertCount && b_<vertCount && c_<vertCount && a!==b_ && b_!==c_){
      let tri=0, o=s;
      while(o+12<=searchEnd){
        const ia=dv.getUint32(o,true), ib=dv.getUint32(o+4,true), ic=dv.getUint32(o+8,true);
        if(ia>=vertCount||ib>=vertCount||ic>=vertCount) break;
        tri+=3; o+=12;
        if(tri>120000) break;
      }
      if(tri>=90){ ibOff=s; ibCount=tri; isU16=false; break; }
    }
  }

  const positions = new Float32Array(vertCount*3);
  for(let i=0;i<vertCount;i++){
    positions[i*3]=dv.getFloat32(posOff+i*stride+best.posOff,true);
    positions[i*3+1]=dv.getFloat32(posOff+i*stride+best.posOff+4,true);
    positions[i*3+2]=dv.getFloat32(posOff+i*stride+best.posOff+8,true);
  }

  let indices=null;
  if(ibOff>=0 && ibCount>=30){
    if(isU16){
      indices=new Uint16Array(ibCount);
      for(let i=0;i<ibCount;i++) indices[i]=dv.getUint16(ibOff+i*2,true);
    }else{
      if(vertCount>65535){
        indices=new Uint32Array(ibCount);
        for(let i=0;i<ibCount;i++) indices[i]=dv.getUint32(ibOff+i*4,true);
      }else{
        // check if need 32
        let need32=false;
        for(let i=0;i<Math.min(100,ibCount);i++) if(dv.getUint32(ibOff+i*4,true)>=65535) need32=true;
        if(need32){
          indices=new Uint32Array(ibCount);
          for(let i=0;i<ibCount;i++) indices[i]=dv.getUint32(ibOff+i*4,true);
        }else{
          indices=new Uint16Array(ibCount);
          for(let i=0;i<ibCount;i++) indices[i]=dv.getUint32(ibOff+i*4,true);
        }
      }
    }
  }

  return {
    geometries:[{
      positions,
      indices,
      vertCount,
      posOff,
      ibOff,
      ibCount,
      isU16,
      stride
    }],
    reason: ibOff>=0 ? `verts ${vertCount} stride${stride} @${posOff}, ib ${ibCount} @${ibOff} ${isU16?'u16':'u32'}` : `verts ${vertCount} stride${stride} @${posOff}, no ib (points)`
  };
}

export function createThreeGeometry(THREE, desc){
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(desc.positions,3));
  if(desc.indices && desc.indices.length>=30){
    geo.setIndex(new THREE.BufferAttribute(desc.indices,1));
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  return geo;
}
