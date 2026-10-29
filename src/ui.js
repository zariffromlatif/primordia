"use strict";
/* Primordia rendering, input and panels. The simulation runs in src/worker.js when it can, or on
   this page through src/host.js when it can't; either way it arrives here as frames.
   Uses constants and helpers from src/sim.js and src/host.js. */
(function(){
const $=s=>document.querySelector(s);
const dpr=Math.min(window.devicePixelRatio||1,2.5);
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPEEDS=[1,4,12,40];
const TOOL_HINTS={rain:"Tap the island to bring rain",hunters:"Tap the island to drop three hunters",meteor:"Tap the island to aim a meteor",plague:"Tap a crowd to start a plague"};
const FLASH={meteor:[255,160,60],rain:[90,170,255],plague:[180,120,255],hunters:[255,90,80]};

/* ---------- state from the simulation ---------- */
let F=null;          // latest frame: creatures, plants, weather, stats, the selected creature
let terrain=null;    // terrain types, hill shading and drainage, resent whenever the ground changes
let hydro=null;      // rivers, lakes and soil moisture, resent every few ticks
let panelData=null;  // species, history and records, resent a few times a second
let events=[];
let flashes=[];
let lastTreeKey="";  // what the family tree was last drawn for

/* ---------- island links: #island-12345 replays the same island ---------- */
function seedFromHash(){const m=/^#island-(\d{1,10})$/.exec(location.hash);return m?Number(m[1]):null;}
let seed=seedFromHash();if(seed===null)seed=(Math.random()*1e9)|0;
let selectedId=0,follow=false,tool="inspect",speedIx=0,running=!reduce,frame=0;
const cam={x:W/2,y:W/2,z:1};
function writeHash(){if(location.hash!=="#island-"+seed){try{location.hash="island-"+seed;}catch(e){/* hash unavailable */}}}
window.addEventListener("hashchange",()=>{const s=seedFromHash();if(s!==null&&s!==seed)newWorld(s);});

/* ---------- the engine: a worker if possible, otherwise this page ---------- */
let engine=null,pending=false,worldMsg=null;
function inPage(){
  const host=makeHost(m=>queueMicrotask(()=>receive(m)));
  engine={kind:"page",post:m=>host.handle(m)};
  pending=false;
  if(worldMsg)engine.post(worldMsg);
}
function startEngine(){
  let wk=null;
  try{wk=new Worker("src/worker.js");}catch(e){wk=null;}
  if(!wk){inPage();return;}
  let heard=false;
  wk.onmessage=e=>{heard=true;receive(e.data);};
  wk.onerror=e=>{
    if(heard){console.error(e.message||e);return;}
    e.preventDefault();wk.terminate();inPage();
  };
  engine={kind:"worker",post:m=>wk.postMessage(m)};
}
function post(m){if(m.type==="new"||m.type==="load")worldMsg=m;engine.post(m);}

function receive(m){
  if(m.type==="frame"){pending=false;takeFrame(m);}
  else if(m.type==="world"){
    seed=m.seed;writeHash();
    F=null;terrain=null;hydro=null;panelData=null;events=[];flashes=[];
    selectedId=0;follow=false;buildInspector();
    cam.x=W/2;cam.y=W/2;cam.z=1;
    updateSeedLine();syncPlay();
    if(m.loaded)notice(`Loaded island ${m.seed} on day ${days(m.tick)}.`);
  }
  else if(m.type==="snapshot")download(m.text,m.name);
  else if(m.type==="error")notice(m.message);
}

function takeFrame(m){
  if(m.terrain)terrain=m.terrain;
  if(m.hydro)hydro=m.hydro;
  if(m.panels)panelData=m.panels;
  if(m.events){events=m.events;updateLog();}
  for(const f of m.flashes)flashes.push(f);
  F=m;
  if(m.missing&&m.missing===selectedId){select(0);notice("That creature had already died.");}
  if(m.panels){updateSpecies();updateRecords();maybeDrawTree();}
}

/* ---------- canvases and colors ---------- */
const wc=$("#world"),ctx=wc.getContext("2d");
const off=document.createElement("canvas");off.width=G;off.height=G;
const octx=off.getContext("2d"),img=octx.createImageData(G,G);
const chartC=$("#chart"),cctx=chartC.getContext("2d");
const BASE=[[34,66,112],[62,108,156],[222,206,160],[176,150,104],[124,106,76],[146,144,138]];
const FULL=[[34,66,112],[58,128,128],[176,184,112],[94,152,72],[42,102,58],[124,134,112]];
const LAKE_RGB=[56,108,158],ICE_RGB=[214,228,238],DRY_RGB=[214,176,120];

let colors={};
function hexRgb(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(x=>x+x).join("");const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255];}
function readColors(){const cs=getComputedStyle(document.documentElement);for(const n of["ink","muted","line","surface","pos","neg","herb","carn","plant","accent"])colors[n]=cs.getPropertyValue("--"+n).trim()||"#888888";colors.posRgb=hexRgb(colors.pos);colors.negRgb=hexRgb(colors.neg);lastTreeKey="";maybeDrawTree();}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",readColors);
new MutationObserver(readColors).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

function fitCanvas(cv){if(!cv)return;const r=cv.getBoundingClientRect();const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h;}
const ro=new ResizeObserver(entries=>{for(const e of entries){if(e.target.tagName==="CANVAS")fitCanvas(e.target);else maybeDrawTree();}});
ro.observe(wc);ro.observe(chartC);

function spColor(hue,hunt){const h=hue|0;return hunt?`hsl(${h} 72% 50%)`:`hsl(${h} 58% 60%)`;}
function italicName(who){const i=who.lastIndexOf(" #");return i<0?who:`<i>${esc(who.slice(0,i))}</i>${esc(who.slice(i))}`;}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function speciesById(id){if(!panelData)return null;for(const s of panelData.species)if(s.id===id)return s;return null;}

/* ---------- camera ---------- */
function updateCam(){
  const s=F&&F.sel&&F.sel.id===selectedId?F.sel:null,tracking=follow&&s,a=reduce?1:0.12;
  const tz=tracking?3:1,tx=tracking?s.x:W/2,ty=tracking?s.y:W/2;
  cam.z+=(tz-cam.z)*a;cam.x+=(tx-cam.x)*a;cam.y+=(ty-cam.y)*a;
}
function view(){const vw=W/cam.z;return{vw,ox:clamp(cam.x-vw/2,0,W-vw),oy:clamp(cam.y-vw/2,0,W-vw),k:wc.width/vw};}

/* ---------- world rendering ---------- */
function paintGround(){
  const d=img.data,P=F.plant,T=terrain.terr,S=terrain.shade,Wt=hydro?hydro.water:null,M=hydro?hydro.moist:null;
  const freeze=F.climate&&F.climate.kind==="freeze",winter=(1-F.season)*0.24+(freeze?0.25:0);
  for(let q=0;q<G*G;q++){
    const t=T[q],sh=S[q];let r,g,bl;
    if(Wt&&Wt[q]===255){
      const ice=freeze?0.65:winter*0.3;
      r=LAKE_RGB[0]+(ICE_RGB[0]-LAKE_RGB[0])*ice;g=LAKE_RGB[1]+(ICE_RGB[1]-LAKE_RGB[1])*ice;bl=LAKE_RGB[2]+(ICE_RGB[2]-LAKE_RGB[2])*ice;
    }else{
      const b=BASE[t],f=FULL[t],m=Math.min(1,Math.sqrt(P[q])*1.1);
      r=(b[0]+(f[0]-b[0])*m)*sh;g=(b[1]+(f[1]-b[1])*m)*sh;bl=(b[2]+(f[2]-b[2])*m)*sh;
      if(t>=SAND){
        const dry=M?Math.max(0,0.3-M[q]/255)*0.9:0;
        r+=(DRY_RGB[0]-r)*dry;g+=(DRY_RGB[1]-g)*dry;bl+=(DRY_RGB[2]-bl)*dry;
        r+=(236-r)*winter;g+=(240-g)*winter;bl+=(244-bl)*winter;
      }
    }
    const o=q*4;d[o]=r;d[o+1]=g;d[o+2]=bl;d[o+3]=255;
  }
  octx.putImageData(img,0,0);
}

/* Each stream is drawn from a cell to the one it drains into, wider as the flow grows. */
const riverPaths=[new Path2D(),new Path2D(),new Path2D(),new Path2D()];
const riverFor={hydro:null,terrain:null,view:""};
function drawRivers(V,k){
  if(!hydro||!terrain)return;
  const Wt=hydro.water,D=terrain.down,view=`${V.ox.toFixed(1)}:${V.oy.toFixed(1)}:${k.toFixed(4)}`;
  if(riverFor.hydro!==hydro||riverFor.terrain!==terrain||riverFor.view!==view){
    riverFor.hydro=hydro;riverFor.terrain=terrain;riverFor.view=view;
    for(let i=0;i<4;i++)riverPaths[i]=new Path2D();
    const x0=V.ox-CELL,y0=V.oy-CELL,x1=V.ox+V.vw+CELL,y1=V.oy+V.vw+CELL;
    for(let q=0;q<G*G;q++){
      const v=Wt[q];if(v===0||v===255)continue;
      const d=D[q];if(d<0)continue;
      const ax=(q%G+0.5)*CELL,ay=((q/G|0)+0.5)*CELL,bx=(d%G+0.5)*CELL,by=((d/G|0)+0.5)*CELL;
      if((ax<x0&&bx<x0)||(ax>x1&&bx>x1)||(ay<y0&&by<y0)||(ay>y1&&by>y1))continue;
      const p=riverPaths[Math.min(3,(v/64)|0)];
      p.moveTo((ax-V.ox)*k,(ay-V.oy)*k);p.lineTo((bx-V.ox)*k,(by-V.oy)*k);
    }
  }
  const freeze=F.climate&&F.climate.kind==="freeze";
  ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
  ctx.strokeStyle=freeze?"rgba(214,228,238,.95)":"rgba(66,124,182,.92)";
  for(let i=0;i<4;i++){ctx.lineWidth=Math.max(1*dpr,(0.9+i*0.9)*k*1.4);ctx.stroke(riverPaths[i]);}
  ctx.restore();
}

function drawStorms(V,k){
  for(const s of F.storms){
    if(s.p<=0.005)continue;
    const x=(s.x-V.ox)*k,y=(s.y-V.oy)*k,R=s.r*k,a=Math.min(0.42,s.p*2.2);
    const g=ctx.createRadialGradient(x,y,0,x,y,R);
    g.addColorStop(0,`rgba(232,238,246,${a.toFixed(3)})`);g.addColorStop(0.65,`rgba(214,224,236,${(a*0.55).toFixed(3)})`);g.addColorStop(1,"rgba(214,224,236,0)");
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,R,0,Math.PI*2);ctx.fill();
    if(reduce)continue;
    // rain streaks, scattered differently every frame
    ctx.strokeStyle=`rgba(200,220,255,${Math.min(0.7,a*1.8).toFixed(3)})`;ctx.lineWidth=1*dpr;ctx.beginPath();
    const n=Math.round(18*s.p/0.2);
    for(let i=0;i<n;i++){
      const u=Math.sin(i*12.9898+frame*0.731+s.x)*43758.5453,v=Math.sin(i*78.233+frame*0.419+s.y)*12345.678;
      const ang=(u-Math.floor(u))*Math.PI*2,rad=Math.sqrt(v-Math.floor(v))*R*0.8;
      const px=x+Math.cos(ang)*rad,py=y+Math.sin(ang)*rad;
      ctx.moveTo(px,py);ctx.lineTo(px-2*dpr,py+7*dpr);
    }
    ctx.stroke();
  }
}

function drawWorld(){
  const cw=wc.width,ch=wc.height;
  if(!F||!terrain){ctx.fillStyle="#24456F";ctx.fillRect(0,0,cw,ch);return;}
  updateCam();
  const V=view(),k=V.k;
  paintGround();
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(off,V.ox/CELL,V.oy/CELL,V.vw/CELL,V.vw/CELL,0,0,cw,ch);
  drawRivers(V,k);

  const cr=F.cr,minR=3*dpr,grow=1.5/Math.sqrt(cam.z),pad=24*dpr;
  for(let i=0;i<cr.length;i+=STRIDE){
    const x=(cr[i+1]-V.ox)*k,y=(cr[i+2]-V.oy)*k;
    if(x<-pad||y<-pad||x>cw+pad||y>ch+pad)continue;
    const a=cr[i+3],r=Math.max(cr[i+4]*k*grow,minR),hue=cr[i+5],hunt=cr[i+6]>0.5,sig=cr[i+7];
    if(sig>0.2){
      ctx.beginPath();ctx.arc(x,y,r+4*dpr,0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,236,150,${Math.min(0.9,sig).toFixed(2)})`;ctx.lineWidth=2.2*dpr;ctx.stroke();
    }
    ctx.lineWidth=Math.max(1,0.9*dpr);
    ctx.beginPath();
    if(hunt){
      ctx.moveTo(x+Math.cos(a)*r*1.6,y+Math.sin(a)*r*1.6);
      ctx.lineTo(x+Math.cos(a+2.5)*r*1.1,y+Math.sin(a+2.5)*r*1.1);
      ctx.lineTo(x+Math.cos(a-2.5)*r*1.1,y+Math.sin(a-2.5)*r*1.1);
      ctx.closePath();
      ctx.fillStyle=spColor(hue,true);ctx.fill();ctx.strokeStyle="rgba(30,8,8,.7)";ctx.stroke();
    }else{
      ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=spColor(hue,false);ctx.fill();ctx.strokeStyle="rgba(12,28,20,.55)";ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.stroke();
    }
    if(r>=9*dpr){ // eyes, once a creature is drawn big enough to see them
      const ne=cr[i+9],fov=cr[i+10],er=Math.max(1,r*0.14);
      ctx.fillStyle="rgba(10,14,20,.85)";ctx.beginPath();
      for(let e=0;e<ne;e++){const an=a-fov/2+(e+0.5)*fov/ne,ex=x+Math.cos(an)*r*0.72,ey=y+Math.sin(an)*r*0.72;ctx.moveTo(ex+er,ey);ctx.arc(ex,ey,er,0,Math.PI*2);}
      ctx.fill();
    }
    if(cr[i+8]){ctx.beginPath();ctx.arc(x,y,Math.max(1.6*dpr,r*0.45),0,Math.PI*2);ctx.fillStyle="#9B5CFF";ctx.fill();}
  }
  const s=F.sel&&F.sel.id===selectedId?F.sel:null;
  if(s){
    const x=(s.x-V.ox)*k,y=(s.y-V.oy)*k,r=Math.max(s.r*k*grow,minR);
    ctx.save();
    ctx.lineWidth=2*dpr;ctx.strokeStyle=s.dead?"rgba(255,255,255,.5)":"#fff";
    ctx.beginPath();ctx.arc(x,y,r+6*dpr,0,Math.PI*2);ctx.stroke();
    if(!s.dead){
      // the sight cone, split into one slice per eye
      const R=s.g.sense*k,half=s.g.fov/2,ne=s.g.eyes;
      ctx.setLineDash([4*dpr,5*dpr]);ctx.lineWidth=1*dpr;ctx.strokeStyle="rgba(255,255,255,.6)";
      ctx.beginPath();ctx.arc(x,y,R,s.a-half,s.a+half);ctx.stroke();
      ctx.setLineDash([2*dpr,4*dpr]);ctx.strokeStyle="rgba(255,255,255,.35)";ctx.beginPath();
      for(let e=0;e<=ne;e++){const an=s.a-half+e*s.g.fov/ne;ctx.moveTo(x+Math.cos(an)*(r+6*dpr),y+Math.sin(an)*(r+6*dpr));ctx.lineTo(x+Math.cos(an)*R,y+Math.sin(an)*R);}
      ctx.stroke();
    }
    ctx.restore();
  }
  drawStorms(V,k);
  for(let i=flashes.length-1;i>=0;i--){
    const f=flashes[i];f.life-=reduce?0.05:0.015;
    if(f.life<=0){flashes.splice(i,1);continue;}
    const col=FLASH[f.kind]||FLASH.meteor,R=f.r*k*(1.25-0.25*f.life);
    ctx.beginPath();ctx.arc((f.x-V.ox)*k,(f.y-V.oy)*k,R,0,Math.PI*2);
    ctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${(0.3*f.life).toFixed(3)})`;ctx.fill();
    ctx.lineWidth=3*dpr;ctx.strokeStyle=`rgba(${col[0]},${col[1]},${col[2]},${f.life.toFixed(3)})`;ctx.stroke();
  }
  const t=F.tick;
  $("#season").textContent=`Year ${yearOf(t)}, ${SEASONS[seasonOf(t)]}${F.climate?", "+F.climate.label:""}`;
}

/* ---------- chart: one band per species ---------- */
function drawChart(){
  const w=chartC.width,h=chartC.height;
  cctx.clearRect(0,0,w,h);
  cctx.strokeStyle=colors.line;cctx.lineWidth=1*dpr;
  cctx.beginPath();cctx.moveTo(0,h-0.5*dpr);cctx.lineTo(w,h-0.5*dpr);cctx.stroke();
  if(!panelData)return;
  const H=panelData.history;
  if(H.length<2)return;
  let maxTot=40,maxP=1;for(const s of H){const tot=s.h+s.c;if(tot>maxTot)maxTot=tot;if(s.p>maxP)maxP=s.p;}
  const n=H.length,X=i=>i/(n-1)*w,top=16*dpr,floor=h-1*dpr,span=floor-top;
  cctx.beginPath();cctx.moveTo(0,floor);
  H.forEach((s,i)=>cctx.lineTo(X(i),floor-s.p/maxP*span*0.9));
  cctx.lineTo(w,floor);cctx.closePath();
  cctx.globalAlpha=0.35;cctx.fillStyle=colors.plant;cctx.fill();cctx.globalAlpha=1;
  const ids=new Set();for(const s of H)for(const id in s.sp)ids.add(+id);
  const meta=new Map(panelData.species.map(s=>[s.id,s]));
  const order=[...ids].sort((a,b)=>a-b),base=new Float32Array(n),tops=new Float32Array(n);
  for(const id of order){
    let any=false;
    for(let i=0;i<n;i++){const v=H[i].sp[id]||0;if(v)any=true;tops[i]=base[i]+v;}
    if(!any)continue;
    const sp=meta.get(id);
    cctx.beginPath();
    for(let i=0;i<n;i++){const y=floor-tops[i]/maxTot*span;i?cctx.lineTo(X(i),y):cctx.moveTo(X(i),y);}
    for(let i=n-1;i>=0;i--)cctx.lineTo(X(i),floor-base[i]/maxTot*span);
    cctx.closePath();cctx.fillStyle=spColor(sp?sp.hue:0,sp&&sp.diet>0.5);cctx.fill();
    base.set(tops);
  }
  cctx.fillStyle=colors.muted;cctx.font=`${11*dpr}px "Bricolage Grotesque",system-ui,sans-serif`;cctx.textBaseline="top";
  cctx.fillText(`${maxTot} creatures`,2*dpr,0);
}

/* ---------- family tree ---------- */
/* Redrawn when a species splits off or dies out, when the panel resizes, and every 400 ticks
   so the lines of living species keep growing. */
function maybeDrawTree(){
  if(!panelData||!F)return;
  let living=0,extinct=0;for(const s of panelData.species)if(s.announced){if(s.extinct)extinct++;else living++;}
  const key=`${seed}:${panelData.species.length}:${living}:${extinct}:${$("#tree-extinct").checked}|${Math.round($("#tree-wrap").clientWidth)}|${Math.floor(F.tick/400)}`;
  if(key!==lastTreeKey){lastTreeKey=key;drawTree();}
}
function drawTree(){
  const box=$("#tree-wrap"),el=$("#tree");
  if(!panelData||!F){el.innerHTML="";return;}
  const all=new Map(panelData.species.map(s=>[s.id,s]));
  const visParent=s=>{let p=all.get(s.parentId);while(p&&!p.announced)p=all.get(p.parentId);return p?p.id:0;};
  let shown=panelData.species.filter(s=>s.announced);
  const showExtinct=$("#tree-extinct").checked;
  if(!showExtinct){ // only species still alive, and the ancestors they came from
    const keep=new Set();
    for(const s of shown)if(!s.extinct)for(let p=s;p&&!keep.has(p.id);p=all.get(visParent(p)))keep.add(p.id);
    shown=shown.filter(s=>keep.has(s.id));
  }
  const kids=new Map(),roots=[];
  for(const s of shown){const p=visParent(s);if(p){if(!kids.has(p))kids.set(p,[]);kids.get(p).push(s);}else roots.push(s);}
  const byBirth=(a,b)=>a.born-b.born||a.id-b.id;
  const rows=[],seen=new Set();
  const visit=s=>{if(seen.has(s.id))return;seen.add(s.id);rows.push(s);for(const c of(kids.get(s.id)||[]).sort(byBirth))visit(c);};
  for(const r of roots.sort(byBirth))visit(r);
  const width=Math.max(260,Math.round(box.clientWidth)),now=Math.max(F.tick,1);
  const rowH=20,top=8,axisH=22,nameW=Math.min(170,Math.round(width*0.42)),x0=nameW+10,x1=width-8;
  const X=t=>x0+(x1-x0)*t/now,h=top+rows.length*rowH+axisH;
  const yOf=new Map();rows.forEach((s,i)=>yOf.set(s.id,top+i*rowH+rowH/2));
  const maxChars=Math.max(6,Math.floor(nameW/6.6));
  let svg="";
  for(const s of rows){
    const y=yOf.get(s.id),hunt=s.diet>0.5,col=spColor(s.hue,hunt),end=s.extinct?s.died:now,p=visParent(s);
    const op=s.extinct?0.45:1,name=s.name.length>maxChars?s.name.slice(0,maxChars-1)+"…":s.name;
    const tip=`${s.name}: ${s.extinct?`extinct after ${days(s.died-s.born)} days`:`${s.n} alive`}, ${hunt?"hunters":"grazers"}, since day ${days(s.born)}${s.parentName?`, split from ${s.parentName}`:""}`;
    svg+=`<g class="tr${s.rep?" live":""}" data-sid="${s.id}"${s.rep?` data-rep="${s.rep}" tabindex="0" role="button"`:""} opacity="${op}"><title>${esc(tip)}</title>`;
    svg+=`<rect x="0" y="${y-rowH/2}" width="${width}" height="${rowH}" fill="transparent"/>`;
    if(p&&yOf.has(p)){const px=X(s.born),py=yOf.get(p);svg+=`<path d="M${px.toFixed(1)} ${py}V${y}" stroke="${col}" stroke-width="1.5" fill="none"/><circle cx="${px.toFixed(1)}" cy="${py}" r="2.5" fill="${col}"/>`;}
    svg+=`<line x1="${X(s.born).toFixed(1)}" y1="${y}" x2="${Math.max(X(end),X(s.born)+2).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${s.extinct?3:5}" stroke-linecap="round"/>`;
    svg+=`<text x="4" y="${y}" dominant-baseline="central" class="tn"><tspan font-style="italic">${esc(name)}</tspan></text></g>`;
  }
  // time axis: days for the first couple of years, then years
  const stepT=[500,1000,2000,YEAR,2*YEAR,5*YEAR,10*YEAR,25*YEAR,50*YEAR].find(t=>now/t<=4.5)||100*YEAR;
  svg+=`<line x1="${x0}" y1="${h-axisH+4}" x2="${x1}" y2="${h-axisH+4}" stroke="${colors.line}"/>`;
  for(let t=0;t<=now;t+=stepT){
    const x=X(t),label=t===0?"Day 1":stepT<YEAR?`Day ${days(t)}`:`Year ${t/YEAR+1}`;
    svg+=`<text x="${x.toFixed(1)}" y="${h-6}" text-anchor="${t===0?"start":x>x1-20?"end":"middle"}" class="ta">${label}</text>`;
  }
  el.setAttribute("viewBox",`0 0 ${width} ${h}`);el.setAttribute("width",width);el.setAttribute("height",h);
  const focused=el.contains(document.activeElement)?document.activeElement.dataset.sid:null;
  el.innerHTML=rows.length?svg:"";
  if(focused){const g=el.querySelector(`[data-sid="${focused}"][tabindex]`);if(g)g.focus({preventScroll:true});}
  const pr=panelData.pairs;
  $("#tree-note").textContent=(rows.length?`Each line is a species, from the day it split off to ${showExtinct?"today or to its extinction":"today, with the extinct ancestors it came from"}. Tap a living one to inspect a member. `:"")+(pr>=0?`${Math.round(pr*100)}% of recent births had two parents.`:"");
}
function treePick(e){const g=e.target.closest(".tr.live");if(!g)return;const id=+g.dataset.rep;if(id)select(id);}
$("#tree").addEventListener("click",treePick);
$("#tree-extinct").addEventListener("change",maybeDrawTree);
$("#tree").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();treePick(e);}});
ro.observe($("#tree-wrap"));

