export function findMesh(decomp){
  const dv=new DataView(decomp.buffer,decomp.byteOffset,decomp.byteLength);
  const len=decomp.length;
  console.log(`findMesh len ${len}`);
  function triAreaOff(posOff,offInStride,stride,a,b,c){
    const ax=dv.getFloat32(posOff+offInStride+a*stride,true), ay=dv.getFloat32(posOff+offInStride+a*stride+4,true), az=dv.getFloat32(posOff+offInStride+a*stride+8,true);
    const bx=dv.getFloat32(posOff+offInStride+b*stride,true), by=dv.getFloat32(posOff+offInStride+b*stride+4,true), bz=dv.getFloat32(posOff+offInStride+b*stride+8,true);
    const cx=dv.getFloat32(posOff+offInStride+c*stride,true), cy=dv.getFloat32(posOff+offInStride+c*stride+4,true), cz=dv.getFloat32(posOff+offInStride+c*stride+8,true);
    if(!Number.isFinite(ax)||!Number.isFinite(ay)||!Number.isFinite(az)||!Number.isFinite(bx)||!Number.isFinite(by)||!Number.isFinite(bz)||!Number.isFinite(cx)||!Number.isFinite(cy)||!Number.isFinite(cz)) return 0;
    const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az;
    const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
    return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
  }
  // 1. Crystal
  for(let off=0;off<len-4-60*12;off+=4){
    const cnt=dv.getInt32(off,true);
    if(cnt<80||cnt>6000) continue;
    const posOff=off+4;
    if(posOff+cnt*12>len) continue;
    let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
    let ok=true,zero=0;
    for(let i=0;i<Math.min(cnt,60);i++){
      const x=dv.getFloat32(posOff+i*12,true), y=dv.getFloat32(posOff+i*12+4,true), z=dv.getFloat32(posOff+i*12+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){ok=false;break;}
      if(Math.abs(x)<1e-6&&Math.abs(y)<1e-6&&Math.abs(z)<1e-6) zero++;
      if(Math.abs(x)>30||Math.abs(y)>30||Math.abs(z)>30){ok=false;break;}
      if(x<minx)minx=x; if(y<miny)miny=y; if(z<minz)minz=z;
      if(x>maxx)maxx=x; if(y>maxy)maxy=y; if(z>maxz)maxz=z;
    }
    if(!ok||zero>30) continue;
    const sx=maxx-minx,sy=maxy-miny,sz=maxz-minz;
    const size=Math.max(sx,sy,sz);
    if(size<0.2||size>12) continue;
    if(Math.min(sx,sy,sz)<size*0.02&&cnt>200) continue;
    const after=posOff+cnt*12;
    if(after+4>len) continue;
    const edgeCnt=dv.getInt32(after,true);
    if(edgeCnt<cnt*0.4||edgeCnt>cnt*3) continue;
    if(after+4+edgeCnt*8>len) continue;
    let edgesOk=true;
    for(let i=0;i<Math.min(edgeCnt,16);i++){const a=dv.getInt32(after+4+i*8,true),b=dv.getInt32(after+4+i*8+4,true); if(a<0||a>=cnt||b<0||b>=cnt||a===b){edgesOk=false;break;}}
    if(!edgesOk) continue;
    const adj=new Map(); for(let i=0;i<cnt;i++) adj.set(i,new Set());
    for(let i=0;i<edgeCnt;i++){const a=dv.getInt32(after+4+i*8,true),b=dv.getInt32(after+4+i*8+4,true); if(a>=0&&a<cnt&&b>=0&&b<cnt){adj.get(a).add(b);adj.get(b).add(a);}}
    let tris=[],seen=new Set();
    for(let i=0;i<cnt;i++){const neigh=[...adj.get(i)]; if(neigh.length<2) continue; for(let j=0;j<neigh.length;j++) for(let k=j+1;k<neigh.length;k++){const a=neigh[j],b=neigh[k]; if(adj.get(a).has(b)){const s=[i,a,b].sort((x,y)=>x-y).join(","); if(!seen.has(s)){seen.add(s); tris.push([i,a,b]);}}} if(tris.length>cnt*4) break;}
    if(tris.length<cnt*0.3||tris.length>cnt*3||tris.length<20) continue;
    let valid=0; for(let t=0;t<Math.min(10,tris.length);t++){const [ia,ib,ic]=tris[t]; const ax=dv.getFloat32(posOff+ia*12,true),ay=dv.getFloat32(posOff+ia*12+4,true),az=dv.getFloat32(posOff+ia*12+8,true); const bx=dv.getFloat32(posOff+ib*12,true),by=dv.getFloat32(posOff+ib*12+4,true),bz=dv.getFloat32(posOff+ib*12+8,true); const cx=dv.getFloat32(posOff+ic*12,true),cy=dv.getFloat32(posOff+ic*12+4,true),cz=dv.getFloat32(posOff+ic*12+8,true); const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az; const crx=aby*acz-abz*acy,cry=abz*acx-abx*acz,crz=abx*acy-aby*acx; const area=Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5; if(area>1e-6&&area<10) valid++;}
    if(valid<Math.min(5,tris.length)) continue;
    const positions=new Float32Array(cnt*3); for(let i=0;i<cnt;i++){positions[i*3]=dv.getFloat32(posOff+i*12,true);positions[i*3+1]=dv.getFloat32(posOff+i*12+4,true);positions[i*3+2]=dv.getFloat32(posOff+i*12+8,true);}
    const indices=new Uint32Array(tris.length*3); for(let i=0;i<tris.length;i++){indices[i*3]=tris[i][0];indices[i*3+1]=tris[i][1];indices[i*3+2]=tris[i][2];}
    console.log(`Crystal mesh: cnt ${cnt} @${off} sz ${size.toFixed(2)} edge ${edgeCnt} tris ${tris.length}`);
    return {positions,indices,vertCount:cnt,triCount:tris.length,offset:off,size,method:`crystal-edges`,posOffset:posOff,stride:12};
  }
  // 2. Build forward float-run candidates (no NaN)
  let candidates=[];
  for(let off=0;off<len-12;off+=4){
    for(let stride of [12,24,32,36]){
      if(off+stride>len) continue;
      const x0=dv.getFloat32(off,true),y0=dv.getFloat32(off+4,true),z0=dv.getFloat32(off+8,true);
      if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)) continue;
      if(Math.abs(x0)>50||Math.abs(y0)>50||Math.abs(z0)>50) continue;
      let minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0,cnt=1,o=off+stride, hasNaN=false;
      while(o+12<=len&&cnt<8000){
        const xx=dv.getFloat32(o,true),yy=dv.getFloat32(o+4,true),zz=dv.getFloat32(o+8,true);
        if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)){ hasNaN=true; break; }
        if(Math.abs(xx)>50||Math.abs(yy)>50||Math.abs(zz)>50) break;
        if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
        if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        if(Math.max(maxx-minx,maxy-miny,maxz-minz)>15) break;
        cnt++; o+=stride;
      }
      if(hasNaN) continue;
      if(cnt<60) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if(size<0.12||size>35) continue;
      if(candidates.some(c=>c.offset===off&&c.stride===stride)) continue;
      candidates.push({offset:off,vertCount:cnt,size,posOffset:off,stride});
      if(candidates.length>=24) break;
    }
    if(candidates.length>=24) break;
  }
  candidates.sort((a,b)=>b.vertCount-a.vertCount);
  if(candidates.length===0){
    // fallback looser for large files like MovingDuck 908k
    for(let off=0;off<len-12;off+=4){
      const x0=dv.getFloat32(off,true),y0=dv.getFloat32(off+4,true),z0=dv.getFloat32(off+8,true);
      if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)) continue;
      if(Math.abs(x0)>200||Math.abs(y0)>200||Math.abs(z0)>200) continue;
      let minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0,cnt=1,o=off+12;
      while(o+12<=len&&cnt<12000){
        const xx=dv.getFloat32(o,true),yy=dv.getFloat32(o+4,true),zz=dv.getFloat32(o+8,true);
        if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)) break;
        if(Math.abs(xx)>200||Math.abs(yy)>200||Math.abs(zz)>200) break;
        if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
        if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        if(Math.max(maxx-minx,maxy-miny,maxz-minz)>50) break;
        cnt++; o+=12;
      }
      if(cnt<200) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if(size<0.5||size>80) continue;
      candidates.push({offset:off,vertCount:cnt,size,posOffset:off,stride:12});
      if(candidates.length>=20) break;
    }
    candidates.sort((a,b)=>b.vertCount-a.vertCount);
  }
  console.log(`found ${candidates.length} raw candidates`);
  for(let i=0;i<Math.min(5,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);

  // 3. Find IndexBuffers and pair with candidates
  for(let s=0;s<len-16;s++){
    const v=dv.getInt32(s,true);
    if(v!==0x09057001&&v!==0x09057000) continue;
    const isNew=(v===0x09057001);
    let p=s+4; if(p+8>len) continue;
    const flags=dv.getInt32(p,true);
    const count=dv.getInt32(p+4,true);
    if(count<60||count>20000||count%3!==0) continue;
    if(p+8+count*2>len) continue;
    let cur=0,maxI=0,ok=true;
    const indices=new Uint32Array(count);
    if(isNew){
      for(let i=0;i<count;i++){const d=dv.getInt16(p+8+i*2,true); cur+=d; if(cur<0||cur>20000){ok=false;break;} indices[i]=cur; if(cur>maxI) maxI=cur;}
    } else {
      for(let i=0;i<count;i++){const idx=dv.getUint16(p+8+i*2,true); if(idx>20000){ok=false;break;} indices[i]=idx; if(idx>maxI) maxI=idx;}
    }
    if(!ok) continue;
    if(maxI<50) continue;
    // try candidates that end before s and have enough verts
    for(const cand of candidates){
      if(cand.vertCount<=maxI) continue;
      if(cand.offset+cand.vertCount*cand.stride > s+8000) continue; // must be before ib (allow some header)
      if(s - (cand.offset+cand.vertCount*cand.stride) > 100000) continue;
      // check verts finite (already)
      const tryOffs=cand.stride===24?[0,12]:[0];
      let bestValid=0,bestOff=0;
      for(const po of tryOffs){
        let valid=0;
        for(let i=0;i<Math.min(count-2,30);i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2]; if(a===b||b===c||a===c) continue; const ar=triAreaOff(cand.posOffset,po,cand.stride,a,b,c); if(ar>1e-6&&ar<20) valid++;}
        if(valid>bestValid){bestValid=valid; bestOff=po;}
      }
      if(bestValid<4) continue;
      const cntVerts=cand.vertCount;
      const pos=new Float32Array(cntVerts*3);
      for(let i=0;i<cntVerts;i++){pos[i*3]=dv.getFloat32(cand.posOffset+bestOff+i*cand.stride,true); pos[i*3+1]=dv.getFloat32(cand.posOffset+bestOff+i*cand.stride+4,true); pos[i*3+2]=dv.getFloat32(cand.posOffset+bestOff+i*cand.stride+8,true);}
      // final NaN check
      let hasNaN=false; for(let i=0;i<pos.length;i++) if(!Number.isFinite(pos[i])){hasNaN=true;break;}
      if(hasNaN) continue;
      console.log(`Solid2Model paired: ib @${s} cnt ${count} max ${maxI} with verts ${cntVerts} @${cand.offset} stride ${cand.stride} off ${bestOff} sz ${cand.size.toFixed(2)} valid ${bestValid} flags ${flags}`);
      return {positions:pos,indices:indices,vertCount:cntVerts,triCount:count/3,offset:cand.offset,size:cand.size,method:`solid2model-${isNew?'delta':'direct'}`,posOffset:cand.posOffset+bestOff,stride:cand.stride,ibOffset:s};
    }
  }

  if(candidates.length){
    let best=candidates[0];
    for(const c of candidates) if(c.vertCount>best.vertCount) best=c;
    const pos=new Float32Array(best.vertCount*3);
    for(let i=0;i<best.vertCount;i++){pos[i*3]=dv.getFloat32(best.posOffset+i*12,true); pos[i*3+1]=dv.getFloat32(best.posOffset+i*12+4,true); pos[i*3+2]=dv.getFloat32(best.posOffset+i*12+8,true);}
    console.log(`Point cloud fallback: cnt ${best.vertCount} @${best.offset} stride ${best.stride} sz ${best.size.toFixed(2)}`);
    return {positions:pos,indices:null,vertCount:best.vertCount,triCount:0,offset:best.offset,size:best.size,method:`points-fallback`,posOffset:best.posOffset,stride:best.stride};
  }
  return null;
}
export function parseMesh(d){const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`};}
export function createThreeGeometry(THREE,desc){const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3)); if(desc.indices&&desc.indices.length>=30){g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals();} g.computeBoundingBox(); g.computeBoundingSphere(); return g;}
