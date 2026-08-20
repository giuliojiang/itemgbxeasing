// Fast LZO1X decompress – correct port of minilzo (fengdh) for GBX
// Exports: decompress(input Uint8Array, outLen number) -> Uint8Array

function createFlex(initSize, blockSize=8192){
  let buf = new Uint8Array(initSize + blockSize);
  let c = 0;
  return {
    require(n){
      if(c + n > buf.length){
        const grow = blockSize * Math.ceil((c+n - buf.length)/blockSize);
        const nb = new Uint8Array(buf.length + grow);
        nb.set(buf);
        buf = nb;
      }
      c += n;
      return buf;
    },
    pack(n){ return buf.subarray(0,n); },
    get buffer(){ return buf; }
  };
}

export function decompress(input, outLen){
  const inBuf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = createFlex(outLen || inBuf.length*3);
  let op=0, ip=0, m_pos=0, t=inBuf[0]||0;
  let state=1; // 1=top_loop,2=first_lit,3=match,4=copy,5=done,6=next

  if(t>17){
    ip=1;
    t-=17;
    if(t<4){
      state=6;
    }else{
      let b=out.require(t); for(let i=0;i<t;i++) b[op++]=inBuf[ip++];
      state=2;
    }
  }else{
    // t<=17 means no first lit, will enter top_loop
  }

  outer: while(true){
    if(state===1){
      if(ip>=inBuf.length) break;
      t=inBuf[ip++];
      if(t>=16){ state=3; }
      else{
        if(t===0){
          while(ip<inBuf.length && inBuf[ip]===0){ t+=255; ip++; }
          if(ip<inBuf.length) t+=15+inBuf[ip++];
        }
        t+=3;
        let b=out.require(t);
        for(let i=0;i<t;i++) b[op++]=inBuf[ip++];
        state=2;
      }
    }
    if(state===2){
      if(ip>=inBuf.length) break;
      t=inBuf[ip++];
      if(t>=16){ state=3; continue; }
      m_pos = op - 0x801 - (t>>2) - (inBuf[ip++]<<2);
      let b=out.require(3);
      const ob=b; // same underlying
      b[op++]=ob[m_pos++]; b[op++]=ob[m_pos++]; b[op++]=ob[m_pos];
      state=5;
    }
    if(state===3){
      if(t>=64){
        m_pos = op - 1 - ((t>>2)&7) - (inBuf[ip++]<<3);
        t=(t>>5)-1;
        state=4;
      }else if(t>=32){
        t&=31;
        if(t===0){
          while(inBuf[ip]===0){ t+=255; ip++; }
          t+=31+inBuf[ip++];
        }
        m_pos = op - 1 - ((inBuf[ip] | (inBuf[ip+1]<<8))>>2);
        ip+=2;
        // fall to copy
      }else if(t>=16){
        m_pos = op - ((t&8)<<11);
        t&=7;
        if(t===0){
          while(inBuf[ip]===0){ t+=255; ip++; }
          t+=7+inBuf[ip++];
        }
        m_pos -= ((inBuf[ip] | (inBuf[ip+1]<<8))>>2);
        ip+=2;
        if(m_pos===op){ break outer; }
        m_pos -= 0x4000;
      }else{
        m_pos = op - 1 - (t>>2) - (inBuf[ip++]<<2);
        let b=out.require(2);
        b[op++]=b[m_pos++]; b[op++]=b[m_pos];
        state=5; continue;
      }
      // t was match len-2 handling with fast path
      let need = t+2;
      if(t>=6 && op - m_pos >=4){
        // fast 4-byte copies still safe via loop (overlapping)
        let b=out.require(need);
        for(let i=0;i<need;i++) b[op++]=b[m_pos++];
      }else{
        state=4; continue;
      }
      state=5;
    }
    if(state===4){
      let need=t+2;
      let b=out.require(need);
      for(let i=0;i<need;i++) b[op++]=b[m_pos++];
      state=5;
    }
    if(state===5){
      t = inBuf[ip-2] & 3;
      if(t===0){ state=1; continue; }
      state=6;
    }
    if(state===6){
      let b=out.require(1); b[op++]=inBuf[ip++];
      if(t>1){
        b=out.require(1); b[op++]=inBuf[ip++];
        if(t>2){ b=out.require(1); b[op++]=inBuf[ip++]; }
      }
      if(ip>=inBuf.length) break;
      t=inBuf[ip++];
      state=3; continue;
    }
  }
  return out.pack(op);
}
