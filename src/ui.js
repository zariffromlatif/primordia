"use strict";
/* Primordia rendering, input and panels. Depends on globals from src/sim.js. */
(function(){
const $=s=>document.querySelector(s);
const dpr=Math.min(window.devicePixelRatio||1,2.5);
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPEEDS=[1,4,12];
const TOOL_HINTS={rain:"Tap the island to bring rain",hunters:"Tap the island to drop three hunters",meteor:"Tap the island to aim a meteor",plague:"Tap a crowd to start a plague"};
const FLASH={meteor:[255,160,60],rain:[90,170,255],plague:[180,120,255],hunters:[255,90,80]};

/* ---------- island links: #island-12345 reopens the same terrain ---------- */
function seedFromHash(){const m=/^#island-(\d{1,10})$/.exec(location.hash);return m?Number(m[1]):null;}
let seed=seedFromHash();if(seed===null)seed=(Math.random()*1e9)|0;
let world=makeWorld(seed);
let selected=null,follow=false,tool="inspect",speedIx=0,running=!reduce,frame=0,lastLogKey=-1;
const cam={x:W/2,y:W/2,z:1};
function writeHash(){if(location.hash!=="#island-"+seed){try{location.hash="island-"+seed;}catch(e){/* hash unavailable */}}}
writeHash();
window.addEventListener("hashchange",()=>{const s=seedFromHash();if(s!==null&&s!==seed)newWorld(s);});

const wc=$("#world"),ctx=wc.getContext("2d");
const off=document.createElement("canvas");off.width=G;off.height=G;
const octx=off.getContext("2d"),img=octx.createImageData(G,G);
const chartC=$("#chart"),cctx=chartC.getContext("2d");
const BASE=[[34,66,112],[62,108,156],[222,206,160],[176,150,104],[124,106,76],[146,144,138]];
const FULL=[[34,66,112],[58,128,128],[176,184,112],[94,152,72],[42,102,58],[124,134,112]];

let colors={};
function hexRgb(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(x=>x+x).join("");const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255];}
function readColors(){const cs=getComputedStyle(document.documentElement);for(const n of["ink","muted","line","surface","pos","neg","herb","carn","plant","accent"])colors[n]=cs.getPropertyValue("--"+n).trim()||"#888888";colors.posRgb=hexRgb(colors.pos);colors.negRgb=hexRgb(colors.neg);}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",readColors);
new MutationObserver(readColors).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

function fitCanvas(cv){if(!cv)return;const r=cv.getBoundingClientRect();const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h;}
const ro=new ResizeObserver(entries=>{for(const e of entries)fitCanvas(e.target);});
ro.observe(wc);ro.observe(chartC);

function spOf(c){return world.species.get(c.sp);}
function spColor(sp,hunt){const h=sp?sp.hue|0:0;return hunt?`hsl(${h} 72% 50%)`:`hsl(${h} 58% 60%)`;}
function italicName(who){const i=who.lastIndexOf(" #");return i<0?who:`<i>${who.slice(0,i)}</i>${who.slice(i)}`;}

/* ---------- camera ---------- */
function updateCam(){
  const tracking=follow&&selected,a=reduce?1:0.12;
  const tz=tracking?3:1,tx=tracking?selected.x:W/2,ty=tracking?selected.y:W/2;
  cam.z+=(tz-cam.z)*a;cam.x+=(tx-cam.x)*a;cam.y+=(ty-cam.y)*a;
}
function view(){const vw=W/cam.z;return{vw,ox:clamp(cam.x-vw/2,0,W-vw),oy:clamp(cam.y-vw/2,0,W-vw),k:wc.width/vw};}

/* ---------- world rendering ---------- */
function drawWorld(){
  updateCam();
  const cw=wc.width,ch=wc.height,V=view(),k=V.k;
  const d=img.data,P=world.plant,T=world.terr,S=world.shade,winter=(1-world.season)*0.24+(world.climate&&world.climate.kind==="freeze"?0.25:0);
  const dry=world.climate&&world.climate.kind==="drought"?0.18:0;
  for(let q=0;q<G*G;q++){
    const t=T[q],b=BASE[t],f=FULL[t],m=Math.min(1,Math.sqrt(P[q])*1.1),sh=S[q];
    let r=(b[0]+(f[0]-b[0])*m)*sh,g=(b[1]+(f[1]-b[1])*m)*sh,bl=(b[2]+(f[2]-b[2])*m)*sh;
    if(t>=SAND){r+=(236-r)*winter;g+=(240-g)*winter;bl+=(244-bl)*winter;r+=(214-r)*dry;g+=(176-g)*dry;bl+=(120-bl)*dry;}
    const o=q*4;d[o]=r;d[o+1]=g;d[o+2]=bl;d[o+3]=255;
  }
  octx.putImageData(img,0,0);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(off,V.ox/CELL,V.oy/CELL,V.vw/CELL,V.vw/CELL,0,0,cw,ch);

  const minR=3*dpr,grow=1.5/Math.sqrt(cam.z),pad=24*dpr;
  for(const c of world.creatures){
    if(c.dead)continue;
    const x=(c.x-V.ox)*k,y=(c.y-V.oy)*k;
    if(x<-pad||y<-pad||x>cw+pad||y>ch+pad)continue;
    const r=Math.max(c.r*k*grow,minR),a=c.a,sp=spOf(c),hunt=c.g.diet>0.5;
    if(c.sig>0.2){
      ctx.beginPath();ctx.arc(x,y,r+4*dpr,0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,236,150,${Math.min(0.9,c.sig).toFixed(2)})`;ctx.lineWidth=2.2*dpr;ctx.stroke();
    }
    ctx.lineWidth=Math.max(1,0.9*dpr);
    ctx.beginPath();
    if(hunt){
      ctx.moveTo(x+Math.cos(a)*r*1.6,y+Math.sin(a)*r*1.6);
      ctx.lineTo(x+Math.cos(a+2.5)*r*1.1,y+Math.sin(a+2.5)*r*1.1);
      ctx.lineTo(x+Math.cos(a-2.5)*r*1.1,y+Math.sin(a-2.5)*r*1.1);
      ctx.closePath();
      ctx.fillStyle=spColor(sp,true);ctx.fill();ctx.strokeStyle="rgba(30,8,8,.7)";ctx.stroke();
    }else{
      ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=spColor(sp,false);ctx.fill();ctx.strokeStyle="rgba(12,28,20,.55)";ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.stroke();
    }
    if(c.sick){ctx.beginPath();ctx.arc(x,y,Math.max(1.6*dpr,r*0.45),0,Math.PI*2);ctx.fillStyle="#9B5CFF";ctx.fill();}
  }
  if(selected){
    const c=selected,x=(c.x-V.ox)*k,y=(c.y-V.oy)*k,r=Math.max(c.r*k*grow,minR);
    ctx.save();
    ctx.lineWidth=2*dpr;ctx.strokeStyle=c.dead?"rgba(255,255,255,.5)":"#fff";
    ctx.beginPath();ctx.arc(x,y,r+6*dpr,0,Math.PI*2);ctx.stroke();
    if(!c.dead){
      ctx.setLineDash([4*dpr,5*dpr]);ctx.lineWidth=1*dpr;ctx.strokeStyle="rgba(255,255,255,.55)";
      ctx.beginPath();ctx.arc(x,y,c.g.sense*k,c.a-1.7,c.a+1.7);ctx.stroke();
    }
    ctx.restore();
  }
  for(let i=world.flashes.length-1;i>=0;i--){
    const f=world.flashes[i];f.life-=reduce?0.05:0.015;
    if(f.life<=0){world.flashes.splice(i,1);continue;}
    const col=FLASH[f.kind]||FLASH.meteor,R=f.r*k*(1.25-0.25*f.life);
    ctx.beginPath();ctx.arc((f.x-V.ox)*k,(f.y-V.oy)*k,R,0,Math.PI*2);
    ctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${(0.3*f.life).toFixed(3)})`;ctx.fill();
    ctx.lineWidth=3*dpr;ctx.strokeStyle=`rgba(${col[0]},${col[1]},${col[2]},${f.life.toFixed(3)})`;ctx.stroke();
  }
  const t=world.tick;
  $("#season").textContent=`Year ${yearOf(t)}, ${SEASONS[seasonOf(t)]}${world.climate?", "+world.climate.label:""}`;
}

/* ---------- chart: one band per species ---------- */
function drawChart(){
  const w=chartC.width,h=chartC.height,H=world.history;
  cctx.clearRect(0,0,w,h);
  cctx.strokeStyle=colors.line;cctx.lineWidth=1*dpr;
  cctx.beginPath();cctx.moveTo(0,h-0.5*dpr);cctx.lineTo(w,h-0.5*dpr);cctx.stroke();
  if(H.length<2)return;
  let maxTot=40,maxP=1;for(const s of H){const tot=s.h+s.c;if(tot>maxTot)maxTot=tot;if(s.p>maxP)maxP=s.p;}
  const n=H.length,X=i=>i/(n-1)*w,top=16*dpr,floor=h-1*dpr,span=floor-top;
  cctx.beginPath();cctx.moveTo(0,floor);
  H.forEach((s,i)=>cctx.lineTo(X(i),floor-s.p/maxP*span*0.9));
  cctx.lineTo(w,floor);cctx.closePath();
  cctx.globalAlpha=0.35;cctx.fillStyle=colors.plant;cctx.fill();cctx.globalAlpha=1;
  const ids=new Set();for(const s of H)for(const id in s.sp)ids.add(+id);
  const order=[...ids].sort((a,b)=>a-b),base=new Float32Array(n),tops=new Float32Array(n);
  for(const id of order){
    let any=false;
    for(let i=0;i<n;i++){const v=H[i].sp[id]||0;if(v)any=true;tops[i]=base[i]+v;}
    if(!any)continue;
    const sp=world.species.get(id);
    cctx.beginPath();
    for(let i=0;i<n;i++){const y=floor-tops[i]/maxTot*span;i?cctx.lineTo(X(i),y):cctx.moveTo(X(i),y);}
    for(let i=n-1;i>=0;i--)cctx.lineTo(X(i),floor-base[i]/maxTot*span);
    cctx.closePath();cctx.fillStyle=spColor(sp,sp&&sp.diet>0.5);cctx.fill();
    base.set(tops);
  }
  cctx.fillStyle=colors.muted;cctx.font=`${11*dpr}px "Bricolage Grotesque",system-ui,sans-serif`;cctx.textBaseline="top";
  cctx.fillText(`${maxTot} creatures`,2*dpr,0);
}

/* ---------- inspector ---------- */
const GENES=[
  {k:"size",label:"Body size",min:0.4,max:2.4,fmt:v=>"×"+v.toFixed(2)},
  {k:"speed",label:"Top speed",min:0.3,max:2.5,fmt:v=>"×"+v.toFixed(2)},
  {k:"sense",label:"Sight range",min:20,max:150,fmt:v=>Math.round(v)+""},
  {k:"diet",label:"Meat in diet",min:0,max:1,fmt:v=>Math.round(v*100)+"%"},
  {k:"mut",label:"Mutation rate",min:0.01,max:0.4,fmt:v=>(v*100).toFixed(1)+"%"}
];
const INPUT_LABELS=[];
for(let e=0;e<3;e++)for(let t=0;t<3;t++)INPUT_LABELS[e*3+t]=["Plants","Prey","Hunter"][t]+" "+["left","ahead","right"][e];
INPUT_LABELS.push("Energy","Water ahead","Pulse","Calls heard","Memory");
const OUTPUT_LABELS=["Turn","Speed","Call","Memory"];

function select(c){selected=c;if(!c)follow=false;buildInspector();}

function buildInspector(){
  const el=$("#inspector");
  if(!selected){
    el.innerHTML=`<h2>Creature</h2><p class="muted small">With Inspect on, tap any creature to read its genes, follow it around the island and watch its brain decide what to do next.</p>`;
    return;
  }
  const tri=selected.g.diet>0.5;
  el.innerHTML=`<div class="insp-head"><span class="sw${tri?" tri":""}" id="i-sw"></span><div class="grow"><h2 id="i-name"></h2><p class="muted small" id="i-role"></p></div></div>
  <div class="insp-actions"><button id="i-follow" aria-pressed="false">Follow</button><button class="ghost" id="i-close">Close</button></div>
  <p class="status" id="i-status"></p>
  <div class="meter"><span>Energy</span><div class="bar"><i id="i-energy"></i></div><em id="i-energy-v"></em></div>
  <dl class="facts"><div><dt>Age</dt><dd id="i-age"></dd></div><div><dt>Children</dt><dd id="i-kids"></dd></div><div><dt>Kills</dt><dd id="i-kills"></dd></div><div><dt>Health</dt><dd id="i-health"></dd></div></dl>
  <h3>Genes</h3>
  <div class="genes">${GENES.map(g=>`<span>${g.label}</span><div class="bar"><i id="g-${g.k}"></i></div><em id="gv-${g.k}"></em>`).join("")}</div>
  <h3>Brain</h3>
  <canvas id="brain" aria-label="Live diagram of this creature’s neural network"></canvas>
  <p class="muted small">Fourteen senses feed eight hidden neurons. They drive four outputs: turning, speed, a call that nearby creatures can hear, and a memory the brain reads back a moment later. Blue wiring excites, red inhibits, and brighter nodes are firing harder right now.</p>`;
  $("#i-close").onclick=()=>select(null);
  $("#i-follow").onclick=()=>{follow=!follow;syncFollow();};
  syncFollow();
  const bc=$("#brain");ro.observe(bc);fitCanvas(bc);
  updateInspector();
}
function syncFollow(){const b=$("#i-follow");if(!b)return;b.textContent=follow?"Stop following":"Follow";b.setAttribute("aria-pressed",String(follow));}

function mood(c){
  const i=c.inp;
  if(c.dead)return`Died: ${c.cause.charAt(0).toLowerCase()+c.cause.slice(1)}, at ${(c.age/100).toFixed(1)} days old.`;
  const threat=Math.max(i[2],i[5],i[8]),prey=Math.max(i[1],i[4],i[7]),plants=Math.max(i[0],i[3],i[6]);
  if(threat>0.25)return c.sig>0.4?"Spotted a hunter and is calling out.":"Spotted a hunter nearby.";
  if(c.sick)return"Sick with plague.";
  if(c.g.diet>0.5&&prey>0.2)return"Stalking prey.";
  if(c.sig>0.5)return"Calling out.";
  if(i[10]>0.9)return"Facing deep water.";
  if(c.e/c.maxE<0.25)return"Hungry and searching.";
  if(c.g.diet<=0.5&&plants>0.35)return"Grazing.";
  return c.v<0.4?"Resting.":"Wandering.";
}

function updateInspector(){
  const c=selected;if(!c||!$("#i-name"))return;
  const sp=spOf(c),hunt=c.g.diet>0.5;
  $("#i-sw").style.background=spColor(sp,hunt);
  $("#i-name").innerHTML=`<i>${sp?sp.name:"Unknown"}</i> #${c.id}`;
  $("#i-role").textContent=`${hunt?"Hunter":"Grazer"}, generation ${c.gen}`;
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
  const cv=$("#brain");if(!cv||!selected)return;
  const c=selected,bctx=cv.getContext("2d"),w=cv.width,h=cv.height;
  bctx.clearRect(0,0,w,h);
  const padL=88*dpr,padR=64*dpr,top=8*dpr,bot=8*dpr;
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
  for(let hh=0;hh<NH;hh++)for(let i=0;i<NI;i++)edge(xI,ys(NI,i),xH,ys(NH,hh),c.w1[hh*NI+i],c.inp[i]);
  for(let o=0;o<NO;o++)for(let hh=0;hh<NH;hh++)edge(xH,ys(NH,hh),xO,yO(o),c.w2[o*NH+hh],c.hid[hh]);
  // the memory output loops back to the memory input
  bctx.save();bctx.setLineDash([3*dpr,4*dpr]);bctx.strokeStyle=colors.muted;bctx.lineWidth=1*dpr;
  bctx.beginPath();bctx.moveTo(xO,yO(3)+7*dpr);bctx.bezierCurveTo(xO,h-2*dpr,xI,h-2*dpr,xI,ys(NI,13)+5*dpr);bctx.stroke();bctx.restore();
  const node=(x,y,act,r)=>{
    const col=act>=0?P:N;
    bctx.beginPath();bctx.arc(x,y,r,0,Math.PI*2);
    bctx.fillStyle=colors.surface;bctx.fill();
    bctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${clamp(Math.abs(act),0,1).toFixed(3)})`;bctx.fill();
    bctx.lineWidth=1*dpr;bctx.strokeStyle=colors.muted;bctx.stroke();
  };
  bctx.font=`${11*dpr}px "Bricolage Grotesque",system-ui,sans-serif`;bctx.textBaseline="middle";
  for(let i=0;i<NI;i++){node(xI,ys(NI,i),c.inp[i],4.5*dpr);bctx.fillStyle=colors.muted;bctx.textAlign="right";bctx.fillText(INPUT_LABELS[i],xI-9*dpr,ys(NI,i));}
  for(let hh=0;hh<NH;hh++)node(xH,ys(NH,hh),c.hid[hh],5.5*dpr);
  for(let o=0;o<NO;o++){node(xO,yO(o),c.out[o],7*dpr);bctx.fillStyle=colors.ink;bctx.textAlign="left";bctx.fillText(OUTPUT_LABELS[o],xO+11*dpr,yO(o));}
}

/* ---------- side panel ---------- */
function updateStats(){
  $("#s-herb").textContent=world.nHerb;
  $("#s-carn").textContent=world.nCarn;
  $("#s-species").textContent=world.spCounts.size;
  $("#s-gen").textContent=world.maxGen;
}

let speciesMembers=new Map();
function updateSpecies(){
  const best=new Map();
  for(const c of world.creatures){if(c.dead)continue;const b=best.get(c.sp);if(!b||c.gen>b.gen)best.set(c.sp,c);}
  const rows=[];for(const [id,n] of world.spCounts){const sp=world.species.get(id);if(sp&&best.get(id))rows.push({sp,n});}
  rows.sort((a,b)=>b.n-a.n);
  const top=rows.slice(0,6);
  speciesMembers=new Map(top.map(r=>[String(r.sp.id),best.get(r.sp.id)]));
  let extinct=0;for(const s of world.species.values())if(s.extinct&&s.peak>=5)extinct++;
  $("#species").innerHTML=top.length?top.map(({sp,n})=>{
    const hunt=sp.diet>0.5;
    return`<li><button class="lin" data-id="${sp.id}"><span class="sw${hunt?" tri":""}" style="background:${spColor(sp,hunt)}"></span><span class="grow"><b><i>${sp.name}</i></b><small>${n} alive, ${hunt?"hunters":"grazers"}, since day ${days(sp.born)}${sp.parentName?`, split from <i>${sp.parentName}</i>`:""}</small></span></button></li>`;
  }).join(""):`<li class="muted small">Nothing is alive yet.</li>`;
  $("#extinct").textContent=extinct?`${extinct} species ${extinct===1?"has":"have"} gone extinct on this island so far.`:"No species has gone extinct yet.";
}
$("#species").addEventListener("click",e=>{const b=e.target.closest(".lin");if(!b)return;const c=speciesMembers.get(b.dataset.id);if(c)select(c);});

function updateRecords(){
  const R=world.records;
  const rows=[
    ["Longest life",R.age.v?(R.age.v/100).toFixed(1)+" days":"",R.age.who],
    ["Most children",R.kids.v||"",R.kids.who],
    ["Most kills",R.kills.v||"",R.kills.who],
    ["Deepest generation",R.gen.v||"",R.gen.who]
  ];
  $("#records").innerHTML=rows.map(([label,v,who])=>`<div class="rec"><span>${label}</span><b>${v===""?"None yet":v}</b><small>${v===""?"":italicName(who)}</small></div>`).join("");
}

let nameRe=null,nameReSize=-1;
function italicizeSpecies(text){
  if(nameReSize!==world.species.size){
    const names=[...world.species.values()].map(s=>s.name).sort((x,y)=>y.length-x.length);
    nameRe=names.length?new RegExp("("+names.join("|")+")(?![a-z])","g"):null;nameReSize=world.species.size;
  }
  return nameRe?text.replace(nameRe,"<i>$1</i>"):text;
}
function updateLog(){
  if(world.eventCount===lastLogKey)return;lastLogKey=world.eventCount;
  $("#log").innerHTML=world.events.slice(0,10).map(e=>`<li><time>Day ${days(e.t)}</time><span>${italicizeSpecies(e.text)}</span></li>`).join("");
}

function updateSeedLine(){$("#seedline").textContent=`This is island ${seed}. Its link reopens the same terrain with a new history.`;}

/* ---------- input ---------- */
wc.addEventListener("pointerdown",e=>{
  const r=wc.getBoundingClientRect(),V=view();
  const x=V.ox+(e.clientX-r.left)/r.width*V.vw,y=V.oy+(e.clientY-r.top)/r.height*V.vw;
  if(tool==="inspect"){
    const tol=Math.max(26/cam.z,24/(r.width/V.vw));let best=null,bd=tol*tol;
    for(const c of world.creatures){if(c.dead)continue;const dx=c.x-x,dy=c.y-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=c;}}
    select(best);
    return;
  }
  if(tool==="rain")rain(world,x,y);
  else if(tool==="hunters")dropHunters(world,x,y);
  else if(tool==="meteor")meteor(world,x,y);
  else if(tool==="plague")startPlague(world,x,y);
  census(world);updateLog();updateStats();updateSpecies();
});

function setTool(t){
  tool=t;
  for(const b of document.querySelectorAll(".tools button"))b.setAttribute("aria-pressed",String(b.dataset.tool===t));
  const hint=$("#toolhint");
  if(TOOL_HINTS[t]){hint.textContent=TOOL_HINTS[t];hint.hidden=false;}else hint.hidden=true;
}
for(const b of document.querySelectorAll(".tools button"))b.addEventListener("click",()=>setTool(b.dataset.tool));

const playBtn=$("#play");
function syncPlay(){playBtn.textContent=running?"Pause":(world.tick?"Resume":"Start");}
playBtn.onclick=()=>{running=!running;syncPlay();};
$("#speed").onclick=()=>{speedIx=(speedIx+1)%SPEEDS.length;$("#speed").textContent=`Speed ${SPEEDS[speedIx]}×`;};
function newWorld(s){
  seed=s;world=makeWorld(seed);nameReSize=-1;select(null);cam.x=W/2;cam.y=W/2;cam.z=1;lastLogKey=-1;
  writeHash();updateSeedLine();updateLog();updateSpecies();updateRecords();updateStats();syncPlay();
}
$("#reset").onclick=()=>newWorld((Math.random()*1e9)|0);

/* ---------- main loop ---------- */
buildInspector();updateSeedLine();updateLog();updateSpecies();updateRecords();updateStats();syncPlay();
function loop(){
  if(running){const n=SPEEDS[speedIx];for(let i=0;i<n;i++)step(world);}
  drawWorld();
  if(selected)drawBrain();
  if(frame%6===0)drawChart();
  if(frame%10===0){updateStats();updateInspector();}
  if(frame%30===0){updateSpecies();updateRecords();updateLog();}
  frame++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
