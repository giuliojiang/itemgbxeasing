// gbx.js — parse GBX Item, find mover, patch, build BUUR (handles both BUCR and BUUR)
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
  const fmt = String.fromCharCode(u8[7]||0); // 'B' for BUCR, 'U' for BUUR (byte 7 is format char in "BUCR"/"BUUR")
  // Actually byte 7 is second char of "BUCR": B U C R, so byte 7 is 'U' for both? No, byte 4-7 is "GBX" + version, byte 7 is 'B' or 'U'?
  // For BUCR, bytes 4-7 are 06 00 42 55 43 52? Wait spec: 0-2 "GBX", 3 version, 4-7 "BUCR" or "BUUR"
  // Safer: detect by checking if byte 7 is 'U' (0x55) vs 'C' (0x43) for compressed
  const isBUUR = (u8[7]===0x55) || (comp===uncomp && cEnd<=u8.length && cEnd-cStart===uncomp);
  return { hdrEnd, bPtr, uncomp, comp, cStart, cEnd, userSize, classId, origBytes:u8, isBUUR, fmtChar: String.fromCharCode(u8[7]) };
}

function scoreCandidate(c, bufLen){
  let s=0;
  if(c.off>300) s+=1;
  if(c.off<bufLen*0.8) s+=1;
  if(c.ver===2||c.ver===3) s+=2;
  else if(c.ver===1) s+=1;
  if(c.rotP>=100&&c.rotP<=20000) s+=2;
  if(c.transP>=100&&c.transP<=20000) s+=2;
  if(c.rotMax===c.rotP) s+=1;
  if(c.transMax===c.transP) s+=1;
  if(c.axis>=0&&c.axis<=2) s+=1;
  if(Math.abs(c.transY)>=0.1) s+=1;
  if(Math.abs(c.rotAng)>=0.1) s+=1;
  return s;
}

export function findMover(buf){
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let cands=[];
  for(let off=0; off<buf.length-33; off++){
    const ver=dv.getInt32(off,true);
    if(ver<0||ver>6) continue;
    const rotP=dv.getInt32(off+4,true), transP=dv.getInt32(off+8,true);
    if(rotP<0||rotP>500000||transP<0||transP>500000) continue;
    if(rotP===0&&transP===0) continue;
    const transY=dv.getFloat32(off+12,true);
    if(!Number.isFinite(transY)) continue;
    if(Math.abs(transY)>500) continue;
    const axis=dv.getInt32(off+16,true);
    if(axis<0||axis>5) continue;
    const rotMax=dv.getInt32(off+20,true), transMax=dv.getInt32(off+24,true);
    if(rotMax<0||rotMax>500000||transMax<0||transMax>500000) continue;
    const rf=buf[off+28];
    if(rf>10) continue;
    const ra=dv.getFloat32(off+29,true);
    if(!Number.isFinite(ra)) continue;
    if(Math.abs(ra)>1000) continue;
    if(transP>0){
      if(Math.abs(transY)<0.02 || Math.abs(transY)>30) continue;
    }
    if(rotP>0){
      if(Math.abs(ra)<0.02 || Math.abs(ra)>10) continue;
    }
    const cand={off,ver,rotP,transP,transY,axis:Math.min(axis,2),rotMax,transMax,rotFunc:rf,rotAng:ra};
    cand.score=scoreCandidate(cand, buf.length);
    cands.push(cand);
  }
  if(cands.length){
    cands.sort((a,b)=>b.score-a.score);
    const best=cands.find(c=>c.off>400) || cands[0];
    return best;
  }
  // Fallback: looser pass
  for(let off=0; off<buf.length-33; off++){
    const ver=dv.getInt32(off,true);
    if(ver<0||ver>3) continue;
    const rotP=dv.getInt32(off+4,true), transP=dv.getInt32(off+8,true);
    if(rotP<=0 && transP<=0) continue;
    if(rotP<0||rotP>20000||transP<0||transP>20000) continue;
    const transY=dv.getFloat32(off+12,true);
    const axis=dv.getInt32(off+16,true);
    if(axis<0||axis>2) continue;
    const rotMax=dv.getInt32(off+20,true), transMax=dv.getInt32(off+24,true);
    const rf=buf[off+28];
    const ra=dv.getFloat32(off+29,true);
    if(!Number.isFinite(transY)||!Number.isFinite(ra)) continue;
    return {off,ver,rotP,transP,transY: Math.abs(transY)>0.01?transY:1.5, axis, rotMax: rotMax||rotP, transMax: transMax||transP, rotFunc: rf<=3?rf:0, rotAng: Math.abs(ra)>0.01?ra:1.57, score:0, fallback:true};
  }
  throw new Error('No mover found – static item or unknown layout. Using default IR.');
}

export function patchMover(decomp, off, mover){
  if(off<0 || off+33> decomp.length){
    return false;
  }
  const dv=new DataView(decomp.buffer, decomp.byteOffset, decomp.byteLength);
  dv.setInt32(off, mover.ver??2, true);
  dv.setInt32(off+4, Math.round(mover.rotP), true);
  dv.setInt32(off+8, Math.round(mover.transP), true);
  dv.setFloat32(off+12, mover.transY, true);
  dv.setInt32(off+16, mover.axis, true);
  dv.setInt32(off+20, Math.round(mover.rotMax??mover.rotP), true);
  dv.setInt32(off+24, Math.round(mover.transMax??mover.transP), true);
  decomp[off+28]=mover.rotFunc??0;
  dv.setFloat32(off+29, mover.rotAng, true);
  return true;
}

export function buildBUUR(origBytes, bodyPtr, decomp){
  const header = origBytes.slice(0, bodyPtr);
  const out = new Uint8Array(header.length + 8 + decomp.length);
  out.set(header,0);
  const dv=new DataView(out.buffer);
  dv.setUint32(bodyPtr, decomp.length, true);
  dv.setUint32(bodyPtr+4, decomp.length, true);
  out.set(decomp, bodyPtr+8);
  if(out.length>7) out[7]=0x55; // 'U' -> BUUR
  return out;
}

// Helper to get decomp from either BUCR (needs lzo) or BUUR (raw)
export function getDecompBytes(origBytes, parsed, decompressFn){
  if(parsed.isBUUR){
    // body is uncompressed already
    return origBytes.slice(parsed.bPtr+8, parsed.bPtr+8+parsed.uncomp);
  }else{
    const comp=origBytes.slice(parsed.cStart, parsed.cEnd);
    return decompressFn(comp, parsed.uncomp);
  }
}
