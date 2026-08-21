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
  for(let i=0;i<Math.min(5,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);

  for(const cand of candidates){
    const cnt=cand.vertCount, posOff=cand.posOffset, stride=cand.stride;
    const after=posOff+cnt*stride;
    const isBig=cnt>1000;
    if(isBig){
      let hex256='';
      for(let i=0;i<256&&after+i<len;i++){
        hex256+=dv.getUint8(after+i).toString(16).padStart(2,'0')+' ';
        if((i+1)%32===0) hex256+='\n';
      }
      console.log(`candidate cnt ${cnt} @${cand.offset} stride ${stride} after ${after} 256b:\n${hex256}`);
      for(let s=after; s<Math.min(len-16, after+500); s++){
        const v=dv.getInt32(s,true);
        if(v===0x09057001 || v===0x09057000){
          console.log(`  found IndexBuffer marker 0x${v.toString(16)} @${s} (delta ${s-after})`);
          let p=s+4;
          if(p+4<=len){
            const cntIdx=dv.getInt32(p,true);
            console.log(`    after marker int32 ${cntIdx} @${p} next 16b ${( ()=>{ let h=''; for(let i=0;i<16&&p+4+i<len;i++) h+=dv.getUint8(p+4+i).toString(16).padStart(2,'0')+' '; return h; })()}`);
            if(cntIdx>=60 && cntIdx<=cnt*6 && cntIdx%3===0 && p+4+cntIdx*2<=len){
              let ok=true, maxI=0;
              for(let i=0;i<cntIdx;i++){ const idx=dv.getUint16(p+4+i*2,true); if(idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
              if(ok){
                const a=dv.getUint16(p+4,true), b=dv.getUint16(p+6,true), c=dv.getUint16(p+8,true);
                const ar=triArea(posOff,stride,a,b,c);
                console.log(`    -> plausible u16 ib cnt ${cntIdx} max ${maxI} first ${a},${b},${c} area ${ar}`);
                if(ar>1e-5 && ar<10){
                  const pos=new Float32Array(cnt*3);
                  for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
                  const idx=new Uint32Array(cntIdx);
                  for(let i=0;i<cntIdx;i++) idx[i]=dv.getUint16(p+4+i*2,true);
                  console.log(`Raw ib u16 Indexed: cnt ${cnt} @${cand.offset} ib ${cntIdx} tris ${cntIdx/3}`);
                  return {positions:pos,indices:idx,vertCount:cnt,triCount:cntIdx/3,offset:cand.offset,size:cand.size,method:`raw-ib-u16-indexed`,posOffset:posOff,stride};
                }
              }
            }
            if(cntIdx>=60 && cntIdx<=cnt*6 && cntIdx%3===0 && p+4+cntIdx*4<=len){
              let ok=true, maxI=0;
              for(let i=0;i<cntIdx;i++){ const idx=dv.getInt32(p+4+i*4,true); if(idx<0||idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
              if(ok){
                const a=dv.getInt32(p+4,true), b=dv.getInt32(p+8,true), c=dv.getInt32(p+12,true);
                const ar=triArea(posOff,stride,a,b,c);
                console.log(`    -> plausible u32 ib cnt ${cntIdx} max ${maxI} area ${ar}`);
                if(ar>1e-5 && ar<10){
                  const pos=new Float32Array(cnt*3);
                  for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
                  const idx=new Uint32Array(cntIdx);
                  for(let i=0;i<cntIdx;i++) idx[i]=dv.getInt32(p+4+i*4,true);
                  console.log(`Raw ib u32 Indexed: cnt ${cnt} @${cand.offset} ib ${cntIdx} tris ${cntIdx/3}`);
                  return {positions:pos,indices:idx,vertCount:cnt,triCount:cntIdx/3,offset:cand.offset,size:cand.size,method:`raw-ib-u32-indexed`,posOffset:posOff,stride};
                }
              }
            }
            if(p+8<=len){
              const cnt2=dv.getInt32(p+4,true);
              console.log(`    try skip version, cnt2 ${cnt2} @${p+4}`);
              if(cnt2>=60 && cnt2<=cnt*6 && cnt2%3===0 && p+8+cnt2*2<=len){
                let ok=true, maxI=0;
                for(let i=0;i<cnt2;i++){ const idx=dv.getUint16(p+8+i*2,true); if(idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
                if(ok){
                  const a=dv.getUint16(p+8,true), b=dv.getUint16(p+10,true), c=dv.getUint16(p+12,true);
                  const ar=triArea(posOff,stride,a,b,c);
                  console.log(`    skip version u16 cnt ${cnt2} max ${maxI} area ${ar} first ${a},${b},${c}`);
                  if(ar>1e-5 && ar<10){
                    const pos=new Float32Array(cnt*3);
                    for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
                    const idx=new Uint32Array(cnt2);
                    for(let i=0;i<cnt2;i++) idx[i]=dv.getUint16(p+8+i*2,true);
                    console.log(`Raw ib u16 Indexed v2: cnt ${cnt} @${cand.offset} ib ${cnt2} tris ${cnt2/3}`);
                    return {positions:pos,indices:idx,vertCount:cnt,triCount:cnt2/3,offset:cand.offset,size:cand.size,method:`raw-ib-u16-indexed-v2`,posOffset:posOff,stride};
                  }
                }
              }
              if(cnt2>=60 && cnt2<=cnt*6 && cnt2%3===0 && p+8+cnt2*4<=len){
                let ok=true, maxI=0;
                for(let i=0;i<cnt2;i++){ const idx=dv.getInt32(p+8+i*4,true); if(idx<0||idx>=cnt){ ok=false; break; } if(idx>maxI) maxI=idx; }
                if(ok){
                  const a=dv.getInt32(p+8,true), b=dv.getInt32(p+12,true), c=dv.getInt32(p+16,true);
                  const ar=triArea(posOff,stride,a,b,c);
                  console.log(`    skip version u32 cnt ${cnt2} max ${maxI} area ${ar}`);
                  if(ar>1e-5 && ar<10){
                    const pos=new Float32Array(cnt*3);
                    for(let i=0;i<cnt;i++){ const pp=getPos(posOff,stride,i); pos[i*3]=pp[0]; pos[i*3+1]=pp[1]; pos[i*3+2]=pp[2]; }
                    const idx=new Uint32Array(cnt2);
                    for(let i=0;i<cnt2;i++) idx[i]=dv.getInt32(p+8+i*4,true);
                    console.log(`Raw ib u32 Indexed v2: cnt ${cnt} @${cand.offset} ib ${cnt2} tris ${cnt2/3}`);
                    return {positions:pos,indices:idx,vertCount:cnt,triCount:cnt2/3,offset:cand.offset,size:cand.size,method:`raw-ib-u32-indexed-v2`,posOffset:posOff,stride};
                  }
                }
              }
            }
          }
        }
      }
      let bestRun=null, bestLen=0;
      const searchEnd=Math.min(len-6, after+300000);
      for(let s=after; s<searchEnd-6; s+=2){
        const a=dv.getUint16(s,true), b=dv.getUint16(s+2,true), c=dv.getUint16(s+4,true);
        if(a>=cnt||b>=cnt||c>=cnt||a===0xFFFF||b===0xFFFF||c===0xFFFF) continue;
        if(a===b||b===c||a===c) continue;
        const ar=triArea(posOff,stride,a,b,c);
        if(ar<1e-5||ar>10) continue;
        let run=3, cur=s+6;
        while(cur+2<len && run<20000){
          const idx=dv.getUint16(cur,true);
          if(idx>=cnt||idx===0xFFFF) break;
          run++; cur+=2;
        }
        if(run>=90 && run>bestLen){ bestLen=run; bestRun={off:s,len:run}; }
        if(bestLen>5000) break;
      }
      if(bestRun){
        const pos=new Float32Array(cnt*3);
        for(let i=0;i<cnt;i++){ const p=getPos(posOff,stride,i); pos[i*3]=p[0]; pos[i*3+1]=p[1]; pos[i*3+2]=p[2]; }
        const outLen=Math.floor(bestRun.len/3)*3;
        const idx=new Uint32Array(outLen);
        for(let i=0;i<outLen;i++) idx[i]=dv.getUint16(bestRun.off+i*2,true);
        console.log(`Raw ib u16 brute: cnt ${cnt} @${cand.offset} stride ${stride} ib ${outLen} tris ${outLen/3} @${bestRun.off}`);
        return {positions:pos,indices:idx,vertCount:cnt,triCount:outLen/3,offset:cand.offset,size:cand.size,method:`raw-ib-u16-brute`,posOffset:posOff,stride};
      } else {
        console.log(`  no brute u16 run for cnt ${cnt}`);
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
