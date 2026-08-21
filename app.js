// app.js — main wiring for Item Move Studio
import { decompress } from './lzo.js';
import { parseGBX, findMover, patchMover, buildBUUR } from './gbx.js';
import { gbxToIR, irToMover } from './ir.js';
import { validateIR } from './validator.js';
import { sampleIR } from './preview.js';
import { parseMesh, createThreeGeometry } from './mesh.js';
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const $=id=>document.getElementById(id);
let origBytes=null, bodyPtr=0, decomp=null, moverOff=-1, baseMover=null, fileName="", classId=0;
let irObj=null;
let itemRoot=null, mixer=false, clock=new THREE.Clock();

// Three setup
const canvas=$('three');
const renderer=new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(window.devicePixelRatio);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(3.2,2.2,3.2);
scene.add(new THREE.AmbientLight(0xffffff,0.9));
const dir=new THREE.DirectionalLight(0xffffff,1.2); dir.position.set(5,8,4); scene.add(dir);
const grid=new THREE.GridHelper(8,16,0x2a4060,0x1a2d4d); grid.position.y=-1.2; scene.add(grid);
const controls=new OrbitControls(camera, renderer.domElement); controls.enableDamping=true; controls.target.set(0,0,0);
itemRoot=new THREE.Group(); scene.add(itemRoot);

function resize(){
  const r=canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize); resize();

function setStatus(t){ $('status').textContent=t; console.log(t); }
function setMeta(t){ $('meta').textContent=t; }

function clearItem(){
  while(itemRoot.children.length) itemRoot.remove(itemRoot.children[0]);
}

function showProxy(reason){
  clearItem();
  const geom=new THREE.IcosahedronGeometry(0.8,1);
  const mat=new THREE.MeshStandardMaterial({color:0x8ab4ff, wireframe:false, metalness:0.1, roughness:0.5});
  const m=new THREE.Mesh(geom, mat); itemRoot.add(m);
  setMeta((fileName||"")+" – proxy: "+reason);
}

function showMesh(geoms){
  clearItem();
  let has=false;
  for(const desc of geoms){
    try{
      const geom=createThreeGeometry(THREE, desc);
      const mat=new THREE.MeshStandardMaterial({color:0xdddddd, metalness:0.1, roughness:0.7});
      const mesh=new THREE.Mesh(geom, mat);
      itemRoot.add(mesh);
      has=true;
    }catch(e){ console.warn("geom fail",e); }
  }
  if(!has) showProxy("mesh build failed");
  else{
    // frame
    const box=new THREE.Box3().setFromObject(itemRoot);
    const sz=box.getSize(new THREE.Vector3());
    const ctr=box.getCenter(new THREE.Vector3());
    controls.target.copy(ctr);
    const maxDim=Math.max(sz.x,sz.y,sz.z,1);
    camera.position.set(ctr.x+maxDim*1.8, ctr.y+maxDim*1.2, ctr.z+maxDim*1.8);
    camera.lookAt(ctr);
    controls.update();
  }
}

function renderIR(){
  if(!irObj) return;
  $('irInput').value=JSON.stringify(irObj,null,2);
  renderTimeline();
}

function renderTimeline(){
  const tl=$('timeline'); if(!irObj||!irObj.animations.length){ tl.innerHTML='<div class="mini">No animations – add or load GBX</div>'; return; }
  tl.innerHTML='';
  const mode=irObj.composition?.mode||"parallel";
  let cursor=0;
  irObj.animations.forEach(tr=>{
    const div=document.createElement('div');
    div.className='block '+(tr.property==='translation'?'t':'r');
    const w=Math.max(60, (tr.durationMs||1000)/40);
    div.style.minWidth=w+'px';
    div.innerHTML=`<div>${tr.property==='translation'?'↕':'🔄'} ${tr.from}→${tr.to}</div><div style="opacity:.7">${tr.durationMs}ms ${tr.axis}</div>`;
    tl.appendChild(div);
    if(mode==='sequence') cursor+= (tr.durationMs||0)+(tr.delayMs||0);
  });
}