/* ---------- inspector ---------- */
const GENES=[
  {k:"size",label:"Body size",min:0.4,max:2.4,fmt:v=>"×"+v.toFixed(2)},
  {k:"speed",label:"Top speed",min:0.3,max:2.5,fmt:v=>"×"+v.toFixed(2)},
  {k:"eyes",label:"Eyes",min:1,max:MAX_EYES,fmt:v=>String(v)},
  {k:"fov",label:"Field of view",min:0.5,max:6,fmt:v=>Math.round(v*180/Math.PI)+"°"},
  {k:"sense",label:"Sight range",min:20,max:220,fmt:v=>Math.round(v)+""},
  {k:"diet",label:"Meat in diet",min:0,max:1,fmt:v=>Math.round(v*100)+"%"},
  {k:"mut",label:"Mutation rate",min:0.01,max:0.4,fmt:v=>(v*100).toFixed(1)+"%"}
];
const EYE_NAMES=[[],["ahead"],["left","right"],["left","ahead","right"],["far left","left","right","far right"],
  ["far left","left","ahead","right","far right"],["far left","left","near left","near right","right","far right"]];
const OUTPUT_LABELS=["Turn","Speed","Call","Memory"];
function brainRows(eyes){
  const rows=[];
  for(let e=0;e<eyes;e++)for(let t=0;t<3;t++)rows.push({i:e*3+t,label:["Plants","Prey","Hunter"][t]+" "+EYE_NAMES[eyes][e]});
  ["Energy","Water ahead","Pulse","Calls heard","Memory"].forEach((label,n)=>rows.push({i:IE+n,label}));
  return rows;
}
const NUMBERS=["no","one","two","three","four","five","six"];

