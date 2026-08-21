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
  const parent=canvas.parentElement;
  if(!parent) return;
  const r=parent.getBoundingClientRect();
  if(r.width<10||r.height<10) return; // hidden or not laid out yet
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
  const mat=new THREE.MeshBasicMaterial({color:0x8ab4ff, wireframe:false});
  const m=new THREE.Mesh(geom, mat); itemRoot.add(m);
  // frame to proxy
  const box=new THREE.Box3().setFromObject(itemRoot);
  if(!box.isEmpty()){
    const ctr=box.getCenter(new THREE.Vector3());
    const sz=box.getSize(new THREE.Vector3());
    const maxDim=Math.max(sz.x,sz.y,sz.z,1);
    controls.target.copy(ctr);
    camera.position.set(ctr.x+maxDim*1.8, ctr.y+maxDim*1.2, ctr.z+maxDim*1.8);
    camera.lookAt(ctr);
    controls.update();
  }else{
    controls.target.set(0,0,0);
    camera.position.set(3,2,3);
    camera.lookAt(0,0,0);
    controls.update();
  }
  setMeta((fileName||"")+" – proxy: "+reason);
  // ensure visible
  setTimeout(()=>{ resize(); }, 50);
}

function showMesh(geoms){
  clearItem();
  let has=false;
  for(const desc of geoms){
    try{
      const geom=createThreeGeometry(THREE, desc);
      let mesh;
      if(desc.indices && desc.indices.length>=30){
        const mat=new THREE.MeshStandardMaterial({color:0xdddddd, metalness:0.1, roughness:0.7, side:THREE.DoubleSide});
        mesh=new THREE.Mesh(geom, mat);
      }else{
        // points
        const mat=new THREE.PointsMaterial({color:0xdddddd, size:0.04});
        mesh=new THREE.Points(geom, mat);
      }
      itemRoot.add(mesh);
      has=true;
    }catch(e){ console.warn("geom fail",e); }
  }
  if(!has){ showProxy("mesh build failed"); return; }
  // frame – robust
  const box=new THREE.Box3().setFromObject(itemRoot);
  if(box.isEmpty() || !Number.isFinite(box.min.x)){
    controls.target.set(0,0,0);
    camera.position.set(3,2,3);
    camera.lookAt(0,0,0);
    controls.update();
    return;
  }
  const sz=box.getSize(new THREE.Vector3());
  const ctr=box.getCenter(new THREE.Vector3());
  const maxDim=Math.max(sz.x,sz.y,sz.z,0.5);
  if(maxDim>100 || maxDim<0.01){
    // fallback – object too big/small, don't use its box
    controls.target.set(0,0,0);
    camera.position.set(3,2,3);
    camera.lookAt(0,0,0);
  }else{
    controls.target.copy(ctr);
    camera.position.set(ctr.x+maxDim*1.8, ctr.y+maxDim*1.2, ctr.z+maxDim*1.8);
    camera.lookAt(ctr);
  }
  controls.update();
  setTimeout(()=>{ resize(); }, 50);
}

function renderIR(){
  if(!irObj) return;
  $('irInput').value=JSON.stringify(irObj,null,2);
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
    // mesh – robust to both old and new parseMesh shapes
    let meshRes=null;
    try{ meshRes=parseMesh(out); }catch(e){ console.warn("parseMesh threw",e); meshRes=null; }
    let geoms=[];
    let reason="no mesh";
    if(meshRes){
      if(Array.isArray(meshRes)){
        geoms=meshRes;
        reason = geoms[0]?.method ? `verts ${geoms[0].vertCount} ${geoms[0].method} tris ${geoms[0].triCount}` : `found ${geoms.length} mesh(es)`;
      }else if(meshRes.geometries){
        geoms=meshRes.geometries;
        reason=meshRes.reason||reason;
      }else if(meshRes.positions){
        geoms=[meshRes];
        reason=meshRes.method||reason;
      }
    }
    if(geoms && geoms.length) { showMesh(geoms); $('meshInfo').textContent=reason; }
    else { showProxy(reason); $('meshInfo').textContent=reason; }

    irObj=gbxToIR({fileName, classId, decomp:out, mover, moverOff});
    renderIR();
    $('irCard').style.display='block';
    $('previewCard').style.display='block';
    $('exportCard').style.display='block';
    // ensure canvas gets size now that it's visible
    resize();
    // also after a tick (layout)
    setTimeout(()=>resize(), 100);
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
    const res=validateIR(obj);
    if(!res.ok){ setStatus('IR invalid: '+res.msg); return; }
    irObj=obj;
    setStatus('IR ok – anims '+obj.animations.length);
    // preview anims
    const chain=sampleIR(obj, performance.now()/1000);
    // TODO: apply to Three preview
  }catch(e){ setStatus('IR parse error: '+e.message); }
});

$('exportBtn').addEventListener('click',()=>{
  if(!irObj || !decomp) return;
  try{
    const mover=irToMover(irObj);
    const patched=patchMover(decomp, moverOff, mover);
    const buur=buildBUUR(origBytes, bodyPtr, patched);
    const blob=new Blob([buur],{type:'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=fileName.replace(/\.Gbx$/i,'')+'_mod.Item.Gbx'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus('Exported BUUR '+buur.length);
  }catch(e){ setStatus('Export failed: '+e.message); console.error(e); }
});

// animate
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene,camera);
}
animate();
