// gbx.js — parse GBX Item, find mover, patch, build BUUR
export function readU32(b,o){ return (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0; }
export function readI32(b,o){ const u=readU32(b,o); return u>>0; }

export function parseGBX(u8){
  if(String.fromCharCode(...u8.slice(0,3))!=='GBX') throw new Error('Not GBX');
  const userSize=readU32(u8,13);
  const hdrEnd=17+userSize;
  const bPtr=hdrEnd+8;
  const uncomp=readU32(u8,bPtr);
  const comp=readU32(u8,bPtr+4);
  const cStart=bPtr+8, cEnd=cStart+comp;
  const classId=readU32(u8,9);
  return { hdrEnd, bPtr, uncomp, comp, cStart, cEnd, userSize, classId, origBytes:u8 };
}

export function findMover(buf){
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let candidates=[];
  for(let off=0; off<buf.length-36; off++){
    const ver=dv.getInt32(off,true); if(ver<0||ver>3) continue;
    const rotP=dv.getInt32(off+4,true), transP=dv.getInt32(off+8,true);
    if(rotP<=0 && transP<=0) continue;
    if(rotP<0||rotP>20000||transP<0||transP>20000) continue;
    // require at least one period >=100
    if(rotP>0 && rotP<50) continue;
    if(transP>0 && transP<50) continue;
    const transY=dv.getFloat32(off+12,true);
    if(!Number.isFinite(transY)) continue;
    if(Math.abs(transY)>30) continue;
    // transY should be plausible: if transP>0 then transY should be >0.01 and <20
    if(transP>0 && (Math.abs(transY)<0.01 || Math.abs(transY)>20)) {
      // allow 0 transY if only rot?
      if(rotP===0) continue;
    }
    const axis=dv.getInt32(off+16,true); if(axis<0||axis>2) continue;
    const rotMax=dv.getInt32(off+20,true), transMax=dv.getInt32(off+24,true);
    if(rotMax<0||rotMax>20000||transMax<0||transMax>20000) continue;
    // rotMax/transMax should be close to rotP/transP or 0
    if(rotP>0 && rotMax>0 && Math.abs(rotMax-rotP)>1000) continue;
    if(transP>0 && transMax>0 && Math.abs(transMax-transP)>1000) continue;
    const rf=buf[off+28]; if(rf>3) continue;
    const ra=dv.getFloat32(off+29,true);
    if(!Number.isFinite(ra)) continue;
    if(Math.abs(ra)>7) continue; // rad up to ~2pi*1.5
    if(rotP>0 && Math.abs(ra)<0.01) continue; // rot without angle unlikely
    // score
    let score=0;
    if(off>300) score+=1;
    if(off<buf.length*0.95) score+=1;
    if(transY!==0) score+=1;
    if(ra!==0) score+=1;
    if(rotP>=100 && rotP<=12000) score+=2;
    if(transP>=100 && transP<=12000) score+=2;
    if(rotMax===rotP) score+=1;
    if(transMax===transP) score+=1;
    if(ver===2 || ver===3) score+=1;
    candidates.push({off,ver,rotP,transP,transY,axis,rotMax,transMax,rotFunc:rf,rotAng:ra,score});
  }
  if(!candidates.length) throw new Error('No mover found – might be static item');
  candidates.sort((a,b)=>b.score-a.score);
  // return best, but also ensure not in obvious non-mover region (first 500 bytes are chunks)
  const best=candidates.find(c=>c.off>400) || candidates[0];
  return best;
}

export function patchMover(decomp, off, mover){
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
}

export function buildBUUR(origBytes, bodyPtr, decomp){
  const header = origBytes.slice(0, bodyPtr);
  const out = new Uint8Array(header.length + 8 + decomp.length);
  out.set(header,0);
  const dv=new DataView(out.buffer);
  dv.setUint32(bodyPtr, decomp.length, true);
  dv.setUint32(bodyPtr+4, decomp.length, true);
  out.set(decomp, bodyPtr+8);
  if(out.length>7) out[7]=0x55;
  return out;
}