let builtFor=null;
function select(id){
  selectedId=id||0;if(!selectedId)follow=false;
  post({type:"select",id:selectedId});
  builtFor=null;buildInspector();
}

function buildInspector(){
  const el=$("#inspector"),s=F&&F.sel&&F.sel.id===selectedId?F.sel:null;
  if(!selectedId){
    builtFor=null;
    el.innerHTML=`<h2>Creature</h2><p class="muted small">With Inspect on, tap any creature to read its genes, follow it around the island and watch its brain decide what to do next.</p>`;
    return;
  }
  if(!s){el.innerHTML=`<h2>Creature</h2><p class="muted small">Finding #${selectedId}…</p>`;return;}
  builtFor={id:s.id,eyes:s.g.eyes,hunt:s.g.diet>0.5};
  const rows=brainRows(s.g.eyes).length;
  el.innerHTML=`<div class="insp-head"><span class="sw${builtFor.hunt?" tri":""}" id="i-sw"></span><div class="grow"><h2 id="i-name"></h2><p class="muted small" id="i-role"></p></div></div>
  <div class="insp-actions"><button id="i-follow" aria-pressed="false">Follow</button><button class="ghost" id="i-close">Close</button></div>
  <p class="status" id="i-status"></p>
  <div class="meter"><span>Energy</span><div class="bar"><i id="i-energy"></i></div><em id="i-energy-v"></em></div>
  <dl class="facts"><div><dt>Age</dt><dd id="i-age"></dd></div><div><dt>Children</dt><dd id="i-kids"></dd></div><div><dt>Kills</dt><dd id="i-kills"></dd></div><div><dt>Health</dt><dd id="i-health"></dd></div></dl>
  <h3>Genes</h3>
  <div class="genes">${GENES.map(g=>`<span>${g.label}</span><div class="bar"><i id="g-${g.k}"></i></div><em id="gv-${g.k}"></em>`).join("")}</div>
  <h3>Brain</h3>
  <canvas id="brain" style="height:${rows*14+20}px" aria-label="Live diagram of this creature’s neural network"></canvas>
  <p class="muted small">Its ${rows} senses, three for each of its ${NUMBERS[s.g.eyes]} ${s.g.eyes===1?"eye":"eyes"} plus five more, feed eight hidden neurons. They drive four outputs: turning, speed, a call that nearby creatures can hear, and a memory the brain reads back a moment later. Blue wiring excites, red inhibits, and brighter nodes are firing harder right now.</p>`;
  $("#i-close").onclick=()=>select(0);
  $("#i-follow").onclick=()=>{follow=!follow;syncFollow();};
  syncFollow();
  const bc=$("#brain");ro.observe(bc);fitCanvas(bc);
  updateInspector();
}
function syncFollow(){const b=$("#i-follow");if(!b)return;b.textContent=follow?"Stop following":"Follow";b.setAttribute("aria-pressed",String(follow));}

