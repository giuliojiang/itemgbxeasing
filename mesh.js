/**
 * mesh.js – Combined Crystal + Solid2Model extractor
 * Handles:
 *  - CPlugCrystal 0x09003000 (old Items) via edges->tris (2856v) and ib
 *  - CPlugSolid2Model VisualIndexed with CPlugIndexBuffer 0x09057001 delta-encoded (new Items 1673/3333)
 */

export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);

  function getPos12(off,i){return [dv.getFloat32(off+i*12,true),dv.getFloat32(off+i*12+4,true),dv.getFloat32(off+i*12+8,true)];}
  function getPosStrided(off,stride,i){return [dv.getFloat32(off+i*stride,true),dv.getFloat32(off+i*stride+4,true),dv.getFloat32(off+i*stride+8,true)];}
  function triArea12(posOff,a,b,c){
    const pa=getPos12(posOff,a), pb=getPos12(posOff,b), pc=getPos12(posOff,c);
    const abx=pb[0]-pa[0],aby=pb[1]-pa[1],abz=pb[2]-pa[2], acx=pc[0]-pa[0],acy=pc[1]-pa[1],acz=pc[2]-pa[2];
    const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
    return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
  }
  function triAreaStrided(posOff,stride,a,b,c){
    const pa=getPosStrided(posOff,stride,a), pb=getPosStrided(posOff,stride,b), pc=getPosStrided(posOff,stride,c);
    const abx=pb[0]-pa[0],aby=pb[1]-pa[1],abz=pb[2]-pa[2], acx=pc[0]-pa[0],acy=pc[1]-pa[1],acz=pc[2]-pa[2];
    const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
    return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
  }

  // 1. Crystal edge->tris (old Item.Gbx) – for RotBalloons 2856v
  for (let off = 0; off < len - 4 - 60 * 12; off += 4) {
    const cnt = dv.getInt32(off, true);
    if (cnt < 80 || cnt > 6000) continue;
    const posOff = off + 4;
    if (posOff + cnt * 12 > len) continue;
    let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
    let ok=true, zero=0;
    for(let i=0;i<Math.min(cnt,60);i++){
      const x=dv.getFloat32(posOff+i*12,true), y=dv.getFloat32(posOff+i*12+4,true), z=dv.getFloat32(posOff+i*12+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){ ok=false; break; }
      if(Math.abs(x)<1e-6&&Math.abs(y)<1e-6&&Math.abs(z)<1e-6) zero++;
      if(Math.abs(x)>30||Math.abs(y)>30||Math.abs(z)>30){ ok=false; break; }
      if(x<minx)minx=x; if(y<miny)miny=y; if(z<minz)minz=z;
      if(x>maxx)maxx=x; if(y>maxy)maxy=y; if(z>maxz)maxz=z;
    }
    if(!ok||zero>30) continue;
    const sx=maxx-minx, sy=maxy-miny, sz=maxz-minz;
    const size=Math.max(sx,sy,sz);
    if(size<0.2||size>12) continue;
    if(Math.min(sx,sy,sz)<size*0.02 && cnt>200) continue;
    const after=posOff+cnt*12;
    if(after+4>len) continue;
    const edgeCnt=dv.getInt32(after,true);
    if(edgeCnt<cnt*0.4||edgeCnt>cnt*3) continue;
    if(after+4+edgeCnt*8>len) continue;
    let edgesOk=true;
    for(let i=0;i<Math.min(edgeCnt,16);i++){
      const a=dv.getInt32(after+4+i*8,true), b=dv.getInt32(after+4+i*8+4,true);
      if(a<0||a>=cnt||b<0||b>=cnt||a===b){ edgesOk=false; break; }
    }
    if(!edgesOk) continue;
    const adj=new Map(); for(let i=0;i<cnt;i++) adj.set(i,new Set());
    for(let i=0;i<edgeCnt;i++){
      const a=dv.getInt32(after+4+i*8,true), b=dv.getInt32(after+4+i*8+4,true);
      if(a>=0&&a<cnt&&b>=0&&b<cnt){ adj.get(a).add(b); adj.get(b).add(a); }
    }
    let tris=[], seen=new Set();
    for(let i=0;i<cnt;i++){
      const neigh=[...adj.get(i)];
      if(neigh.length<2) continue;
      for(let j=0;j<neigh.length;j++) for(let k=j+1;k<neigh.length;k++){
        const a=neigh[j], b=neigh[k];
        if(adj.get(a).has(b)){
          const s=[i,a,b].sort((x,y)=>x-y).join(",");
          if(!seen.has(s)){ seen.add(s); tris.push([i,a,b]); }
        }
      }
      if(tris.length>cnt*4) break;
    }
    if(tris.length<cnt*0.3||tris.length>cnt*3||tris.length<20) continue;
    let valid=0;
    for(let t=0;t<Math.min(10,tris.length);t++){
      const [ia,ib,ic]=tris[t];
      const ax=dv.getFloat32(posOff+ia*12,true), ay=dv.getFloat32(posOff+ia*12+4,true), az=dv.getFloat32(posOff+ia*12+8,true);
      const bx=dv.getFloat32(posOff+ib*12,true), by=dv.getFloat32(posOff+ib*12+4,true), bz=dv.getFloat32(posOff+ib*12+8,true);
      const cx=dv.getFloat32(posOff+ic*12,true), cy=dv.getFloat32(posOff+ic*12+4,true), cz=dv.getFloat32(posOff+ic*12+8,true);
      const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az;
      const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
      const area=Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
      if(area>1e-6&&area<10) valid++;
    }
    if(valid<Math.min(5,tris.length)) continue;
    const positions=new Float32Array(cnt*3);
    for(let i=0;i<cnt;i++){ positions[i*3]=dv.getFloat32(posOff+i*12,true); positions[i*3+1]=dv.getFloat32(posOff+i*12+4,true); positions[i*3+2]=dv.getFloat32(posOff+i*12+8,true); }
    const indices=new Uint32Array(tris.length*3);
    for(let i=0;i<tris.length;i++){ indices[i*3]=tris[i][0]; indices[i*3+1]=tris[i][1]; indices[i*3+2]=tris[i][2]; }
    const faceOff=after+4+edgeCnt*8;
    const faceCnt=faceOff+4<=len?dv.getInt32(faceOff,true):0;
    console.log(`Crystal mesh: cnt ${cnt} @${off} sz ${size.toFixed(2)} edge ${edgeCnt} face ${faceCnt} tris ${tris.length}`);
    return {positions,indices,vertCount:cnt,triCount:tris.length,offset:off,size,method:`crystal-edges`,faceCount:faceCnt,edgeCount:edgeCnt,posOffset:posOff,stride:12};
  }

  // 2. Solid2Model – raw verts stride 12/24/32/36 + IndexBuffer delta (new format)
  let candidates=[];
  for(let off=0;off<len-12;off+=4){
    for(let stride of [12,24,32,36]){
      if(off+stride>len) continue;
      const x0=dv.getFloat32(off,true),y0=dv.getFloat32(off+4,true),z0=dv.getFloat32(off+8,true);
      if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)) continue;
      if(Math.abs(x0)>50||Math.abs(y0)>50||Math.abs(z0)>50) continue;
      let minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0,cnt=1,o=off+stride;
      while(o+12<=len&&cnt<8000){
        const xx=dv.getFloat32(o,true),yy=dv.getFloat32(o+4,true),zz=dv.getFloat32(o+8,true);
        if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)) break;
        if(Math.abs(xx)>50||Math.abs(yy)>50||Math.abs(zz)>50) break;
        if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
        if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        if(Math.max(maxx-minx,maxy-miny,maxz-minz)>15) break;
        cnt++; o+=stride;
      }
      if(cnt<60) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if(size<0.15||size>15) continue;
      if(candidates.some(c=>c.offset===off&&c.stride===stride)) continue;
      candidates.push({offset:off,vertCount:cnt,size,posOffset:off,stride});
      if(candidates.length>=24) break;
    }
    if(candidates.length>=24) break;
  }
  candidates.sort((a,b)=>b.vertCount-a.vertCount);
  console.log(`found ${candidates.length} raw candidates`);
  for(let i=0;i<Math.min(4,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);

  for(const cand of candidates){
    const cnt=cand.vertCount, posOff=cand.posOffset, stride=cand.stride;
    const after=posOff+cnt*stride;
    if(cnt<80) continue;
    // dump first verts for big ones
    if(cnt>800){
      console.log(`  cand ${cnt}@${cand.offset} s${stride} v0 ${getPosStrided(posOff,stride,0).map(x=>x.toFixed(3)).join(',')} v1 ${getPosStrided(posOff,stride,1).map(x=>x.toFixed(3)).join(',')} v2 ${getPosStrided(posOff,stride,2).map(x=>x.toFixed(3)).join(',')}`);
    }
    for(let s=after; s<Math.min(len-16, after+800); s++){
      const v=dv.getInt32(s,true);
      if(v===0x09057001 || v===0x09057000){
        const isNew=(v===0x09057001);
        let p=s+4;
        if(p+8>len) continue;
        const flags=dv.getInt32(p,true);
        const count=dv.getInt32(p+4,true);
        if(count<60||count>cnt*6||count%3!==0) continue;
        if(isNew){
          if(p+8+count*2>len) continue;
          let cur=0;
          const indices=new Uint32Array(count);
          let maxI=0, ok=true;
          for(let i=0;i<count;i++){
            const delta=dv.getInt16(p+8+i*2,true);
            cur+=delta;
            if(cur<0||cur>=cnt){ ok=false; break; }
            indices[i]=cur;
            if(cur>maxI) maxI=cur;
          }
          if(!ok) continue;
          let valid=0, total=0;
          for(let i=0;i<Math.min(count-2,30); i+=3){
            const a=indices[i], b=indices[i+1], c=indices[i+2];
            if(a===b||b===c||a===c) continue;
            const ar=triAreaStrided(posOff,stride,a,b,c);
            total++; if(ar>1e-6&&ar<20) valid++;
          }
          console.log(`    delta ib @${s} cnt ${count} max ${maxI} valid ${valid}/${total} flags ${flags}`);
          if(valid===0) continue;
          const pos=new Float32Array(cnt*3);
          for(let i=0;i<cnt;i++){ const pp=getPosStrided(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
          console.log(`Raw ib delta: cnt ${cnt} @${cand.offset} stride ${stride} ib ${count} tris ${count/3} max ${maxI}`);
          return {positions:pos,indices:indices,vertCount:cnt,triCount:count/3,offset:cand.offset,size:cand.size,method:`raw-ib-delta-new`,posOffset:posOff,stride};
        } else {
          if(p+8+count*2>len) continue;
          let ok=true, maxI=0;
          for(let i=0;i<count;i++){ const idx=dv.getUint16(p+8+i*2,true); if(idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
          if(!ok) continue;
          let valid=0;
          for(let i=0;i<Math.min(count-2,30); i+=3){
            const a=dv.getUint16(p+8+i*2,true), b=dv.getUint16(p+8+(i+1)*2,true), c=dv.getUint16(p+8+(i+2)*2,true);
            if(a===b||b===c||a===c) continue;
            const ar=triAreaStrided(posOff,stride,a,b,c);
            if(ar>1e-6&&ar<20) valid++;
          }
          if(valid===0) continue;
          const pos=new Float32Array(cnt*3);
          for(let i=0;i<cnt;i++){ const pp=getPosStrided(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
          const idx=new Uint32Array(count);
          for(let i=0;i<count;i++) idx[i]=dv.getUint16(p+8+i*2,true);
          console.log(`Raw ib direct: cnt ${cnt} @${cand.offset} ib ${count} tris ${count/3}`);
          return {positions:pos,indices:idx,vertCount:cnt,triCount:count/3,offset:cand.offset,size:cand.size,method:`raw-ib-direct-old`,posOffset:posOff,stride};
        }
      }
    }
  }

  // 3. Fallback ib search for Santa etc. (old heuristic u16/u32 with count prefix)
  for(const cand of candidates){
    if(cand.vertCount>2000) continue; // big ones already handled
    const cnt=cand.vertCount, posOff=cand.posOffset;
    const searchStart=posOff+cnt*12;
    const searchEnd=Math.min(len-6, searchStart+250000);
    for(let s=searchStart; s<searchEnd; s+=2){
      if(s+2+60>len) continue;
      const icnt=dv.getUint16(s,true);
      if(icnt<60||icnt>cnt*4||icnt%3!==0) continue;
      if(s+2+icnt*2>len) continue;
      let ok=true; for(let i=0;i<Math.min(30,icnt);i++){ const idx=dv.getUint16(s+2+i*2,true); if(idx>=cnt){ ok=false; break; } }
      if(!ok) continue;
      const ia=dv.getUint16(s+2,true), ib=dv.getUint16(s+4,true), ic=dv.getUint16(s+6,true);
      if(ia>=cnt||ib>=cnt||ic>=cnt) continue;
      const ar=triArea12(posOff,ia,ib,ic);
      if(ar<1e-6||ar>10) continue;
      const positions=new Float32Array(cnt*3);
      for(let i=0;i<cnt;i++){ positions[i*3]=dv.getFloat32(posOff+i*12,true); positions[i*3+1]=dv.getFloat32(posOff+i*12+4,true); positions[i*3+2]=dv.getFloat32(posOff+i*12+8,true); }
      const indices=new Uint32Array(icnt);
      for(let i=0;i<icnt;i++) indices[i]=dv.getUint16(s+2+i*2,true);
      console.log(`Mesh via ib: cnt ${cnt} @${cand.offset} sz ${cand.size.toFixed(2)} ib ${icnt} @${s} tris ${icnt/3}`);
      return {positions,indices,vertCount:cnt,triCount:icnt/3,offset:cand.offset,size:cand.size,method:`heuristic-ib-u16`,posOffset:posOff,ibOffset:s+2,stride:12};
    }
  }

  if(candidates.length){
    let best=candidates[0];
    for(const c of candidates) if(c.vertCount>best.vertCount) best=c;
    const pos=new Float32Array(best.vertCount*3);
    for(let i=0;i<best.vertCount;i++){ const pp=getPosStrided(best.posOffset,best.stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
    console.log(`Point cloud: cnt ${best.vertCount} @${best.offset} stride ${best.stride} sz ${best.size.toFixed(2)}`);
    return {positions:pos,indices:null,vertCount:best.vertCount,triCount:0,offset:best.offset,size:best.size,method:`points-fallback`,posOffset:best.posOffset,stride:best.stride};
  }
  return null;
}
export function parseMesh(d){
  const s=findMesh(d);
  if(!s) return {geometries:[],reason:`no mesh`};
  return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`};
}
export function createThreeGeometry(THREE,desc){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3));
  if(desc.indices&&desc.indices.length>=30){
    g.setIndex(new THREE.BufferAttribute(desc.indices,1));
    g.computeVertexNormals();
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
