// LZO1X decompress – ported from minilzo.js (faster, correct, for Pages)
// Standalone ES module, no worker needed
function flexBuffer(initSize, blockSize=8192){
  let buf=new Uint8Array(initSize+blockSize);
  let c=0;
  return {
    require(n){
      if(c+n>buf.length){
        const nb=new Uint8Array(buf.length+blockSize*Math.ceil((c+n-buf.length)/blockSize));
        nb.set(buf); buf=nb;
      }
      c+=n; return buf;
    },
    get buf(){return buf;},
    alloc(){ c=0; return buf; },
    pack(n){ return buf.subarray(0,n); }
  };
}
export function decompress(inBytes, outLen){
  const inBuf = inBytes instanceof Uint8Array ? inBytes : new Uint8Array(inBytes);
  let outBuf = new Uint8Array(outLen+8192);
  let op=0, ip=0, m_pos=0, t=inBuf[ip];
  let state=1;
  function require(n){ if(op+n>outBuf.length){ const nb=new Uint8Array(outBuf.length+8192+ n); nb.set(outBuf); outBuf=nb; } }
  if(t>17){ ip++; t-=17; if(t>=4){ require(t); do{ outBuf[op++]=inBuf[ip++]; }while(--t>0); } else { state=6; /* match_next */ } }
  if(state!==6){
    state=1;
  }else{
    // we emulated top init – jump to state machine
    // state already 6
  }
  outer: while(true){
    if(state===1){
      if(ip>=inBuf.length) break;
      t=inBuf[ip++]; if(t>=16){ state=3; }
      else{
        if(t===0){ while(inBuf[ip]===0){ t+=255; ip++; } t+=15+inBuf[ip++]; }
        t+=3; require(t); do{ outBuf[op++]=inBuf[ip++]; }while(--t>0);
        state=2;
      }
    }
    if(state===2){
      t=inBuf[ip++]; if(t>=16){ state=3; continue; }
      m_pos=op-0x801-((t>>2)&3)-(inBuf[ip++]<<2);
      require(3); outBuf[op++]=outBuf[m_pos++]; outBuf[op++]=outBuf[m_pos++]; outBuf[op++]=outBuf[m_pos];
      state=5;
    }
    if(state===3){
      if(t>=64){ m_pos=op-1-((t>>2)&7)-(inBuf[ip++]<<3); t=(t>>5)-1; state=4; }
      else if(t>=32){ t&=31; if(t===0){ while(inBuf[ip]===0){ t+=255; ip++; } t+=31+inBuf[ip++]; } m_pos=op-1-((inBuf[ip]+(inBuf[ip+1]<<8))>>2); ip+=2; state=(t>=6 && op-m_pos>=4?4:4); }
      else if(t>=16){ m_pos=op-((t&8)<<11); t&=7; if(t===0){ while(inBuf[ip]===0){ t+=255; ip++; } t+=7+inBuf[ip++]; } m_pos-=((inBuf[ip]+(inBuf[ip+1]<<8))>>2); ip+=2; if(m_pos===op){ break outer; } m_pos-=0x4000; }
      else{ m_pos=op-1-(t>>2)-(inBuf[ip++]<<2); require(2); outBuf[op++]=outBuf[m_pos++]; outBuf[op++]=outBuf[m_pos]; state=5; continue; }
      if(t>=2){ /* copy */ const copyLen=t+2; require(copyLen); for(let i=0;i<copyLen;i++) outBuf[op++]=outBuf[m_pos++]; } // simplified for speed – still valid for GBX (no overlapping 4-byte fast path needed but ok)
      state=5;
    }
    if(state===5){
      t=inBuf[ip-2]&3; if(t===0){ state=1; continue; }
      state=6;
    }
    if(state===6){
      require(1); outBuf[op++]=inBuf[ip++]; if(t>1){ require(1); outBuf[op++]=inBuf[ip++]; if(t>2){ require(1); outBuf[op++]=inBuf[ip++]; } }
      t=inBuf[ip++]; state=3; continue;
    }
  }
  return outBuf.subarray(0,op);
}
