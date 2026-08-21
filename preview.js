// preview.js — sample IR to transform, Three.js helpers
export function easeFn(t, e){
  if(e==="linear") return t;
  if(e==="easeInOut") return 0.5*(1-Math.cos(Math.PI*t));
  if(e==="easeIn") return t*t;
  if(e==="easeOut") return 1-(1-t)*(1-t);
  if(e==="spring") return 1-Math.cos(t*Math.PI*2.5)*Math.exp(-3*t);
  if(e==="bounce"){ // simple bounce
    if(t<0.5) return easeFn(t*2,"easeOut")*0.5;
    return 0.5+ easeFn((t-0.5)*2,"easeOut")*0.5;
  }
  return t;
}

export function sampleTrack(tr, time){
  // time is global ms
  const dur=tr.dur||tr.durationMs||1000;
  const delay=tr.delay||tr.delayMs||0;
  const from=tr.from??0;
  const to=tr.to??1;
  const ease=tr.ease||tr.easing||"linear";
  const loop=tr.loop||"restart";
  if(time<delay) return from;
  let t = (time-delay) % (loop==="pingPong" ? dur*2 : dur);
  let prog;
  if(loop==="pingPong"){
    if(t>dur) prog = 2 - t/dur;
    else prog = t/dur;
  }else{
    prog = t/dur;
  }
  const eased = easeFn(prog, ease);
  return from + (to-from)*eased;
}

export function sampleIR(ir, timeMs){
  const mode = ir.composition?.mode || "parallel";
  const anims = ir.animations||[];
  let transY=0, rot=0, axis="y";
  if(mode==="parallel"){
    for(const a of anims){
      const tr={from:a.from,to:a.to,dur:a.durationMs,delay:a.delayMs,ease:a.easing,loop:a.loop};
      const v=sampleTrack(tr,timeMs);
      if(a.property==="translation") transY+=v;
      else if(a.property==="rotation"){ rot+=v; axis=a.axis; }
    }
  }else{ // sequence
    let cursor=0;
    for(const a of anims){
      const start=cursor;
      const end=cursor + (a.durationMs||0) + (a.delayMs||0);
      if(timeMs>=start && timeMs<end){
        const tr={from:a.from,to:a.to,dur:a.durationMs,delay:a.delayMs,ease:a.easing,loop:"restart"};
        const v=sampleTrack(tr, timeMs-start);
        if(a.property==="translation") transY=v;
        else { rot=v; axis=a.axis; }
        break;
      }
      if(timeMs>=end){
        // hold final value for sequence?
        if(a.property==="translation") transY=a.to;
        else { rot=a.to; axis=a.axis; }
      }
      cursor=end;
    }
  }
  return {transY, rot, axis};
}
