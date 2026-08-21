// ir.js — ItemAnimIR v1 conversions (new + old KC)
import { readU32 } from './gbx.js';

export const IR_VERSION=1;

function axisNumToStr(n){ return n===0?"x": n===2?"z":"y"; }
function axisStrToNum(s){ return s==="x"?0: s==="z"?2:1; }

export function gbxToIR({fileName, classId, decomp, mover, moverOff}){
  const isOld = mover?.type==="old";
  const originalMover = mover ? {
    type: mover.type||"new",
    ver: mover.ver, sub: mover.sub,
    rotP: mover.rotP, transP: mover.transP, transY: mover.transY,
    axis: mover.axis, rotMax: mover.rotMax, transMax: mover.transMax,
    rotFunc: mover.rotFunc, rotAng: mover.rotAng,
    // old fields
    transAxis: mover.transAxis, transMin: mover.transMin, transMax: mover.transMax,
    rotAxis: mover.rotAxis, angleMin: mover.angleMin, angleMax: mover.angleMax,
    transDur: mover.transDur, rotDur: mover.rotDur,
    transMinOff: mover.transMinOff, transMaxOff: mover.transMaxOff,
    angleMinOff: mover.angleMinOff, angleMaxOff: mover.angleMaxOff,
    transDurOffs: mover.transDurOffs, rotDurOffs: mover.rotDurOffs,
    off: mover.off
  } : null;

  const anims=[];

  if(mover){
    if(isOld){
      const tAxisStr = axisNumToStr(mover.transAxis);
      const rAxisStr = axisNumToStr(mover.rotAxis);
      // translation if min!=max or if we have trans dur
      if(Math.abs(mover.transMax - mover.transMin) > 1e-6){
        anims.push({
          id: "move_1",
          target: "self",
          property: "translation",
          axis: tAxisStr,
          from: Number(mover.transMin.toFixed(4)),
          to: Number(mover.transMax.toFixed(4)),
          durationMs: mover.transDur||mover.transP||5000,
          delayMs: 0,
          easing: mover.transEase===0?"linear": mover.transEase===1?"easeInOut": "linear",
          loop: mover.transCnt===2 ? "pingPong" : "restart",
          description: `Slide ${tAxisStr} ${mover.transMin}→${mover.transMax}`
        });
      }
      if(Math.abs(mover.angleMax - mover.angleMin) > 1e-3){
        const fromRad = mover.angleMin * Math.PI/180;
        const toRad = mover.angleMax * Math.PI/180;
        anims.push({
          id: "spin_1",
          target: "self",
          property: "rotation",
          axis: rAxisStr,
          from: Number(fromRad.toFixed(4)),
          to: Number(toRad.toFixed(4)),
          durationMs: mover.rotDur||mover.rotP||6600,
          delayMs: 0,
          easing: mover.rotEase===0?"linear": mover.rotEase===1?"easeInOut":"linear",
          loop: "restart",
          description: `Spin ${rAxisStr} ${mover.angleMin}°→${mover.angleMax}°`
        });
      }
      // if both zero (should not happen) emit placeholder rot
      if(anims.length===0){
        anims.push({
          id: "spin_1",
          target:"self",
          property:"rotation",
          axis: rAxisStr||"y",
          from: 0,
          to: Number((360*Math.PI/180).toFixed(4)),
          durationMs: mover.rotDur||6600,
          delayMs:0,
          easing:"linear",
          loop:"restart",
          description:"Full spin (fallback)"
        });
      }
    } else {
      // new format
      if(mover.transP>0 && Math.abs(mover.transY)>1e-6){
        anims.push({
          id: "float_1",
          target: "self",
          property: "translation",
          axis: "y",
          from: 0,
          to: Number(mover.transY.toFixed(4)),
          durationMs: mover.transP,
          delayMs: 0,
          easing: mover.rotFunc===1?"easeInOut": mover.rotFunc===2?"spring":"easeInOut",
          loop: "pingPong",
          description: "Up/down float"
        });
      }
      if(mover.rotP>0 && Math.abs(mover.rotAng)>1e-6){
        const axisStr = axisNumToStr(mover.axis);
        anims.push({
          id: "spin_1",
          target: "self",
          property: "rotation",
          axis: axisStr,
          from: 0,
          to: Number(mover.rotAng.toFixed(4)),
          durationMs: mover.rotP,
          delayMs: 0,
          easing: mover.rotFunc===0?"linear": mover.rotFunc===1?"easeInOut":"linear",
          loop: "restart",
          description: "Y-axis spin"
        });
      }
      if(anims.length===0){
        if(mover.transP>0) anims.push({id:"float_1",target:"self",property:"translation",axis:"y",from:0,to:mover.transY||1,durationMs:mover.transP,delayMs:0,easing:"easeInOut",loop:"pingPong",description:"Float"});
        if(mover.rotP>0) anims.push({id:"spin_1",target:"self",property:"rotation",axis:axisNumToStr(mover.axis),from:0,to:mover.rotAng||1.57,durationMs:mover.rotP,delayMs:0,easing:"linear",loop:"restart",description:"Spin"});
      }
    }
  }

  return {
    irVersion: IR_VERSION,
    source: {
      fileName: fileName||"unknown.Item.Gbx",
      classId: classId?`0x${classId.toString(16).padStart(8,"0")}`:null,
      decompressedSize: decomp?.length||0,
      moverOffset: moverOff??-1,
      moverType: mover?.type||null,
      originalMover
    },
    animations: anims,
    composition: { mode: "parallel", note: "parallel = Promise.all, sequence = chain with delays like Web Animations API" },
    baking: { strategy: "maxDuration", notes: "Game only has 1 loop. We bake animations into RotPeriod/TransPeriod/TransY/RotAngle by taking max duration per property" }
  };
}