function mood(c){
  const i=c.inp;
  if(c.dead)return`Died: ${c.cause.charAt(0).toLowerCase()+c.cause.slice(1)}, at ${(c.age/100).toFixed(1)} days old.`;
  let threat=0,prey=0,plants=0;
  for(let e=0;e<c.g.eyes;e++){plants=Math.max(plants,i[e*3]);prey=Math.max(prey,i[e*3+1]);threat=Math.max(threat,i[e*3+2]);}
  if(threat>0.25)return c.sig>0.4?"Spotted a hunter and is calling out.":"Spotted a hunter nearby.";
  if(c.sick)return"Sick with plague.";
  if(c.g.diet>0.5&&prey>0.2)return"Stalking prey.";
  if(c.sig>0.5)return"Calling out.";
  if(i[IE+1]>0.9)return"Facing deep water.";
  if(i[IE+1]>0.2)return"Wading into water.";
  if(c.e/c.maxE<0.25)return"Hungry and searching.";
  if(c.g.diet<=0.5&&plants>0.35)return"Grazing.";
  return c.v<0.4?"Resting.":"Wandering.";
}

function updateInspector(){
  if(!selectedId)return;
  const c=F&&F.sel&&F.sel.id===selectedId?F.sel:null;
  if(!c)return;
  if(!builtFor||builtFor.id!==c.id||builtFor.eyes!==c.g.eyes){buildInspector();return;}
  if(!$("#i-name"))return;
  const hunt=c.g.diet>0.5;
  $("#i-sw").style.background=spColor(c.hue,hunt);
  $("#i-name").innerHTML=`<i>${esc(c.name)}</i> #${c.id}`;
  $("#i-role").textContent=`${hunt?"Hunter":"Grazer"}, generation ${c.gen}, ${c.mateId?"born to a pair":c.parentId?"budded from one parent":"a founder"}`;
  $("#i-status").textContent=mood(c);
  const ef=clamp(c.e/c.maxE,0,1);
  $("#i-energy").style.width=(ef*100).toFixed(1)+"%";
  $("#i-energy").style.background=ef<0.25?colors.carn:colors.herb;
  $("#i-energy-v").textContent=Math.round(ef*100)+"%";
  $("#i-age").textContent=(c.age/100).toFixed(1)+" d";
  $("#i-kids").textContent=c.kids;
  $("#i-kills").textContent=c.kills;
  $("#i-health").textContent=c.sick?"Sick":c.immune?"Immune":"Healthy";
  for(const g of GENES){
    const v=c.g[g.k];
    $("#g-"+g.k).style.width=(clamp((v-g.min)/(g.max-g.min),0,1)*100).toFixed(1)+"%";
    $("#gv-"+g.k).textContent=g.fmt(v);
  }
}

