// mesh.js — robust heuristic mesh extractor (fixes mangled needle)
export function parseMesh(decomp){
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len=decomp.length;

  function boxSize(verts, stride, off, count){
    let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
    let nan=0;
    for(let i=0;i<count;i++){
      const x=dv.getFloat32(off+i*stride,true);
      const y=dv.getFloat32(off+i*stride+4,true);
      const z=dv.getFloat32(off+i*stride+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){ nan++; if(nan>5) return {size:0, bad:true}; continue; }
      if(x<minx) minx=x; if(y<miny) miny=y; if(z<minz) minz=z;
      if(x>maxx) maxx=x; if(y>maxy) maxy=y; if(z>maxz) maxz=z;
    }
    const sx=maxx-minx, sy=maxy-miny, sz=maxz-minz;
    const size=Math.max(sx,sy,sz);
    return {size, sx,sy,sz, minx,miny,minz,maxx,maxy,maxz, bad: size>100 || size<0.02};
  }

  function scanStride(stride){
    let best=null;
    // step 4 to be fast, but check alignment
    for(let off=0; off<len-stride*50; off+=4){
      // quick reject: first 3 verts must be plausible
      let cnt=0, o=off;
      let bad=0;
      while(o+stride<=len && cnt<80000){
        const x=dv.getFloat32(o,true), y=dv.getFloat32(o+4,true), z=dv.getFloat32(o+8,true);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) break;
        if(Math.abs(x)>100||Math.abs(y)>100||Math.abs(z)>100) break;
        // reject long runs of zeros – likely padding
        if(Math.abs(x)<1e-6&&Math.abs(y)<1e-6&&Math.abs(z)<1e-6){
          let zc=0;
          for(let k=0;k<5 && o+k*stride+11<len;k++) if(Math.abs(dv.getFloat32(o+k*stride,true))<1e-6 && Math.abs(dv.getFloat32(o+k*stride+4,true))<1e-6) zc++;
          if(zc>=3) break;
        }
        cnt++; o+=stride;
        if(cnt>20000) break;
      }
      if(cnt<80) continue;
      // compute box of first 200 verts
      let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
      let ok=true;
      let zeroCount=0;
      for(let i=0;i<Math.min(cnt,200);i++){
        const x=dv.getFloat32(off+i*stride,true), y=dv.getFloat32(off+i*stride+4,true), z=dv.getFloat32(off+i*stride+8,true);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){ ok=false; break; }
        if(Math.abs(x)<1e-5&&Math.abs(y)<1e-5&&Math.abs(z)<1e-5) zeroCount++;
        if(x<minx) minx=x; if(y<miny) miny=y; if(z<minz) minz=z;
        if(x>maxx) maxx=x; if(y>maxy) maxy=y; if(z>maxz) maxz=z;
      }
      if(!ok) continue;
      if(zeroCount>40) continue; // too many zeros – padding block
      const sx=maxx-minx, sy=maxy-miny, sz=maxz-minz;
      const size=Math.max(sx,sy,sz);
      if(size>12||size<0.15) continue; // tight: visual mesh 0.15m to 12m
      if(sx<1e-4 && sy<1e-4 && sz<1e-4) continue;
      // reject flat line
      if((sx<0.01 && sy<0.01) || (sx<0.01 && sz<0.01) || (sy<0.01 && sz<0.01)) continue;
      const score=cnt * (size>0.3?1:0.2);
      if(!best || score>best.score){
        best={off, count:cnt, stride, size, sx,sy,sz, score};
      }
      if(cnt>100) off+=cnt*stride-4; // skip ahead
    }
    return best;
  }

  const strides=[12,24,28,32,36,40,44];
  let candidates=[];
  for(const st of strides){
    const b=scanStride(st);
    if(b) candidates.push(b);
  }
  if(!candidates.length){
    return {geometries:[], reason:`no plausible vert block (tried ${strides.join('/')})`};
  }
  // keep top 3 by score, but filter duplicates (same off)
  candidates.sort((a,b)=>b.score-a.score);
  const uniq=[];
  for(const c of candidates){
    if(!uniq.some(u=>Math.abs(u.off-c.off)<c.stride*10)) uniq.push(c);
    if(uniq.length>=3) break;
  }

  let geoms=[];
  for(const cand of uniq){
    const vertCount=cand.count;
    const posOff=cand.off;
    const stride=cand.stride;

    // ib search with stricter validation
    let ibOff=-1, ibCount=0, isU16=true;
    const searchStart = posOff + vertCount*stride;
    const searchEnd = Math.min(len-2, searchStart+120000);
    let bestIb=null;
    for(let s=searchStart; s<searchEnd-12; s+=4){
      const maybeCount = dv.getUint32(s,true);
      if(maybeCount>=60 && maybeCount<vertCount*4 && maybeCount%3===0 && maybeCount<120000 && maybeCount>=vertCount*0.4){
        let ok=true;
        let maxIdx=0;
        for(let j=0;j<Math.min(40,maybeCount);j++){
          const idx=dv.getUint32(s+4+j*4,true);
          if(idx>=vertCount){ ok=false; break; }
          if(idx>maxIdx) maxIdx=idx;
        }
        if(ok && maxIdx>=vertCount*0.3){ // uses good range of verts
          // check triangle area for first 3 tris
          let areaOk=true;
          for(let t=0;t<3;t++){
            const ia=dv.getUint32(s+4+t*12,true), ib=dv.getUint32(s+4+t*12+4,true), ic=dv.getUint32(s+4+t*12+8,true);
            if(ia>=vertCount||ib>=vertCount||ic>=vertCount){ areaOk=false; break; }
            const ax=dv.getFloat32(posOff+ia*stride,true), ay=dv.getFloat32(posOff+ia*stride+4,true), az=dv.getFloat32(posOff+ia*stride+8,true);
            const bx=dv.getFloat32(posOff+ib*stride,true), by=dv.getFloat32(posOff+ib*stride+4,true), bz=dv.getFloat32(posOff+ib*stride+8,true);
            const cx=dv.getFloat32(posOff+ic*stride,true), cy=dv.getFloat32(posOff+ic*stride+4,true), cz=dv.getFloat32(posOff+ic*stride+8,true);
            const abx=bx-ax, aby=by-ay, abz=bz-az;
            const acx=cx-ax, acy=cy-ay, acz=cz-az;
            const crossx=aby*acz-abz*acy, crossy=abz*acx-abx*acz, crossz=abx*acy-aby*acx;
            const area=Math.sqrt(crossx*crossx+crossy*crossy+crossz*crossz)*0.5;
            if(area<1e-5 || area>20){ areaOk=false; break; }
          }
          if(areaOk){ bestIb={off:s+4,count:maybeCount,isU16:false}; break; }
        }
      }
      const c16 = dv.getUint16(s,true);
      if(c16>=60 && c16<vertCount*4 && c16%3===0 && c16<120000 && c16>=vertCount*0.4){
        let ok=true;
        let maxIdx=0;
        for(let j=0;j<Math.min(40,c16);j++){
          const idx=dv.getUint16(s+2+j*2,true);
          if(idx>=vertCount){ ok=false; break; }
          if(idx>maxIdx) maxIdx=idx;
        }
        if(ok && maxIdx>=vertCount*0.3){
          // area check for u16
          let areaOk=true;
          for(let t=0;t<2;t++){
            const ia=dv.getUint16(s+2+t*6,true), ib=dv.getUint16(s+2+t*6+2,true), ic=dv.getUint16(s+2+t*6+4,true);
            if(ia>=vertCount||ib>=vertCount||ic>=vertCount){ areaOk=false; break; }
            const ax=dv.getFloat32(posOff+ia*stride,true), ay=dv.getFloat32(posOff+ia*stride+4,true), az=dv.getFloat32(posOff+ia*stride+8,true);
            const bx=dv.getFloat32(posOff+ib*stride,true), by=dv.getFloat32(posOff+ib*stride+4,true), bz=dv.getFloat32(posOff+ib*stride+8,true);
            const cx=dv.getFloat32(posOff+ic*stride,true), cy=dv.getFloat32(posOff+ic*stride+4,true), cz=dv.getFloat32(posOff+ic*stride+8,true);
            const abx=bx-ax, aby=by-ay, abz=bz-az;
            const acx=cx-ax, acy=cy-ay, acz=cz-az;
            const crossx=aby*acz-abz*acy, crossy=abz*acx-abx*acz, crossz=abx*acy-aby*acx;
            const area=Math.sqrt(crossx*crossx+crossy*crossy+crossz*crossz)*0.5;
            if(area<1e-5 || area>20){ areaOk=false; break; }
          }
          if(areaOk){ bestIb={off:s+2,count:c16,isU16:true}; break; }
        }
      }
    }
    if(bestIb){ ibOff=bestIb.off; ibCount=bestIb.count; isU16=bestIb.isU16; }

    const positions = new Float32Array(vertCount*3);
    for(let i=0;i<vertCount;i++){
      positions[i*3]=dv.getFloat32(posOff+i*stride,true);
      positions[i*3+1]=dv.getFloat32(posOff+i*stride+4,true);
      positions[i*3+2]=dv.getFloat32(posOff+i*stride+8,true);
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

    geoms.push({
      positions,
      indices,
      vertCount,
      posOff,
      ibOff,
      ibCount,
      isU16,
      stride,
      size: cand.size
    });
  }

  if(!geoms.length) return {geometries:[], reason:`no valid mesh after ib check`};

  // sort by size (prefer medium) and vertCount
  geoms.sort((a,b)=> (b.vertCount - a.vertCount));
  const best=geoms[0];
  return {
    geometries: geoms.slice(0,2), // return up to 2 best
    reason: best.ibOff>=0 ? `verts ${best.vertCount} stride${best.stride} @${best.posOff} size ${best.size.toFixed(2)}m, ib ${best.ibCount} @${best.ibOff} ${best.isU16?'u16':'u32'}` : `verts ${best.vertCount} stride${best.stride} @${best.posOff} size ${best.size.toFixed(2)}m, no ib (points)`
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
