// preview.js — sample IR to transform, Three.js helpers (supports old KC X moves)
export function easeFn(t, e){
  if(e==="linear") return t;
  if(e==="easeInOut") return 0.5*(1-Math.cos(Math.PI*t));
  if(e==="easeIn") return t*t;
  if(e==="easeOut") return 1-(1-t)*(1-t);
  if(e==="spring") return 1-Math.cos(t*Math.PI*2.5)*Math.exp(-3*t);
  if(e==="bounce"){
    if(t<0.5) return easeFn(t*2,"easeOut")*0.5;
    return 0.5+ easeFn((t-0.5)*2,"easeOut")*0.5;
  }
  return t;
}

export function sampleTrack(tr, time){
  const dur=tr.dur||tr.durationMs||1000;
  const delay=tr.delay||tr.delayMs||0;
  const from=tr.from??0;
  const to=tr.to??1;
  const ease=tr.ease||tr.easing||"linear";
  const loop=tr.loop||"restart";
  if(time<delay) return from;
  let t = (time-delay) % (loop==="pingPong" || loop==="ping-pong" ? dur*2 : dur);
  let prog;
  if(loop==="pingPong" || loop==="ping-pong"){
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
  let trans={x:0,y:0,z:0}, rot={x:0,y:0,z:0}, hasTrans=false, hasRot=false;
  let lastAxis="y";
  if(mode==="parallel"){
    for(const a of anims){
      const tr={from:a.from,to:a.to,dur:a.durationMs,delay:a.delayMs,ease:a.easing,loop:a.loop};
      const v=sampleTrack(tr,timeMs);
      if(a.property==="translation"){
        hasTrans=true;
        if(a.axis==="x") trans.x+=v;
        else if(a.axis==="z") trans.z+=v;
        else trans.y+=v;
      } else if(a.property==="rotation"){
        hasRot=true;
        lastAxis=a.axis||"y";
        if(a.axis==="x") rot.x+=v;
        else if(a.axis==="z") rot.z+=v;
        else rot.y+=v;
      }
    }
  }else{ // sequence
    let cursor=0;
    for(const a of anims){
      const start=cursor;
      const end=cursor + (a.durationMs||0) + (a.delayMs||0);
      if(timeMs>=start && timeMs<end){
        const tr={from:a.from,to:a.to,dur:a.durationMs,delay:a.delayMs,ease:a.easing,loop:"restart"};
        const v=sampleTrack(tr, timeMs-start);
        if(a.property==="translation"){
          hasTrans=true;
          if(a.axis==="x") trans.x=v;
          else if(a.axis==="z") trans.z=v;
          else trans.y=v;
        } else { hasRot=true; lastAxis=a.axis; if(a.axis==="x") rot.x=v; else if(a.axis==="z") rot.z=v; else rot.y=v; }
        break;
      }
      if(timeMs>=end){
        if(a.property==="translation"){
          if(a.axis==="x") trans.x=a.to;
          else if(a.axis==="z") trans.z=a.to;
          else trans.y=a.to;
        } else { rot[a.axis||"y"]=a.to; lastAxis=a.axis; }
      }
      cursor=end;
    }
  }
  // legacy single values for old app.js compat
  const transY = trans.y + trans.x + trans.z; // for simple Y mover fallback
  const rotSingle = rot.y || rot.x || rot.z;
  return {transY, rot: rotSingle, axis: lastAxis, trans, rotVec: rot, hasTrans, hasRot};
}
