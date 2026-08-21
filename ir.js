// ir.js — ItemAnimIR v1 conversions
import { readU32 } from './gbx.js';

export const IR_VERSION=1;

export function gbxToIR({fileName, classId, decomp, mover, moverOff}){
  const originalMover = mover ? {
    ver: mover.ver, rotP: mover.rotP, transP: mover.transP, transY: mover.transY,
    axis: mover.axis, rotMax: mover.rotMax, transMax: mover.transMax,
    rotFunc: mover.rotFunc, rotAng: mover.rotAng
  } : null;

  const anims=[];
  if(mover){
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
      const axisStr = mover.axis===0?"x": mover.axis===2?"z":"y";
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
    // If mover exists but no transY and no rotAng, still emit placeholder to keep export working
    if(anims.length===0){
      if(mover.transP>0) anims.push({id:"float_1",target:"self",property:"translation",axis:"y",from:0,to:mover.transY||1,durationMs:mover.transP,delayMs:0,easing:"easeInOut",loop:"pingPong",description:"Float"});
      if(mover.rotP>0) anims.push({id:"spin_1",target:"self",property:"rotation",axis:mover.axis===0?"x":mover.axis===2?"z":"y",from:0,to:mover.rotAng||1.57,durationMs:mover.rotP,delayMs:0,easing:"linear",loop:"restart",description:"Spin"});
    }
  }

  return {
    irVersion: IR_VERSION,
    source: {
      fileName: fileName||"unknown.Item.Gbx",
      classId: classId?`0x${classId.toString(16).padStart(8,"0")}`:null,
      decompressedSize: decomp?.length||0,
      moverOffset: moverOff??-1,
      originalMover
    },
    animations: anims,
    composition: { mode: "parallel", note: "parallel = Promise.all, sequence = chain with delays like Web Animations API" },
    baking: { strategy: "maxDuration", notes: "Game only has 1 loop. We bake animations into RotPeriod/TransPeriod/TransY/RotAngle by taking max duration per property" }
  };
}

export function irToMover(ir){
  const anims = ir.animations||[];
  const tAnims = anims.filter(a=>a.property==="translation");
  const rAnims = anims.filter(a=>a.property==="rotation");
  const tP = tAnims.length ? Math.max(...tAnims.map(a=> (a.durationMs||0)+(a.delayMs||0)),0) : 0;
  const rP = rAnims.length ? Math.max(...rAnims.map(a=> (a.durationMs||0)+(a.delayMs||0)),0) : 0;
  const tY = tAnims.length ? Math.max(...tAnims.map(a=> Math.abs((a.to??0)-(a.from??0))),0) : 0;
  const rA = rAnims.length ? ((rAnims[0].to??0)-(rAnims[0].from??0)) : 0;
  const axisStr = rAnims.length ? (rAnims[0].axis||"y") : "y";
  const axis = axisStr==="x"?0: axisStr==="z"?2:1;
  const easing = rAnims.length ? rAnims[0].easing : tAnims[0]?.easing;
  const rotFunc = easing==="linear"?0 : easing==="easeInOut"?1 : easing==="spring"?2 : easing==="bounce"?3 : 0;
  return {
    ver: 2,
    rotP: Math.round(rP)||0,
    transP: Math.round(tP)||0,
    transY: tY,
    axis,
    rotMax: Math.round(rP)||0,
    transMax: Math.round(tP)||0,
    rotFunc,
    rotAng: rA
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