// File load
const fileInput=$('file'), drop=$('drop');
drop.addEventListener('click',()=>fileInput.click());
drop.addEventListener('dragover',e=>{e.preventDefault(); drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{e.preventDefault(); drop.classList.remove('drag'); const f=e.dataTransfer.files[0]; if(f) loadFile(f);});
fileInput.addEventListener('change',e=>{ const f=e.target.files[0]; if(f){ loadFile(f);} e.target.value=''; });

async function loadFile(f){
  fileName=f.name; setStatus('Reading '+f.name+'…');
  const ab=await f.arrayBuffer(); origBytes=new Uint8Array(ab);
  try{
    const p=parseGBX(origBytes);
    bodyPtr=p.bPtr; classId=p.classId;
    setStatus('Decompressing…'); await new Promise(r=>setTimeout(r,10));
    const comp=origBytes.slice(p.cStart,p.cEnd);
    const out=decompress(comp,p.uncomp);
    decomp=out;
    setStatus('Scanning…');
    let mover=null;
    try{ mover=findMover(out); moverOff=mover.off; baseMover=mover; }catch(e){ moverOff=-1; baseMover=null; console.warn(e); }
    // mesh
    const meshRes=parseMesh(out);
    if(meshRes.geometries.length) { showMesh(meshRes.geometries); $('meshInfo').textContent=meshRes.reason; }
    else { showProxy(meshRes.reason); $('meshInfo').textContent=meshRes.reason; }

    irObj=gbxToIR({fileName, classId, decomp:out, mover, moverOff});
    renderIR();
    $('irCard').style.display='block';
    $('previewCard').style.display='block';
    $('exportCard').style.display='block';
    $('foundPill').textContent = mover? (mover.type==="old"?`KC @${mover.off} Trans ${mover.transMin}→${mover.transMax} X Rot ${mover.angleMin}→${mover.angleMax}°`:`mover @${moverOff} RotP ${mover.rotP} TransP ${mover.transP}`) :'no mover – static';
    setStatus('Ready – edit IR or paste from AI, then Check');
    setMeta(`${f.name} ${ab.byteLength} → decomp ${out.length}`);
  }catch(e){ setStatus('Error: '+e.message); console.error(e); }
}

// Check button
$('checkBtn').addEventListener('click',()=>{
  try{
    const txt=$('irInput').value;
    const obj=JSON.parse(txt);
    irObj=obj;
    const v=validateIR(obj);
    const box=$('validateBox');
    box.innerHTML='';
    if(v.ok) box.innerHTML+=`<div style="color:#7ee787">✓ Valid – ${obj.animations.length} anims</div>`;
    else box.innerHTML+=`<div style="color:#ff8a8a">✗ Invalid</div><ul>${v.errors.map(e=>`<li>${e}</li>`).join('')}</ul>`;
    if(v.warnings.length) box.innerHTML+=`<div class="mini" style="margin-top:6px">Warnings:<ul>${v.warnings.map(w=>`<li>${w}</li>`).join('')}</ul></div>`;
    if(v.ok){
      renderTimeline();
      // restart clock
      clock=new THREE.Clock();
      $('exportBtn').disabled=false;
    }else{
      $('exportBtn').disabled=true;
    }
  }catch(e){
    $('validateBox').innerHTML=`<div style="color:#ff8a8a">JSON parse error: ${e.message}</div>`;
  }
});

$('copyIR').addEventListener('click',()=>{
  navigator.clipboard.writeText($('irInput').value);
  $('copyIR').textContent='Copied!';
  setTimeout(()=>$('copyIR').textContent='📋 Copy IR',1000);
});

// Export
$('exportBtn').addEventListener('click',()=>{
  if(!irObj||!decomp||!origBytes){ alert('Load a GBX first'); return; }
  try{
    const mover=irToMover(irObj, baseMover);
    // patch copy of decomp
    const out=new Uint8Array(decomp);
    if(moverOff>=0 || mover.type==="old"){
      if(mover.type==="old"){
        // old needs full mover with offs, patchMover uses mover itself
        patchMover(out, mover.off, mover);
      } else {
        patchMover(out, moverOff, mover);
      }
    }
    else{
      // if no mover originally, we can't inject safely – warn
      alert('This item had no mover originally – cannot inject new mover safely in v1. Add a mover manually in game then reload.');
      return;
    }
    const buur=buildBUUR(origBytes, bodyPtr, out);
    const blob=new Blob([buur],{type:'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=fileName.replace(/\.Gbx$/i,'')+'_mod.Item.Gbx'; a.click();
    URL.revokeObjectURL(url);
    $('bakeLog').textContent=`Exported ${mover.type==="old"?`Trans ${mover.transMin?.toFixed(1)}→${mover.transMax?.toFixed(1)} Rot ${mover.angleMin?.toFixed(0)}→${mover.angleMax?.toFixed(0)}`:`RotP ${mover.rotP} TransP ${mover.transP} TransY ${mover.transY.toFixed(2)} RotA ${mover.rotAng.toFixed(2)}`}`;
  }catch(e){ alert('Export failed: '+e.message); console.error(e); }
});

// Presets -> emit IR snippet
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{
  const k=b.dataset.preset;
  let anims=[];
  if(k==='float') anims=[{id:"float_1",target:"self",property:"translation",axis:"y",from:0,to:2,durationMs:2500,delayMs:0,easing:"easeInOut",loop:"pingPong",description:"Gentle float"}];
  else if(k==='spin') anims=[{id:"spin_1",target:"self",property:"rotation",axis:"y",from:0,to:3.14,durationMs:3000,delayMs:0,easing:"linear",loop:"restart",description:"Spin"}];
  else if(k==='both') anims=[
    {id:"float_1",target:"self",property:"translation",axis:"y",from:0,to:1.4,durationMs:3200,delayMs:0,easing:"easeInOut",loop:"pingPong",description:"Float"},
    {id:"spin_1",target:"self",property:"rotation",axis:"y",from:0,to:1.57,durationMs:5000,delayMs:0,easing:"linear",loop:"restart",description:"Spin"}
  ];
  else if(k==='pendulum') anims=[{id:"spin_1",target:"self",property:"rotation",axis:"z",from:-0.6,to:0.6,durationMs:1800,delayMs:0,easing:"spring",loop:"pingPong",description:"Pendulum"}];
  if(!irObj) irObj={irVersion:1,source:{fileName:fileName||"preset",moverOffset:moverOff,originalMover:baseMover},animations:anims,composition:{mode:"parallel"},baking:{strategy:"maxDuration"}};
  else { irObj.animations=anims; }
  renderIR();
  $('checkBtn').click();
}));

// Animation loop
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  if(irObj){
    const t=clock.getElapsedTime()*1000;
    const s=sampleIR(irObj,t);
    if(itemRoot){
      // new: use vec if available, fallback to legacy single axis
      if(s.trans){
        itemRoot.position.x=s.trans.x||0;
        itemRoot.position.y=s.trans.y||0;
        itemRoot.position.z=s.trans.z||0;
      }else{
        itemRoot.position.y=s.transY||0;
      }
      if(s.rotVec){
        itemRoot.rotation.x=s.rotVec.x||0;
        itemRoot.rotation.y=s.rotVec.y||0;
        itemRoot.rotation.z=s.rotVec.z||0;
      }else{
        itemRoot.rotation.x=0; itemRoot.rotation.y=0; itemRoot.rotation.z=0;
        if(s.axis==='x') itemRoot.rotation.x=s.rot;
        else if(s.axis==='z') itemRoot.rotation.z=s.rot;
        else itemRoot.rotation.y=s.rot;
      }
    }
  }
  renderer.render(scene,camera);
}
animate();

// Help modal
const helpBtn=$('helpBtn'), helpModal=$('helpModal'), closeHelp=$('closeHelp');
helpBtn?.addEventListener('click',()=>helpModal.style.display='flex');
closeHelp?.addEventListener('click',()=>helpModal.style.display='none');
helpModal?.addEventListener('click',e=>{ if(e.target===helpModal) helpModal.style.display='none'; });