export function irToMover(ir, baseMover=null){
  const anims = ir.animations||[];
  const isOld = baseMover?.type==="old" || ir.source?.moverType==="old";

  if(isOld && baseMover){
    // update old mover from IR
    const tAnims = anims.filter(a=>a.property==="translation");
    const rAnims = anims.filter(a=>a.property==="rotation");
    const out = {...baseMover};
    if(tAnims.length){
      const a=tAnims[0];
      // IR from/to are in world units (same as old min/max)
      out.transMin = a.from;
      out.transMax = a.to;
      out.transP = Math.round(a.durationMs||out.transDur||5000);
      out.transDur = out.transP;
      out.transAxis = axisStrToNum(a.axis||"x");
    }
    if(rAnims.length){
      const a=rAnims[0];
      // IR from/to are in radians, old is degrees
      out.angleMin = (a.from||0)*180/Math.PI;
      out.angleMax = (a.to||0)*180/Math.PI;
      out.rotP = Math.round(a.durationMs||out.rotDur||6600);
      out.rotDur = out.rotP;
      out.rotAxis = axisStrToNum(a.axis||"y");
    }
    return out;
  }

  // new format fallback
  const tAnims = anims.filter(a=>a.property==="translation");
  const rAnims = anims.filter(a=>a.property==="rotation");
  const tP = tAnims.length ? Math.max(...tAnims.map(a=> (a.durationMs||0)+(a.delayMs||0)),0) : 0;
  const rP = rAnims.length ? Math.max(...rAnims.map(a=> (a.durationMs||0)+(a.delayMs||0)),0) : 0;
  const tY = tAnims.length ? Math.max(...tAnims.map(a=> Math.abs((a.to??0)-(a.from??0))),0) : 0;
  const rA = rAnims.length ? ((rAnims[0].to??0)-(rAnims[0].from??0)) : 0;
  const axisStr = rAnims.length ? (rAnims[0].axis||"y") : "y";
  const axis = axisStrToNum(axisStr);
  const easing = rAnims.length ? rAnims[0].easing : tAnims[0]?.easing;
  const rotFunc = easing==="linear"?0 : easing==="easeInOut"?1 : easing==="spring"?2 : easing==="bounce"?3 : 0;
  const base = baseMover?.type==="new" ? baseMover : {};
  return {
    type:"new",
    ver: base.ver??2,
    rotP: Math.round(rP)||base.rotP||0,
    transP: Math.round(tP)||base.transP||0,
    transY: tY||base.transY||0,
    axis,
    rotMax: Math.round(rP)||base.rotMax||0,
    transMax: Math.round(tP)||base.transMax||0,
    rotFunc,
    rotAng: rA||base.rotAng||0,
    off: base.off??-1
  };
}

export function createEmptyIR(fileName="empty.Item.Gbx"){
  return {
    irVersion:1,
    source:{fileName,classId:null,decompressedSize:0,moverOffset:-1,originalMover:null},
    animations:[],
    composition:{mode:"parallel"},
    baking:{strategy:"maxDuration"}
  };
}
