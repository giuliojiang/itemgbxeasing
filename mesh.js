export function findMesh(decomp){
  const dv=new DataView(decomp.buffer,decomp.byteOffset,decomp.byteLength);
  const len=decomp.length;
  console.log(`findMesh len ${len}`);
  function triAreaOff(posOff,offInStride,stride,a,b,c){
    try{
      const ax=dv.getFloat32(posOff+offInStride+a*stride,true), ay=dv.getFloat32(posOff+offInStride+a*stride+4,true), az=dv.getFloat32(posOff+offInStride+a*stride+8,true);
      const bx=dv.getFloat32(posOff+offInStride+b*stride,true), by=dv.getFloat32(posOff+offInStride+b*stride+4,true), bz=dv.getFloat32(posOff+offInStride+b*stride+8,true);
      const cx=dv.getFloat32(posOff+offInStride+c*stride,true), cy=dv.getFloat32(posOff+offInStride+c*stride+4,true), cz=dv.getFloat32(posOff+offInStride+c*stride+8,true);
      if(!Number.isFinite(ax)||!Number.isFinite(ay)||!Number.isFinite(az)||!Number.isFinite(bx)||!Number.isFinite(by)||!Number.isFinite(bz)||!Number.isFinite(cx)||!Number.isFinite(cy)||!Number.isFinite(cz)) return 0;
      const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az;
      const crx=aby*acz-abz*acy, cry=abz*acx-abx*acz, crz=abx*acy-aby*acx;
      return Math.sqrt(crx*crx+cry*cry+crz*crz)*0.5;
    }catch(e){return 0;}
  }
  function allFinite(off,vc,stride,po=0){
    for(let i=0;i<vc;i++){
      const x=dv.getFloat32(off+po+i*stride,true), y=dv.getFloat32(off+po+i*stride+4,true), z=dv.getFloat32(off+po+i*stride+8,true);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) return false;
    }
    return true;
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
  // 2. VertexStream proper
  let vsCands=[];
  for(let s=0;s<len-20;s++){
    if(dv.getInt32(s,true)!==0x09056000) continue;
    if(s+16>=len) continue;
    if(dv.getInt32(s+4,true)!==0x09056000) continue;
    const ver=dv.getInt32(s+8,true);
    if(ver!==1) continue;
    const cnt=dv.getInt32(s+12,true);
    if(cnt<50||cnt>12000) continue;
    const flags=dv.getInt32(s+16,true);
    if(flags!==1) continue;
    const nodeRef=dv.getInt32(s+20,true);
    if(nodeRef!==-1) continue;
    const declCount=dv.getInt32(s+24,true);
    if(declCount<1||declCount>16) continue;
    let p=s+28;
    let okDecl=true;
    for(let i=0;i<declCount;i++){
      if(p+12>len){okDecl=false;break;}
      const f1=dv.getUint32(p,true);
      const type=(f1>>9)&0x1FF;
      const wc=f1&0x1FF;
      if(type>6){okDecl=false;break;}
      if(wc>200){okDecl=false;break;}
      p+=12;
    }
    if(!okDecl) continue;
    const searchEnd=Math.min(len-12, p+20000);
    for(let off=p;off<searchEnd;off++){
      const x0=dv.getFloat32(off,true);
      if(!Number.isFinite(x0)||Math.abs(x0)>50) continue;
      if(off+cnt*12>len) continue;
      const xl=dv.getFloat32(off+(cnt-1)*12,true);
      if(!Number.isFinite(xl)) continue;
      let hasNaN=false, minx=x0,miny=dv.getFloat32(off+4,true),minz=dv.getFloat32(off+8,true),maxx=x0,maxy=miny,maxz=minz;
      if(!Number.isFinite(miny)||!Number.isFinite(minz)) continue;
      for(let i=1;i<cnt;i+=Math.max(1,Math.floor(cnt/60))){
        const x=dv.getFloat32(off+i*12,true), y=dv.getFloat32(off+i*12+4,true), z=dv.getFloat32(off+i*12+8,true);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){hasNaN=true;break;}
        if(Math.abs(x)>80||Math.abs(y)>80||Math.abs(z)>80){hasNaN=true;break;}
        if(x<minx)minx=x; if(y<miny)miny=y; if(z<minz)minz=z;
        if(x>maxx)maxx=x; if(y>maxy)maxy=y; if(z>maxz)maxz=z;
      }
      if(hasNaN) continue;
      const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
      if(size<0.1||size>50) continue;
      if(!allFinite(off,cnt,12,0)) continue;
      vsCands.push({vsOff:s,cnt,off,size,declCount,method:'vs'});
      break;
    }
  }
  console.log(`vsCands ${vsCands.length}`, vsCands.slice(0,5).map(c=>`${c.cnt}@${c.off} sz${c.size.toFixed(2)}`).join(' '));
  if(vsCands.length){
    let ibs=[];
    for(let s=0;s<len-16;s++){
      const v=dv.getInt32(s,true);
      if(v!==0x09057001&&v!==0x09057000) continue;
      let p=s+4; if(p+8>len) continue;
      const count=dv.getInt32(p+4,true);
      if(count<30||count>30000||count%3!==0) continue;
      if(p+8+count*2>len) continue;
      let cur=0,maxI=0,ok=true;
      const idx=new Uint32Array(count);
      const isNew=v===0x09057001;
      if(isNew){
        for(let i=0;i<count;i++){const d=dv.getInt16(p+8+i*2,true); cur+=d; if(cur<0||cur>30000){ok=false;break;} idx[i]=cur; if(cur>maxI) maxI=cur;}
      }else{
        for(let i=0;i<count;i++){const id=dv.getUint16(p+8+i*2,true); if(id>30000){ok=false;break;} idx[i]=id; if(id>maxI) maxI=id;}
      }
      if(!ok||maxI<10) continue;
      ibs.push({off:s,count,maxI,idx,isNew});
    }
    console.log(`ibs ${ibs.length}`);
    let best=null, bestScore=-1;
    for(const ib of ibs){
      for(const vs of vsCands){
        if(vs.cnt<=ib.maxI) continue;
        if(vs.cnt>ib.maxI+2000 && vs.cnt> ib.maxI*2) continue;
        let valid=0;
        for(let i=0;i<Math.min(ib.count-2,60);i+=3){
          const a=ib.idx[i],b=ib.idx[i+1],c=ib.idx[i+2];
          if(a>=vs.cnt||b>=vs.cnt||c>=vs.cnt) continue;
          if(a===b||b===c||a===c) continue;
          const ar=triAreaOff(vs.off,0,12,a,b,c);
          if(ar>1e-7&&ar<50) valid++;
        }
        if(valid<4) continue;
        const score=valid*10 - Math.abs(vs.cnt-(ib.maxI+1))*0.01;
        if(score>bestScore){
          bestScore=score;
          best={ib,vs,valid};
        }
      }
    }
    if(best){
      const vc=best.vs.cnt;
      const pos=new Float32Array(vc*3);
      for(let i=0;i<vc;i++){pos[i*3]=dv.getFloat32(best.vs.off+i*12,true); pos[i*3+1]=dv.getFloat32(best.vs.off+i*12+4,true); pos[i*3+2]=dv.getFloat32(best.vs.off+i*12+8,true);}
      console.log(`Solid2Model vs: ib @${best.ib.off} cnt ${best.ib.count} max ${best.ib.maxI} with vs ${vc} @${best.vs.off} sz ${best.vs.size.toFixed(2)} valid ${best.valid}`);
      return {positions:pos,indices:best.ib.idx,vertCount:vc,triCount:best.ib.count/3,offset:best.vs.off,size:best.vs.size,method:`solid2model-vs`,posOffset:best.vs.off,stride:12,ibOffset:best.ib.off};
    }
  }
  // 3. Fallback float-run candidates with full NaN check
  let candidates=[];
  for(let off=0;off<len-12;off+=4){
    for(let stride of [12]){
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
        if(Math.max(maxx-minx,maxy-miny,maxz-minz)>35) break;
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
  console.log(`found ${candidates.length} raw candidates`);
  for(let i=0;i<Math.min(5,candidates.length);i++) console.log(` cand ${i}: cnt ${candidates[i].vertCount} @${candidates[i].offset} stride ${candidates[i].stride} sz ${candidates[i].size.toFixed(2)}`);
  for(let s=0;s<len-16;s++){
    const v=dv.getInt32(s,true);
    if(v!==0x09057001&&v!==0x09057000) continue;
    const isNew=(v===0x09057001);
    let p=s+4; if(p+8>len) continue;
    const count=dv.getInt32(p+4,true);
    if(count<30||count>20000||count%3!==0) continue;
    if(p+8+count*2>len) continue;
    let cur=0,maxI=0,ok=true;
    const indices=new Uint32Array(count);
    if(isNew){
      for(let i=0;i<count;i++){const d=dv.getInt16(p+8+i*2,true); cur+=d; if(cur<0||cur>20000){ok=false;break;} indices[i]=cur; if(cur>maxI) maxI=cur;}
    } else {
      for(let i=0;i<count;i++){const idx=dv.getUint16(p+8+i*2,true); if(idx>20000){ok=false;break;} indices[i]=idx; if(idx>maxI) maxI=idx;}
    }
    if(!ok) continue;
    if(maxI<10) continue;
    for(const cand of candidates){
      if(cand.vertCount<=maxI) continue;
      if(cand.offset+cand.vertCount*cand.stride > s+8000) continue;
      if(s - (cand.offset+cand.vertCount*cand.stride) > 100000) continue;
      let bestValid=0;
      let valid=0;
      for(let i=0;i<Math.min(count-2,30);i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2]; if(a===b||b===c||a===c) continue; const ar=triAreaOff(cand.posOffset,0,cand.stride,a,b,c); if(ar>1e-6&&ar<20) valid++;}
      bestValid=valid;
      if(bestValid<4) continue;
      const cntVerts=cand.vertCount;
      if(!allFinite(cand.posOffset,cntVerts,cand.stride,0)) continue;
      const pos=new Float32Array(cntVerts*3);
      for(let i=0;i<cntVerts;i++){pos[i*3]=dv.getFloat32(cand.posOffset+i*cand.stride,true); pos[i*3+1]=dv.getFloat32(cand.posOffset+i*cand.stride+4,true); pos[i*3+2]=dv.getFloat32(cand.posOffset+i*cand.stride+8,true);}
      console.log(`Solid2Model paired: ib @${s} cnt ${count} max ${maxI} with verts ${cntVerts} @${cand.offset} stride ${cand.stride} sz ${cand.size.toFixed(2)} valid ${bestValid}`);
      return {positions:pos,indices:indices,vertCount:cntVerts,triCount:count/3,offset:cand.offset,size:cand.size,method:`solid2model-${isNew?'delta':'direct'}`,posOffset:cand.posOffset,stride:cand.stride,ibOffset:s};
    }
  }
  {
    const gaps=[0,4,8,12,16,24,32,48,64,84,96,128,256,512,1024,2048,4096,8192];
    for(let ss=0;ss<len-16;ss++){
      const vv=dv.getInt32(ss,true);
      if(vv!==0x09057001&&vv!==0x09057000) continue;
      const isNew2=(vv===0x09057001);
      let pp=ss+4; if(pp+8>len) continue;
      const cc=dv.getInt32(pp+4,true);
      if(cc<30||cc>30000||cc%3!==0) continue;
      if(pp+8+cc*2>len) continue;
      let cur2=0,maxI2=0,ok2=true;
      const idx2=new Uint32Array(cc);
      if(isNew2){ for(let i=0;i<cc;i++){const d=dv.getInt16(pp+8+i*2,true); cur2+=d; if(cur2<0||cur2>30000){ok2=false;break;} idx2[i]=cur2; if(cur2>maxI2) maxI2=cur2; } } else { for(let i=0;i<cc;i++){const id=dv.getUint16(pp+8+i*2,true); if(id>30000){ok2=false;break;} idx2[i]=id; if(id>maxI2) maxI2=id; } }
      if(!ok2||maxI2<10) continue;
      for(let gap of gaps){
        const vc=maxI2+1;
        const off=ss - vc*12 - gap;
        if(off<0||off+vc*12>len) continue;
        if(!allFinite(off,vc,12,0)) continue;
        let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
        for(let i=0;i<vc;i+=Math.max(1,Math.floor(vc/20))){
          const xx=dv.getFloat32(off+i*12,true), yy=dv.getFloat32(off+i*12+4,true), zz=dv.getFloat32(off+i*12+8,true);
          if(xx<minx)minx=xx; if(yy<miny)miny=yy; if(zz<minz)minz=zz;
          if(xx>maxx)maxx=xx; if(yy>maxy)maxy=yy; if(zz>maxz)maxz=zz;
        }
        const size=Math.max(maxx-minx,maxy-miny,maxz-minz);
        if(size<0.05||size>50) continue;
        let valid=0;
        for(let i=0;i<Math.min(cc-2,60);i+=3){const a=idx2[i],b=idx2[i+1],c=idx2[i+2]; if(a>=vc||b>=vc||c>=vc) continue; if(a===b||b===c||a===c) continue; const ar=triAreaOff(off,0,12,a,b,c); if(ar>1e-7&&ar<50) valid++;}
        if(valid<4) continue;
        const positions=new Float32Array(vc*3);
        for(let i=0;i<vc;i++){positions[i*3]=dv.getFloat32(off+i*12,true); positions[i*3+1]=dv.getFloat32(off+i*12+4,true); positions[i*3+2]=dv.getFloat32(off+i*12+8,true);}
        console.log(`Solid2Model direct: ib @${ss} cnt ${cc} max ${maxI2} with verts ${vc} @${off} sz ${size.toFixed(2)} valid ${valid} gap ${gap}`);
        return {positions,indices:idx2,vertCount:vc,triCount:cc/3,offset:off,size,method:`solid2model-direct`,posOffset:off,stride:12,ibOffset:ss};
      }
    }
  }
  if(candidates.length){
    let best=candidates[0];
    for(const c of candidates) if(c.vertCount>best.vertCount) best=c;
    if(!allFinite(best.posOffset,best.vertCount,12,0)){
      for(const c of candidates) if(allFinite(c.posOffset,c.vertCount,12,0)){best=c;break;}
    }
    const pos=new Float32Array(best.vertCount*3);
    for(let i=0;i<best.vertCount;i++){pos[i*3]=dv.getFloat32(best.posOffset+i*12,true); pos[i*3+1]=dv.getFloat32(best.posOffset+i*12+4,true); pos[i*3+2]=dv.getFloat32(best.posOffset+i*12+8,true);}
    console.log(`Point cloud fallback: cnt ${best.vertCount} @${best.offset} stride ${best.stride} sz ${best.size.toFixed(2)}`);
    return {positions:pos,indices:null,vertCount:best.vertCount,triCount:0,offset:best.offset,size:best.size,method:`points-fallback`,posOffset:best.posOffset,stride:best.stride};
  }
  return null;
}
export function parseMesh(d){const s=findMesh(d); if(!s) return {geometries:[],reason:`no mesh`}; return {geometries:[s],reason:`${s.vertCount} @${s.offset} stride ${s.stride||12} ${s.method} tris ${s.triCount} sz ${s.size.toFixed(2)}`};}
export function createThreeGeometry(THREE,desc){
  const g=new THREE.BufferGeometry();
  for(let i=0;i<desc.positions.length;i++) if(!Number.isFinite(desc.positions[i])){console.warn('NaN in positions, aborting'); return g;}
  g.setAttribute('position',new THREE.BufferAttribute(desc.positions,3));
  if(desc.indices&&desc.indices.length>=30){g.setIndex(new THREE.BufferAttribute(desc.indices,1)); g.computeVertexNormals();}
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