function drawBrain(){
  const cv=$("#brain"),c=F&&F.sel&&F.sel.id===selectedId?F.sel:null;if(!cv||!c)return;
  const bctx=cv.getContext("2d"),w=cv.width,h=cv.height,rows=brainRows(c.g.eyes),NR=rows.length;
  bctx.clearRect(0,0,w,h);
  const padL=104*dpr,padR=64*dpr,top=8*dpr,bot=12*dpr;
  const xI=padL,xO=w-padR,xH=(xI+xO)/2;
  const ys=(n,i)=>top+(h-top-bot)*(i+0.5)/n;
  const yO=i=>h*0.2+h*0.6*(i+0.5)/NO;
  const P=colors.posRgb,N=colors.negRgb;
  const edge=(x1,y1,x2,y2,wt,act)=>{
    const col=wt>=0?P:N,a=clamp(Math.abs(wt)/2.5,0.04,0.9)*(0.2+0.8*Math.min(1,Math.abs(act)));
    bctx.strokeStyle=`rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
    bctx.lineWidth=(0.4+Math.min(2.6,Math.abs(wt)))*0.7*dpr;
    bctx.beginPath();bctx.moveTo(x1,y1);bctx.lineTo(x2,y2);bctx.stroke();
  };
  for(let hh=0;hh<NH;hh++)rows.forEach((r,n)=>edge(xI,ys(NR,n),xH,ys(NH,hh),c.w1[hh*NI+r.i],c.inp[r.i]));
  for(let o=0;o<NO;o++)for(let hh=0;hh<NH;hh++)edge(xH,ys(NH,hh),xO,yO(o),c.w2[o*NH+hh],c.hid[hh]);
  // the memory output loops back to the memory input
  bctx.save();bctx.setLineDash([3*dpr,4*dpr]);bctx.strokeStyle=colors.muted;bctx.lineWidth=1*dpr;
  bctx.beginPath();bctx.moveTo(xO,yO(3)+7*dpr);bctx.bezierCurveTo(xO,h-2*dpr,xI,h-2*dpr,xI,ys(NR,NR-1)+5*dpr);bctx.stroke();bctx.restore();
  const node=(x,y,act,r)=>{
    const col=act>=0?P:N;
    bctx.beginPath();bctx.arc(x,y,r,0,Math.PI*2);
    bctx.fillStyle=colors.surface;bctx.fill();
    bctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${clamp(Math.abs(act),0,1).toFixed(3)})`;bctx.fill();
    bctx.lineWidth=1*dpr;bctx.strokeStyle=colors.muted;bctx.stroke();
  };
  bctx.font=`${11*dpr}px "Bricolage Grotesque",system-ui,sans-serif`;bctx.textBaseline="middle";
  rows.forEach((r,n)=>{node(xI,ys(NR,n),c.inp[r.i],4.5*dpr);bctx.fillStyle=colors.muted;bctx.textAlign="right";bctx.fillText(r.label,xI-9*dpr,ys(NR,n));});
  for(let hh=0;hh<NH;hh++)node(xH,ys(NH,hh),c.hid[hh],5.5*dpr);
  for(let o=0;o<NO;o++){node(xO,yO(o),c.out[o],7*dpr);bctx.fillStyle=colors.ink;bctx.textAlign="left";bctx.fillText(OUTPUT_LABELS[o],xO+11*dpr,yO(o));}
}

