export function findMesh(decomp){
  const dv=new DataView(decomp.buffer,decomp.byteOffset,decomp.byteLength);
  const len=decomp.length;
  console.log(`findMesh len ${len}`);
  function triArea(posOff,stride,a,b,c,po=0){
    const offA=posOff+po+a*stride, offB=posOff+po+b*stride, offC=posOff+po+c*stride;
    if(offA<0||offB<0||offC<0||offA+8>=len||offB+8>=len||offC+8>=len) return 0;
    const ax=dv.getFloat32(offA,true), ay=dv.getFloat32(offA+4,true), az=dv.getFloat32(offA+8,true);
    const bx=dv.getFloat32(offB,true), by=dv.getFloat32(offB+4,true), bz=dv.getFloat32(offB+8,true);
    const cx=dv.getFloat32(offC,true), cy=dv.getFloat32(offC+4,true), cz=dv.getFloat32(offC+8,true);
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
    let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9, ok=true, zero=0;
    for(let i=0;i<Math.min(cnt,60);i++){
      const x=dv.getFloat32(posOff+i*12,true), y=dv.getFloat32(posOff+i*12+4,true), z=dv.getFloat32(posOff+i*12+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){ok=false;break;}
      if(Math.abs(x)<1e-6&&Math.abs(y)<1e-6&&Math.abs(z)<1e-6) zero++;
      if(Math.abs(x)>30||Math.abs(y)>30||Math.abs(z)>30){ok=false;break;}
      if(x<minx)minx=x; if(y<miny)miny=y; if(z<minz)minz=z;
      if(x>maxx)maxx=x; if(y>maxy)maxy=y; if(z>maxz)maxz=z;
    }
    if(!ok||zero>30) continue;
    const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
    if(size<0.2||size>12) continue;
    if(Math.min(maxx-minx,maxy-miny,maxz-minz)<size*0.02&&cnt>200) continue;
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

  // Build raw float candidates
  let candidates=[];
  for(let off=0;off<len-12;off+=4){
    for(let stride of [12,24]){
      if(off+stride>len) continue;
      const x0=dv.getFloat32(off,true),y0=dv.getFloat32(off+4,true),z0=dv.getFloat32(off+8,true);
      if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)) continue;
      if(Math.abs(x0)>50||Math.abs(y0)>50||Math.abs(z0)>50) continue;
      let minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0,cnt=1,o=off+stride,bad=false;
      while(o+12<=len&&cnt<8000){
        const xx=dv.getFloat32(o,true),yy=dv.getFloat32(o+4,true),zz=dv.getFloat32(o+8,true);
        if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)){bad=true;break;}
        if(Math.abs(xx)>50||Math.abs(yy)>50||Math.abs(zz)>50) break;
        if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
        if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        if(Math.max(maxx-minx,maxy-miny,maxz-minz)>15) break;
        cnt++; o+=stride;
      }
      if(bad) continue;
      if(cnt<80) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if(size<0.2||size>15) continue;
      if(candidates.some(c=>c.offset===off&&c.stride===stride)) continue;
      candidates.push({offset:off,vertCount:cnt,size,posOffset:off,stride});
      if(candidates.length>=40) break;
    }
    if(candidates.length>=40) break;
  }
  candidates.sort((a,b)=>b.vertCount-a.vertCount);
  console.log(`found ${candidates.length} raw candidates`);
  for(let i=0;i<Math.min(5,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);

  // 2. Solid2Model
  let ibs=[];
  for(let s=0;s<len-16;s++){
    const v=dv.getInt32(s,true);
    if(v!==0x09057001 && v!==0x09057000) continue;
    const isNew=(v===0x09057001);
    let p=s+4; if(p+8>len) continue;
    const count=dv.getInt32(p+4,true);
    if(count<60||count>20000||count%3!==0) continue;
    if(p+8+count*2>len) continue;
    let cur=0,maxI=0,ok=true;
    const indices=new Uint32Array(count);
    if(isNew){
      for(let i=0;i<count;i++){const d=dv.getInt16(p+8+i*2,true); cur+=d; if(cur<0||cur>20000){ok=false;break;} indices[i]=cur; if(cur>maxI) maxI=cur;}
    }else{
      for(let i=0;i<count;i++){const idx=dv.getUint16(p+8+i*2,true); if(idx>20000){ok=false;break;} indices[i]=idx; if(idx>maxI) maxI=idx;}
    }
    if(!ok||maxI<20) continue;
    ibs.push({offset:s,count,maxI,indices,isNew});
    if(ibs.length>=10) break;
  }
  console.log(`found ${ibs.length} IndexBuffers`);
  for(let ib of ibs) console.log(` ib @${ib.offset} cnt ${ib.count} max ${ib.maxI} ${ib.isNew?'delta':'direct'}`);

  let best=null,bestScore=-1;
  for(let ib of ibs){
    for(let stride of [12,24]){
      for(let gap of [0,4,8,12,16,24,32,48,64,84,96,128]){
        const vc=ib.maxI+1;
        const off=ib.offset - vc*stride - gap;
        if(off<0||off+vc*stride>len) continue;
        const x0=dv.getFloat32(off,true), y0=dv.getFloat32(off+4,true), z0=dv.getFloat32(off+8,true);
        const x1=dv.getFloat32(off+(vc-1)*stride,true), y1=dv.getFloat32(off+(vc-1)*stride+4,true), z1=dv.getFloat32(off+(vc-1)*stride+8,true);
        if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(z0)||!Number.isFinite(x1)||!Number.isFinite(y1)||!Number.isFinite(z1)) continue;
        if(Math.abs(x0)>50||Math.abs(y0)>50||Math.abs(z0)>50||Math.abs(x1)>50||Math.abs(y1)>50||Math.abs(z1)>50) continue;
        let ok=true, minx=x0,miny=y0,minz=z0,maxx=x0,maxy=y0,maxz=z0;
        for(let i=0;i<vc;i+=Math.max(1,Math.floor(vc/30))){
          const xx=dv.getFloat32(off+i*stride,true), yy=dv.getFloat32(off+i*stride+4,true), zz=dv.getFloat32(off+i*stride+8,true);
          if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)){ok=false;break;}
          if(Math.abs(xx)>50||Math.abs(yy)>50||Math.abs(zz)>50){ok=false;break;}
          if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
          if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        }
        if(!ok) continue;
        const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
        if(size<0.15||size>15) continue;
        const tryOffs=stride===24?[0,12]:[0];
        for(let po of tryOffs){
          let valid=0;
          for(let i=0;i<Math.min(ib.count-2,60);i+=3){const a=ib.indices[i],b=ib.indices[i+1],c=ib.indices[i+2]; if(a>=vc||b>=vc||c>=vc) continue; if(a===b||b===c||a===c) continue; const ar=triArea(off,stride,a,b,c,po); if(ar>1e-6&&ar<20) valid++;}
          if(valid<5) continue;
          const score=valid*1000 - gap;
          if(score>bestScore){bestScore=score; best={ib,off,vc,size,stride,po,valid,gap};}
        }
      }
    }
    for(let cand of candidates){
      if(cand.vertCount<=ib.maxI) continue;
      if(cand.offset+cand.vertCount*cand.stride>ib.offset+2000) continue;
      if(ib.offset - (cand.offset+cand.vertCount*cand.stride) > 100000) continue;
      const tryOffs=cand.stride===24?[0,12]:[0];
      for(let po of tryOffs){
        let valid=0;
        for(let i=0;i<Math.min(ib.count-2,60);i+=3){const a=ib.indices[i],b=ib.indices[i+1],c=ib.indices[i+2]; if(a>=cand.vertCount||b>=cand.vertCount||c>=cand.vertCount) continue; if(a===b||b===c||a===c) continue; const ar=triArea(cand.posOffset,cand.stride,a,b,c,po); if(ar>1e-6&&ar<20) valid++;}
        if(valid<4) continue;
        const gap=ib.offset-(cand.offset+cand.vertCount*cand.stride);
        const score=valid*800 - gap*0.1 - (cand.vertCount/(ib.maxI+1))*10;
        if(score>bestScore){bestScore=score; best={ib,off:cand.posOffset,vc:cand.vertCount,size:cand.size,stride:cand.stride,po,valid,gap,cand:true};}
      }
    }
  }
  if(best){
    const ib=best.ib;
    const cntVerts=best.vc;
    if(best.off+best.po+cntVerts*best.stride<=len){
      const pos=new Float32Array(cntVerts*3);
      let bad=false;
      for(let i=0;i<cntVerts;i++){const xx=dv.getFloat32(best.off+best.po+i*best.stride,true), yy=dv.getFloat32(best.off+best.po+i*best.stride+4,true), zz=dv.getFloat32(best.off+best.po+i*best.stride+8,true); if(!Number.isFinite(xx)||!Number.isFinite(yy)||!Number.isFinite(zz)){bad=true;break;} pos[i*3]=xx; pos[i*3+1]=yy; pos[i*3+2]=zz;}
      if(!bad){
        console.log(`Solid2Model BEST: ib @${ib.offset} cnt ${ib.count} max ${ib.maxI} with verts ${cntVerts} @${best.off} stride ${best.stride} off ${best.po} sz ${best.size.toFixed(2)} valid ${best.valid} gap ${best.gap} ${best.cand?'cand':'direct'}`);
        return {positions:pos,indices:ib.indices,vertCount:cntVerts,triCount:ib.count/3,offset:best.off,size:best.size,method:`solid2model-best`,posOffset:best.off+best.po,stride:best.stride,ibOffset:ib.offset};
      }
    }
  }

  // 3. Legacy old files – u16 ib with count prefix (Santa) – also try direct pairing
  for(let cand of candidates){
    // direct offset just before ib 0x09057000/001 already handled, now try generic u16 near candidate
    for(let s=Math.max(0,cand.offset+cand.vertCount*cand.stride-500); s<Math.min(len-6,cand.offset+cand.vertCount*cand.stride+2000); s+=2){
      if(s+4>len) continue;
      const cnt=dv.getUint16(s,true);
      if(cnt<30||cnt>10000||cnt%3!==0) continue;
      if(s+4+cnt*2>len) continue;
      let maxI=0,ok=true;
      for(let i=0;i<Math.min(cnt,30);i++){const idx=dv.getUint16(s+4+i*2,true); if(idx>=cand.vertCount){ok=false;break;} if(idx>maxI) maxI=idx;}
      if(!ok) continue;
      let valid=0; for(let i=0;i<Math.min(cnt-2,30);i+=3){const a=dv.getUint16(s+4+i*2,true),b=dv.getUint16(s+4+i*2+2,true),c=dv.getUint16(s+4+i*2+4,true); if(a===b||b===c||a===c) continue; const ar=triArea(cand.posOffset,cand.stride,a,b,c,0); if(ar>1e-6&&ar<10) valid++;}
      if(valid<4) continue;
      console.log(`Legacy u16 cnt ${cnt} @${s} max ${maxI} verts ${cand.vertCount} @${cand.offset} valid ${valid}`);
      const pos=new Float32Array(cand.vertCount*3);
      for(let i=0;i<cand.vertCount;i++){pos[i*3]=dv.getFloat32(cand.posOffset+i*cand.stride,true); pos[i*3+1]=dv.getFloat32(cand.posOffset+i*cand.stride+4,true); pos[i*3+2]=dv.getFloat32(cand.posOffset+i*cand.stride+8,true);}
      const indices=new Uint32Array(cnt); for(let i=0;i<cnt;i++) indices[i]=dv.getUint16(s+4+i*2,true);
      return {positions:pos,indices,vertCount:cand.vertCount,triCount:cnt/3,offset:cand.offset,size:cand.size,method:`legacy-u16-count`,posOffset:cand.posOffset,stride:cand.stride};
    }
    if(candidates.indexOf(cand)>=5) break;
  }

  if(candidates.length){
    let b=candidates[0];
    for(let c of candidates) if(c.vertCount>b.vertCount) b=c;
    const pos=new Float32Array(b.vertCount*3);
    for(let i=0;i<b.vertCount;i++){pos[i*3]=dv.getFloat32(b.posOffset+i*b.stride,true); pos[i*3+1]=dv.getFloat32(b.posOffset+i*b.stride+4,true); pos[i*3+2]=dv.getFloat32(b.posOffset+i*b.stride+8,true);}
    console.log(`Point cloud fallback: cnt ${b.vertCount} @${b.offset} stride ${b.stride} sz ${b.size.toFixed(2)}`);
    return {positions:pos,indices:null,vertCount:b.vertCount,triCount:0,offset:b.offset,size:b.size,method:`points-fallback`,posOffset:b.posOffset,stride:b.stride};
  }
  return null;
}
export function parseMesh(d){const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`};}
export function createThreeGeometry(THREE,desc){const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3)); if(desc.indices&&desc.indices.length>=30){g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals();} g.computeBoundingBox(); g.computeBoundingSphere(); return g;}
