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
  // penalize tiny float that is actually int
  if(Math.abs(c.transY)<1e-6 && c.transY!==0) s-=5;
  return s;
}
export function findMover(buf){
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
    // require plausible transY if transP>0
    if(transP>=100 && Math.abs(transY)<0.05) continue;
    if(transP>=100 && Math.abs(transY)>20) continue;
    if(ver===0){
      if((rotP>=100&&rotP<=50000)||(transP>=100&&transP<=50000)){
        if(Math.abs(transY)>=0.05&&Math.abs(transY)<=20){
          cands.push({off,ver,rotP,transP,transY,axis:1,rotMax:rotP,transMax:transP,rotFunc:0,rotAng:0,structSize:16});
        }
      }
      continue;
    }
    if(off+20>buf.length) continue;
    const axis=dv.getInt32(off+16,true);
    if(axis<0||axis>2) continue;
    if(ver===1){
      cands.push({off,ver,rotP,transP,transY,axis,rotMax:rotP,transMax:transP,rotFunc:0,rotAng:0,structSize:20});
      continue;
    }
    if(off+28>buf.length) continue;
    const rotMax=dv.getInt32(off+20,true);
    const transMax=dv.getInt32(off+24,true);
    if(rotMax<-1||rotMax>500000||transMax<-1||transMax>500000) continue;
    if(ver===2){
      cands.push({off,ver,rotP,transP,transY,axis,rotMax:rotMax||rotP,transMax:transMax||transP,rotFunc:0,rotAng:0,structSize:28});
      continue;
    }
    if(off+33>buf.length) continue;
    const rf=buf[off+28];
    if(rf>8) continue;
    const ra=dv.getFloat32(off+29,true);
    if(!Number.isFinite(ra)) continue;
    if(Math.abs(ra)>100) continue;
    if(rotP>=100 && Math.abs(ra)<0.05) continue;
    cands.push({off,ver,rotP,transP,transY,axis,rotMax:rotMax||rotP,transMax:transMax||transP,rotFunc:rf,rotAng:ra,structSize:33});
  }
  if(cands.length){
    for(const c of cands) c.score=scoreCandidate(c, buf.length);
    cands.sort((a,b)=>b.score-a.score);
    const best=cands[0];
    if(best.score>=3) return best;
    // if best score low, treat as not found to avoid false positive
    throw new Error('No high-confidence mover – best score '+best.score.toFixed(1)+' at off '+best.off+' ver '+best.ver+' rotP '+best.rotP+' transP '+best.transP);
  }
  throw new Error('No mover found – static item or unknown layout.');
}
export function patchMover(decomp, off, mover){
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