/* ---------- side panel ---------- */
function updateStats(){
  if(!F)return;
  $("#s-herb").textContent=F.stats.herb;
  $("#s-carn").textContent=F.stats.carn;
  $("#s-species").textContent=F.stats.species;
  $("#s-gen").textContent=F.stats.gen;
}

function updateSpecies(){
  if(!panelData)return;
  const rows=panelData.species.filter(s=>s.n>0&&s.rep).sort((a,b)=>b.n-a.n).slice(0,6);
  let extinct=0;for(const s of panelData.species)if(s.extinct&&s.peak>=5)extinct++;
  $("#species").innerHTML=rows.length?rows.map(sp=>{
    const hunt=sp.diet>0.5;
    return`<li><button class="lin" data-rep="${sp.rep}"><span class="sw${hunt?" tri":""}" style="background:${spColor(sp.hue,hunt)}"></span><span class="grow"><b><i>${esc(sp.name)}</i></b><small>${sp.n} alive, ${hunt?"hunters":"grazers"}, since day ${days(sp.born)}${sp.parentName?`, split from <i>${esc(sp.parentName)}</i>`:""}</small></span></button></li>`;
  }).join(""):`<li class="muted small">Nothing is alive yet.</li>`;
  $("#extinct").textContent=extinct?`${extinct} species ${extinct===1?"has":"have"} gone extinct on this island so far.`:"No species has gone extinct yet.";
}
$("#species").addEventListener("click",e=>{const b=e.target.closest(".lin");if(!b)return;const id=+b.dataset.rep;if(id)select(id);});

