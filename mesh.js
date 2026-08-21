export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);
  function getPos(off, stride, i){return [dv.getFloat32(off+i*stride,true),dv.getFloat32(off+i*stride+4,true),dv.getFloat32(off+i*stride+8,true)];}
  function triArea(posOff,stride,a,b,c){
    const pa=getPos(posOff,stride,a), pb=getPos(posOff,stride,b), pc=getPos(posOff,stride,c);
    const abx=pb[0]-pa[0],aby=pb[1]-pa[1],abz=pb[2]-pa[2], acx=pc[0]-pa[0],acy=pc[1]-pa[1],acz=pc[2]-pa[2];
    const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
    return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
  }
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
      if(candidates.length>=20) break;
    }
    if(candidates.length>=20) break;
  }
  candidates.sort((a,b)=>b.vertCount-a.vertCount);
  console.log(`found ${candidates.length} raw candidates`);
  for(let i=0;i<Math.min(3,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);

  for(const cand of candidates){
    const cnt=cand.vertCount, posOff=cand.posOffset, stride=cand.stride;
    const after=posOff+cnt*stride;
    if(cnt<1000) continue;
    // Look for IndexBuffer marker 0x09057001 (new) and 0x09057000 (old)
    for(let s=after; s<Math.min(len-16, after+600); s++){
      const v=dv.getInt32(s,true);
      if(v===0x09057001 || v===0x09057000){
        const isNew = (v===0x09057001);
        console.log(`  found IndexBuffer marker 0x${v.toString(16)} @${s} delta ${s-after} new=${isNew}`);
        let p=s+4;
        if(p+8>len) continue;
        const flags=dv.getInt32(p,true);
        const count=dv.getInt32(p+4,true);
        console.log(`    flags ${flags} count ${count} @${p} (cnt ${cnt})`);
        if(count<60 || count>cnt*6 || count%3!==0) {
          console.log(`    count reject`);
          continue;
        }
        if(isNew){
          // delta-encoded int16
          if(p+8+count*2>len){ console.log(`    not enough data for delta`); continue; }
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
          if(!ok){ console.log(`    delta decode out of range`); continue; }
          const a=indices[0], b=indices[1], c=indices[2];
          const ar=triArea(posOff,stride,a,b,c);
          console.log(`    delta ib first ${a},${b},${c} area ${ar} max ${maxI}`);
          if(ar<1e-5||ar>10){ console.log(`    area reject`); continue; }
          const pos=new Float32Array(cnt*3);
          for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
          console.log(`Raw ib delta: cnt ${cnt} @${cand.offset} stride ${stride} ib ${count} tris ${count/3} max ${maxI}`);
          return {positions:pos,indices:indices,vertCount:cnt,triCount:count/3,offset:cand.offset,size:cand.size,method:`raw-ib-delta-new`,posOffset:posOff,stride};
        } else {
          // old direct u16
          if(p+8+count*2>len) continue;
          let ok=true, maxI=0;
          for(let i=0;i<count;i++){ const idx=dv.getUint16(p+8+i*2,true); if(idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
          if(!ok) continue;
          const a=dv.getUint16(p+8,true), b=dv.getUint16(p+10,true), c=dv.getUint16(p+12,true);
          const ar=triArea(posOff,stride,a,b,c);
          if(ar<1e-5||ar>10) continue;
          const pos=new Float32Array(cnt*3);
          for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
          const idx=new Uint32Array(count);
          for(let i=0;i<count;i++) idx[i]=dv.getUint16(p+8+i*2,true);
          console.log(`Raw ib direct: cnt ${cnt} @${cand.offset} ib ${count} tris ${count/3}`);
          return {positions:pos,indices:idx,vertCount:cnt,triCount:count/3,offset:cand.offset,size:cand.size,method:`raw-ib-direct-old`,posOffset:posOff,stride};
        }
      }
    }
    // Also try VisualIndexed direct (0x0906A000 old) – direct u16 without IndexBuffer wrapper
    for(let s=after; s<Math.min(len-16, after+600); s++){
      const v=dv.getInt32(s,true);
      if(v===0x0906A000){
        let p=s+4;
        if(p+4>len) continue;
        const count=dv.getInt32(p,true);
        if(count<60||count>cnt*6||count%3!==0) continue;
        if(p+4+count*2>len) continue;
        let ok=true, maxI=0;
        for(let i=0;i<count;i++){ const idx=dv.getUint16(p+4+i*2,true); if(idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
        if(!ok) continue;
        const a=dv.getUint16(p+4,true), b=dv.getUint16(p+6,true), c=dv.getUint16(p+8,true);
        const ar=triArea(posOff,stride,a,b,c);
        if(ar<1e-5||ar>10) continue;
        const pos=new Float32Array(cnt*3);
        for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
        const idx=new Uint32Array(count);
        for(let i=0;i<count;i++) idx[i]=dv.getUint16(p+4+i*2,true);
        console.log(`Raw ib VisualIndexed old: cnt ${cnt} @${cand.offset} ib ${count} tris ${count/3}`);
        return {positions:pos,indices:idx,vertCount:cnt,triCount:count/3,offset:cand.offset,size:cand.size,method:`visual-indexed-old`,posOffset:posOff,stride};
      }
    }
  }

  if(candidates.length){
    let best=candidates[0];
    for(const c of candidates) if(c.vertCount>best.vertCount) best=c;
    const pos=new Float32Array(best.vertCount*3);
    for(let i=0;i<best.vertCount;i++){ const p=getPos(best.posOffset,best.stride,i); pos[i*3]=p[0]; pos[i*3+1]=p[1]; pos[i*3+2]=p[2]; }
    console.log(`Point cloud: cnt ${best.vertCount} @${best.offset} stride ${best.stride} sz ${best.size.toFixed(2)}`);
    return {positions:pos,indices:null,vertCount:best.vertCount,triCount:0,offset:best.offset,size:best.size,method:`points-fallback`,posOffset:best.posOffset,stride:best.stride};
  }
  return null;
}
export function parseMesh(d){ const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`}; }
export function createThreeGeometry(THREE,desc){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3)); if(desc.indices&&desc.indices.length>=30){ g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals(); } g.computeBoundingBox(); g.computeBoundingSphere(); return g; }
