export function findMesh(decomp) {
  const dv = new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const len = decomp.length;
  console.log(`findMesh len ${len}`);

  function getPos(off, stride, i) {
    return [dv.getFloat32(off + i * stride, true), dv.getFloat32(off + i * stride + 4, true), dv.getFloat32(off + i * stride + 8, true)];
  }
  function triArea(posOff, stride, a, b, c) {
    const pa = getPos(posOff, stride, a), pb = getPos(posOff, stride, b), pc = getPos(posOff, stride, c);
    const abx = pb[0]-pa[0], aby = pb[1]-pa[1], abz = pb[2]-pa[2];
    const acx = pc[0]-pa[0], acy = pc[1]-pa[1], acz = pc[2]-pa[2];
    const crx = aby*acz - abz*acy, cry = abz*acx - abx*acz, crz = abx*acy - aby*acx;
    return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
  }

  let candidates = [];
  for (let off = 0; off < len - 12; off += 4) {
    for (let stride of [12,24,32,36]) {
      if (off+stride>len) continue;
      const x0=dv.getFloat32(off,true), y0=dv.getFloat32(off+4,true), z0=dv.getFloat32(off+8,true);
      if (!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)) continue;
      if (Math.abs(x0)>50||Math.abs(y0)>50||Math.abs(z0)>50) continue;
      let minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0;
      let cnt=1,o=off+stride;
      while(o+12<=len&&cnt<8000){
        const xx=dv.getFloat32(o,true), yy=dv.getFloat32(o+4,true), zz=dv.getFloat32(o+8,true);
        if (!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)) break;
        if (Math.abs(xx)>50||Math.abs(yy)>50||Math.abs(zz)>50) break;
        if (xx<minx) minx=xx; if (yy<miny) miny=yy; if (zz<minz) minz=zz;
        if (xx>maxx) maxx=xx; if (yy>maxy) maxy=yy; if (zz>maxz) maxz=zz;
        const sz=Math.max(maxx-minx,maxy-miny,maxz-minz);
        if (sz>15) break;
        cnt++; o+=stride;
      }
      if (cnt<60) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if (size<0.15||size>15) continue;
      if (candidates.some(c=>c.offset===off&&c.stride===stride)) continue;
      candidates.push({offset:off,vertCount:cnt,size,posOffset:off,stride});
      if (candidates.length>=20) break;
    }
    if (candidates.length>=20) break;
  }
  candidates.sort((a,b)=>b.vertCount-a.vertCount);
  console.log(`found ${candidates.length} raw candidates`);
  for (let i=0;i<Math.min(5,candidates.length);i++){
    const c=candidates[i];
    console.log(` cand ${i}: cnt ${c.vertCount} @${c.offset} stride ${c.stride} sz ${c.size.toFixed(2)}`);
  }

  for (const cand of candidates){
    const cnt=cand.vertCount, posOff=cand.posOffset, stride=cand.stride;
    const after=posOff+cnt*stride;
    const isBig=cnt>1000;
    if (isBig){
      let hex='', ints='', u16s='';
      for(let i=0;i<32&&after+i<len;i++) hex+=dv.getUint8(after+i).toString(16).padStart(2,'0')+' ';
      for(let i=0;i<4&&after+i*4+4<=len;i++) ints+=dv.getInt32(after+i*4,true)+' ';
      for(let i=0;i<8&&after+i*2+2<=len;i++) u16s+=dv.getUint16(after+i*2,true)+' ';
      console.log(`candidate cnt ${cnt} @${cand.offset} stride ${stride} sz ${cand.size.toFixed(2)} after ${after} hex ${hex} | int32 ${ints} | u16 ${u16s}`);
    }
    // BRUTE FORCE ib without count prefix – look for runs of valid tris
    const searchEnd=Math.min(len-6, after+300000);
    let bestRun=null, bestLen=0;
    for(let s=after; s<searchEnd-6; s+=2){
      // quick check: 3 u16 < cnt
      const a=dv.getUint16(s,true), b=dv.getUint16(s+2,true), c=dv.getUint16(s+4,true);
      if (a>=cnt||b>=cnt||c>=cnt||a===0xFFFF||b===0xFFFF||c===0xFFFF) continue;
      if (a===b||b===c||a===c) continue;
      const area=triArea(posOff,stride,a,b,c);
      if (area<1e-5||area>10) continue;
      // extend run
      let run=3, cur=s+6;
      while(cur+2<len && run<20000){
        const idx=dv.getUint16(cur,true);
        if (idx>=cnt||idx===0xFFFF) break;
        // check tri formed by last 2 + this? For list, need triplets
        // For list, we need groups of 3 – so check if we have complete tri
        if (run%3===2){
          const a2=dv.getUint16(cur-4,true), b2=dv.getUint16(cur-2,true), c2=idx;
          if (a2===b2||b2===c2||a2===c2) break;
          const ar=triArea(posOff,stride,a2,b2,c2);
          if (ar<1e-6||ar>10) break;
        }
        run++; cur+=2;
      }
      if (run>=90 && run>bestLen){
        bestLen=run;
        bestRun={off:s,len:run, type:'u16'};
      }
      if (bestLen>5000) break;
    }
    if (bestRun){
      console.log(`  brute u16 run found @${bestRun.off} len ${bestRun.len} tris ${Math.floor(bestRun.len/3)}`);
      const pos=new Float32Array(cnt*3);
      for(let i=0;i<cnt;i++){ const p=getPos(posOff,stride,i); pos[i*3]=p[0]; pos[i*3+1]=p[1]; pos[i*3+2]=p[2]; }
      const outLen=Math.floor(bestRun.len/3)*3;
      const idx=new Uint32Array(outLen);
      for(let i=0;i<outLen;i++) idx[i]=dv.getUint16(bestRun.off+i*2,true);
      console.log(`Raw ib u16 brute: cnt ${cnt} @${cand.offset} stride ${stride} ib ${outLen} tris ${outLen/3}`);
      return {positions:pos,indices:idx,vertCount:cnt,triCount:outLen/3,offset:cand.offset,size:cand.size,method:`raw-ib-u16-brute`,posOffset:posOff,stride};
    } else if(isBig){
      console.log(`  no brute u16 run found for cnt ${cnt}`);
    }
    // u32 brute
    for(let s=after; s<searchEnd-12; s+=4){
      const a=dv.getInt32(s,true), b=dv.getInt32(s+4,true), c=dv.getInt32(s+8,true);
      if (a<0||a>=cnt||b<0||b>=cnt||c<0||c>=cnt) continue;
      if (a===b||b===c||a===c) continue;
      const area=triArea(posOff,stride,a,b,c);
      if (area<1e-5||area>10) continue;
      let run=3, cur=s+12;
      while(cur+4<=len && run<20000){
        const idx=dv.getInt32(cur,true);
        if (idx<0||idx>=cnt) break;
        run++; cur+=4;
      }
      if (run>=90){
        console.log(`  brute u32 run found @${s} len ${run} tris ${Math.floor(run/3)}`);
        const pos=new Float32Array(cnt*3);
        for(let i=0;i<cnt;i++){ const p=getPos(posOff,stride,i); pos[i*3]=p[0]; pos[i*3+1]=p[1]; pos[i*3+2]=p[2]; }
        const outLen=Math.floor(run/3)*3;
        const idx=new Uint32Array(outLen);
        for(let i=0;i<outLen;i++) idx[i]=dv.getInt32(s+i*4,true);
        console.log(`Raw ib u32 brute: cnt ${cnt} @${cand.offset} stride ${stride} ib ${outLen} tris ${outLen/3}`);
        return {positions:pos,indices:idx,vertCount:cnt,triCount:outLen/3,offset:cand.offset,size:cand.size,method:`raw-ib-u32-brute`,posOffset:posOff,stride};
      }
    }
    if (isBig) console.log(`  no brute u32 run for cnt ${cnt}`);
  }

  if (candidates.length){
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