function updateRecords(){
  const R=panelData.records;
  const rows=[
    ["Longest life",R.age.v?(R.age.v/100).toFixed(1)+" days":"",R.age.who],
    ["Most children",R.kids.v||"",R.kids.who],
    ["Most kills",R.kills.v||"",R.kills.who],
    ["Deepest generation",R.gen.v||"",R.gen.who]
  ];
  $("#records").innerHTML=rows.map(([label,v,who])=>`<div class="rec"><span>${label}</span><b>${v===""?"None yet":v}</b><small>${v===""?"":italicName(who)}</small></div>`).join("");
}

let nameRe=null,nameReKey="";
function italicizeSpecies(text){
  const list=panelData?panelData.species:[];
  if(nameReKey!==list.length+":"+seed){
    const names=list.map(s=>s.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).sort((x,y)=>y.length-x.length);
    nameRe=names.length?new RegExp("("+names.join("|")+")(?![a-z])","g"):null;nameReKey=list.length+":"+seed;
  }
  const safe=esc(text);
  return nameRe?safe.replace(nameRe,"<i>$1</i>"):safe;
}
function updateLog(){
  $("#log").innerHTML=events.map(e=>`<li><time>Day ${days(e.t)}</time><span>${italicizeSpecies(e.text)}</span></li>`).join("");
}

