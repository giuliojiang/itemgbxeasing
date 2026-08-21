export function readU32(b,o){ return (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0; }
export function parseGBX(u8){
  if(String.fromCharCode(...u8.slice(0,3))!=='GBX') throw new Error('Not GBX');
  const userSize=readU32(u8,13);
  const hdrEnd=17+userSize;
  const bPtr=hdrEnd+8;
  const uncomp=readU32(u8,bPtr);
  const comp=readU32(u8,bPtr+4);
  const cStart=bPtr+8, cEnd=cStart+comp;
  const classId=readU32(u8,9);
  const isBUUR = (u8[7]===0x55) || (comp===uncomp && cEnd<=u8.length && cEnd-cStart===uncomp);
  return { hdrEnd, bPtr, uncomp, comp, cStart, cEnd, userSize, classId, origBytes:u8, isBUUR };
}

function scoreCandidate(c, bufLen){
  let s=0;
  if(c.off>300) s+=1;
  if(c.off<bufLen*0.85) s+=2;
  if(c.rotP>=200&&c.rotP<=20000) s+=3; else if(c.rotP>=100) s+=1; else if(c.rotP>0&&c.rotP<50) s-=5;
  if(c.transP>=200&&c.transP<=20000) s+=3; else if(c.transP>=100) s+=1; else if(c.transP>0&&c.transP<50) s-=5;
  if(c.ver===2||c.ver===3) s+=3; else if(c.ver===1) s+=1;
  if(c.rotMax===c.rotP&&c.rotP>0) s+=2;
  if(c.transMax===c.transP&&c.transP>0) s+=2;
  if(c.axis>=0&&c.axis<=2) s+=1; else s-=2;
  if(Math.abs(c.transY)>=0.2&&Math.abs(c.transY)<=15) s+=2; else if(Math.abs(c.transY)>=0.05) s+=0.5; else if(c.transP>0) s-=2;
  if(Math.abs(c.rotAng)>=0.2&&Math.abs(c.rotAng)<=10) s+=2; else if(Math.abs(c.rotAng)>=0.05) s+=0.5; else if(c.rotP>0) s-=1;
  if(Math.abs(c.transY)<1e-6&&Math.abs(c.rotAng)<1e-6) s-=3;
  if(c.rotP===1&&c.transP===1) s-=10;
  if(Math.abs(c.transY)<1e-6 && c.transY!==0) s-=5;
  return s;
}

function scoreOldCandidate(c){
  let s=0;
  if(c.transMin!==c.transMax) s+=3;
  if(c.angleMin!==c.angleMax) s+=4;
  if(Math.abs(c.angleMax-c.angleMin)>=5) s+=2;
  if(Math.abs(c.transMax-c.transMin)>=0.1) s+=2;
  if(c.transDur>=200&&c.transDur<=20000) s+=1;
  if(c.rotDur>=200&&c.rotDur<=20000) s+=1;
  if(c.transAxis>=0&&c.transAxis<=2) s+=1;
  if(c.rotAxis>=0&&c.rotAxis<=2) s+=1;
  // Santa -16 to 16 is large but valid for moving items
  if(Math.abs(c.transMax)<=30 && Math.abs(c.transMin)<=30) s+=1;
  return s;
}

function findNewMovers(buf){
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let cands=[];
  for(let off=0; off<buf.length-16; off++){
    const ver=dv.getInt32(off,true);
    if(ver<0||ver>3) continue;
    const rotP=dv.getInt32(off+4,true);
    const transP=dv.getInt32(off+8,true);
    if(rotP<-1||rotP>500000||transP<-1||transP>500000) continue;
    if(rotP<=0&&transP<=0) continue;
    if(rotP===0&&transP===0) continue;
    if(rotP>0&&rotP<100&&transP>0&&transP<100) continue;
    if(rotP===1&&transP===1) continue;
    const transY=dv.getFloat32(off+12,true);
    if(!Number.isFinite(transY)) continue;
    if(Math.abs(transY)>200) continue;
    if(transP>=100 && Math.abs(transY)<0.05) continue;
    if(transP>=100 && Math.abs(transY)>20) continue;
    if(ver===0){
      if((rotP>=100&&rotP<=50000)||(transP>=100&&transP<=50000)){
        if(Math.abs(transY)>=0.05&&Math.abs(transY)<=20){
          cands.push({type:"new",off,ver,rotP,transP,transY,axis:1,rotMax:rotP,transMax:transP,rotFunc:0,rotAng:0,structSize:16});
        }
      }
      continue;
    }
    if(off+20>buf.length) continue;
    const axis=dv.getInt32(off+16,true);
    if(axis<0||axis>2) continue;
    if(ver===1){
      cands.push({type:"new",off,ver,rotP,transP,transY,axis,rotMax:rotP,transMax:transP,rotFunc:0,rotAng:0,structSize:20});
      continue;
    }
    if(off+28>buf.length) continue;
    const rotMax=dv.getInt32(off+20,true);
    const transMax=dv.getInt32(off+24,true);
    if(rotMax<-1||rotMax>500000||transMax<-1||transMax>500000) continue;
    if(ver===2){
      cands.push({type:"new",off,ver,rotP,transP,transY,axis,rotMax:rotMax||rotP,transMax:transMax||transP,rotFunc:0,rotAng:0,structSize:28});
      continue;
    }
    if(off+33>buf.length) continue;
    const rf=buf[off+28];
    if(rf>8) continue;
    const ra=dv.getFloat32(off+29,true);
    if(!Number.isFinite(ra)) continue;
    if(Math.abs(ra)>100) continue;
    if(rotP>=100 && Math.abs(ra)<0.05) continue;
    cands.push({type:"new",off,ver,rotP,transP,transY,axis,rotMax:rotMax||rotP,transMax:transMax||transP,rotFunc:rf,rotAng:ra,structSize:33});
  }
  return cands;
}

function findOldMovers(buf){
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let cands=[];
  // scan for classID 0x2F0CA000
  for(let off=0; off<buf.length-40; off++){
    if(dv.getUint32(off,true)!==0x2F0CA000) continue;
    let o=off+4;
    if(o+8>buf.length) continue;
    const ver=dv.getInt32(o,true); o+=4;
    const sub=dv.getInt32(o,true); o+=4;
    if(ver!==0) continue;
    if(sub<0||sub>5) continue;
    if(o+8>buf.length) continue;
    const transIsDur=dv.getInt32(o,true); o+=4;
    if(transIsDur!==0&&transIsDur!==1) continue;
    const transCnt=dv.getInt32(o,true); o+=4;
    if(transCnt<0||transCnt>4) continue;
    if(o+transCnt*6>buf.length) continue;
    let transDur=0, transEase=1, transRev=0;
    let transDurOffs=[];
    for(let i=0;i<transCnt;i++){
      const ease=buf[o]; const rev=buf[o+1]; const dur=dv.getInt32(o+2,true);
      if(ease>34) { transDur=-1; break; }
      if(rev>1) { transDur=-1; break; }
      if(dur<-1||dur>20000) { /* allow 0 but not huge */ if(dur!==0) { transDur=-1; break; } }
      if(i===0){ transDur=dur; transEase=ease; transRev=rev; }
      transDurOffs.push(o+2);
      o+=6;
    }
    if(transDur===-1) continue;
    if(o+8>buf.length) continue;
    const rotIsDur=dv.getInt32(o,true); o+=4;
    if(rotIsDur!==0&&rotIsDur!==1) continue;
    const rotCnt=dv.getInt32(o,true); o+=4;
    if(rotCnt<0||rotCnt>4) continue;
    if(o+rotCnt*6>buf.length) continue;
    let rotDur=0, rotEase=1;
    let rotDurOffs=[];
    for(let i=0;i<rotCnt;i++){
      const ease=buf[o]; const rev=buf[o+1]; const dur=dv.getInt32(o+2,true);
      if(ease>34) { rotDur=-1; break; }
      if(rev>1) { rotDur=-1; break; }
      if(dur<-1||dur>20000) { if(dur!==0){ rotDur=-1; break; } }
      if(i===0){ rotDur=dur; rotEase=ease; }
      rotDurOffs.push(o+2);
      o+=6;
    }
    if(rotDur===-1) continue;
    if(o+12>buf.length) continue;
    const shaderType=dv.getInt32(o,true); o+=4;
    const shaderVer=dv.getInt32(o,true); o+=4;
    const shaderCnt=dv.getInt32(o,true); o+=4;
    if(shaderType<0||shaderType>1) continue;
    if(shaderCnt<0||shaderCnt>4) continue;
    if(o+shaderCnt*8>buf.length) continue;
    o+=shaderCnt*8;
    if(o+18>buf.length) continue;
    // TransAxis – 1 byte, NO pad, then float min/max packed
    const transAxis=buf[o]; o+=1;
    if(transAxis>2) continue;
    const transMinOff=o;
    const transMin=dv.getFloat32(o,true); o+=4;
    const transMaxOff=o;
    const transMax=dv.getFloat32(o,true); o+=4;
    if(!Number.isFinite(transMin)||!Number.isFinite(transMax)) continue;
    if(Math.abs(transMin)>1000||Math.abs(transMax)>1000) continue;
    const rotAxis=buf[o]; o+=1;
    if(rotAxis>2) continue;
    const angleMinOff=o;
    const angleMin=dv.getFloat32(o,true); o+=4;
    const angleMaxOff=o;
    const angleMax=dv.getFloat32(o,true); o+=4;
    if(!Number.isFinite(angleMin)||!Number.isFinite(angleMax)) continue;
    if(Math.abs(angleMin)>720||Math.abs(angleMax)>720) continue;

    const cand={
      type:"old",
      off,
      ver, sub,
      transIsDur, transCnt, transDur, transEase, transRev, transDurOffs,
      rotIsDur, rotCnt, rotDur, rotEase, rotDurOffs,
      shaderType, shaderVer, shaderCnt,
      transAxis, transMin, transMax, transMinOff, transMaxOff,
      rotAxis, angleMin, angleMax, angleMinOff, angleMaxOff,
      // for unified scoring
      transP: transDur,
      rotP: rotDur,
      // keep raw size
      structSize: o-off,
      _transAxisOff: off+ (o-off) - (18) -4 -4 -1, // approximate, not used for patch
      _rotAxisOff: off+ (o-off) -9 -4 -1
    };
    // store axis offs correctly
    cand._transAxisOff = transMinOff-1;
    cand._rotAxisOff = angleMinOff-1;
    cand.score=scoreOldCandidate(cand);
    cands.push(cand);
  }
  return cands;
}

export function findMover(buf){
  const newCands=findNewMovers(buf);
  for(const c of newCands) c.score=scoreCandidate(c, buf.length);
  const oldCands=findOldMovers(buf);

  let best=null;
  let bestScore=-100;
  for(const c of newCands){
    if(c.score>bestScore){ best=c; bestScore=c.score; }
  }
  for(const c of oldCands){
    if(c.score>bestScore){ best=c; bestScore=c.score; }
  }

  if(best){
    if(best.type==="new" && best.score>=3) return best;
    if(best.type==="old" && best.score>=2) return best;
    // if best score low, still return old if it has real movement
    if(best.type==="old" && (best.transMin!==best.transMax || best.angleMin!==best.angleMax)) return best;
    throw new Error('No high-confidence mover – best score '+best.score.toFixed(1)+' at off '+best.off+' type '+best.type);
  }
  throw new Error('No mover found – static item or unknown layout.');
}

export function patchMover(decomp, off, mover){
  if(mover.type==="old"){
    return patchOldMover(decomp, mover);
  }
  // new format
  if(off<0||off+33>decomp.length) return false;
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  const ver=mover.ver??2;
  dv.setInt32(off, ver, true);
  dv.setInt32(off+4, Math.round(mover.rotP), true);
  dv.setInt32(off+8, Math.round(mover.transP), true);
  dv.setFloat32(off+12, mover.transY, true);
  if(ver>=1) dv.setInt32(off+16, mover.axis, true);
  if(ver>=2){
    dv.setInt32(off+20, Math.round(mover.rotMax??mover.rotP), true);
    dv.setInt32(off+24, Math.round(mover.transMax??mover.transP), true);
  }
  if(ver>=3){
    decomp[off+28]=mover.rotFunc??0;
    dv.setFloat32(off+29, mover.rotAng, true);
  }
  return true;
}

function patchOldMover(decomp, mover){
  // mover is expected to have offs + new values
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  if(mover.transMinOff!==undefined) dv.setFloat32(mover.transMinOff, mover.transMin, true);
  if(mover.transMaxOff!==undefined) dv.setFloat32(mover.transMaxOff, mover.transMax, true);
  if(mover.angleMinOff!==undefined) dv.setFloat32(mover.angleMinOff, mover.angleMin, true);
  if(mover.angleMaxOff!==undefined) dv.setFloat32(mover.angleMaxOff, mover.angleMax, true);
  if(mover.transDurOffs){
    for(const off of mover.transDurOffs) dv.setInt32(off, Math.round(mover.transP||mover.transDur||5000), true);
  }
  if(mover.rotDurOffs){
    for(const off of mover.rotDurOffs) dv.setInt32(off, Math.round(mover.rotP||mover.rotDur||6600), true);
  }
  // also allow patching axis if changed
  if(mover._transAxisOff!==undefined) decomp[mover._transAxisOff]=mover.transAxis;
  if(mover._rotAxisOff!==undefined) decomp[mover._rotAxisOff]=mover.rotAxis;
  return true;
}

export function buildBUUR(origBytes, bodyPtr, decomp){
  const header=origBytes.slice(0, bodyPtr);
  const out=new Uint8Array(header.length+8+decomp.length);
  out.set(header,0);
  const dv=new DataView(out.buffer);
  dv.setUint32(bodyPtr, decomp.length, true);
  dv.setUint32(bodyPtr+4, decomp.length, true);
  out.set(decomp, bodyPtr+8);
  if(out.length>7) out[7]=0x55;
  return out;
}
export function getDecompBytes(origBytes, parsed, decompressFn){
  if(parsed.isBUUR) return origBytes.slice(parsed.bPtr+8, parsed.bPtr+8+parsed.uncomp);
  return decompressFn(origBytes.slice(parsed.cStart, parsed.cEnd), parsed.uncomp);
}
