// validator.js — IR validation, LLM-friendly errors
const ALLOWED_EASING=["linear","easeInOut","easeIn","easeOut","spring","bounce"];
const ALLOWED_AXIS=["x","y","z"];
const ALLOWED_PROP=["translation","rotation"];
const ALLOWED_LOOP=["restart","pingPong"];
const ALLOWED_MODE=["parallel","sequence"];

export function validateIR(ir){
  const errors=[], warnings=[];
  if(!ir || typeof ir!=="object"){ return {ok:false, errors:["IR is not an object"], warnings}; }
  if(ir.irVersion!==1) errors.push(`irVersion must be 1, got ${ir.irVersion}`);
  if(!ir.source) warnings.push("source missing – export will need original GBX to find mover offset");
  else{
    if(typeof ir.source.moverOffset!=="number" && ir.source.moverOffset!==-1) warnings.push("source.moverOffset should be number");
  }
  if(!Array.isArray(ir.animations)) errors.push("animations must be an array");
  else{
    if(ir.animations.length===0) warnings.push("animations empty – item will be static");
    if(ir.animations.length>8) warnings.push("more than 8 animations – will be baked to 1 mover, may lose detail");
    ir.animations.forEach((a,i)=>{
      const pre=`animations[${i}]`;
      if(!a.id) warnings.push(`${pre} missing id – will auto-generate`);
      if(!ALLOWED_PROP.includes(a.property)) errors.push(`${pre}.property must be ${ALLOWED_PROP.join("|")}, got ${a.property}`);
      if(!ALLOWED_AXIS.includes(a.axis)) errors.push(`${pre}.axis must be ${ALLOWED_AXIS.join("|")}, got ${a.axis}`);
      if(typeof a.from!=="number"||typeof a.to!=="number") errors.push(`${pre}.from/to must be numbers`);
      if(typeof a.durationMs!=="number"||a.durationMs<50||a.durationMs>30000) errors.push(`${pre}.durationMs must be 50..30000, got ${a.durationMs}`);
      if(a.delayMs!=null && (typeof a.delayMs!=="number"||a.delayMs<0||a.delayMs>20000)) errors.push(`${pre}.delayMs must be 0..20000`);
      if(!ALLOWED_EASING.includes(a.easing)) errors.push(`${pre}.easing must be ${ALLOWED_EASING.join("|")}, got ${a.easing}`);
      if(a.loop && !ALLOWED_LOOP.includes(a.loop)) warnings.push(`${pre}.loop should be ${ALLOWED_LOOP.join("|")}`);
      if(a.property==="translation" && !ALLOWED_AXIS.includes(a.axis)) errors.push(`${pre} translation axis invalid`);
      // old format (KC) can translate X/Y/Z, new format only Y – allow all, baking will handle
    });
  }
  if(ir.composition){
    if(!ALLOWED_MODE.includes(ir.composition.mode)) errors.push(`composition.mode must be ${ALLOWED_MODE.join("|")}`);
  }else warnings.push("composition missing – defaulting to parallel");
  // semantic: periods zero?
  const hasTrans = ir.animations?.some(a=>a.property==="translation");
  const hasRot = ir.animations?.some(a=>a.property==="rotation");
  if(!hasTrans && !hasRot && ir.animations?.length>0) warnings.push("no translation/rotation recognized");
  return {ok: errors.length===0, errors, warnings};
}