function updateSeedLine(){$("#seedline").textContent=`This is island ${seed}. Its link replays the same island and the same history, until someone steps in.`;}

let noticeTimer=0;
function notice(text){const n=$("#notice");n.textContent=text;n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{n.hidden=true;},5000);}

/* ---------- saving and loading ---------- */
function download(text,name){
  const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  notice("Saved. Load the file later to carry on from exactly this moment.");
}
async function loadFile(file){
  if(!file)return;
  try{post({type:"load",text:await file.text()});}catch(e){notice("That file couldn't be read.");}
}
$("#save").onclick=()=>post({type:"save"});
$("#load").onclick=()=>$("#load-file").click();
$("#load-file").addEventListener("change",e=>{loadFile(e.target.files[0]);e.target.value="";});
const stage=$(".stage");
stage.addEventListener("dragover",e=>{if([...e.dataTransfer.types].includes("Files")){e.preventDefault();stage.classList.add("drop");}});
stage.addEventListener("dragleave",()=>stage.classList.remove("drop"));
stage.addEventListener("drop",e=>{e.preventDefault();stage.classList.remove("drop");loadFile(e.dataTransfer.files[0]);});

/* ---------- input ---------- */
wc.addEventListener("pointerdown",e=>{
  if(!F)return;
  const r=wc.getBoundingClientRect(),V=view();
  const x=V.ox+(e.clientX-r.left)/r.width*V.vw,y=V.oy+(e.clientY-r.top)/r.height*V.vw;
  if(tool==="inspect"){
    const tol=Math.max(26/cam.z,24/(r.width/V.vw)),cr=F.cr;let best=0,bd=tol*tol;
    for(let i=0;i<cr.length;i+=STRIDE){const dx=cr[i+1]-x,dy=cr[i+2]-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=cr[i];}}
    select(best);
    return;
  }
  post({type:"tool",tool,x,y});
});

function setTool(t){
  tool=t;
  for(const b of document.querySelectorAll(".tools button"))b.setAttribute("aria-pressed",String(b.dataset.tool===t));
  const hint=$("#toolhint");
  if(TOOL_HINTS[t]){hint.textContent=TOOL_HINTS[t];hint.hidden=false;}else hint.hidden=true;
}
for(const b of document.querySelectorAll(".tools button"))b.addEventListener("click",()=>setTool(b.dataset.tool));

const playBtn=$("#play");
function syncPlay(){playBtn.textContent=running?"Pause":(F&&F.tick?"Resume":"Start");}
playBtn.onclick=()=>{running=!running;syncPlay();};
$("#speed").onclick=()=>{speedIx=(speedIx+1)%SPEEDS.length;$("#speed").textContent=`Speed ${SPEEDS[speedIx]}×`;};
function newWorld(s){post({type:"new",seed:s});}
$("#reset").onclick=()=>newWorld((Math.random()*1e9)|0);

/* ---------- main loop ---------- */
startEngine();
writeHash();buildInspector();updateSeedLine();syncPlay();
newWorld(seed);
function loop(){
  // ask for the next frame as soon as the last one is in; the simulation steps while this one draws
  if(!pending){pending=true;engine.post({type:"frame",run:running,speed:SPEEDS[speedIx],budget:engine.kind==="worker"?40:12});}
  drawWorld();
  if(selectedId)drawBrain();
  if(frame%6===0)drawChart();
  if(frame%10===0){updateStats();updateInspector();}
  frame++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
