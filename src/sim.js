"use strict";
/*
 * Primordia simulation core.
 * Pure logic with no DOM access, so it runs in the browser and in Node tests.
 * In the browser these top-level declarations are shared with src/ui.js.
 */
const W=1024,G=128,CELL=W/G,NI=14,NH=8,NO=4,YEAR=4000,CAP=380;
const DEEP=0,SHALLOW=1,SAND=2,GRASS=3,FOREST=4,ROCK=5;
const FERT=[0,0.25,0.15,1,0.85,0.05];
const MOVE=[0.3,0.6,0.95,1,0.85,0.65];
const EYES=[-0.7,0,0.7];
const BUCKET=64,BN=W/BUCKET;
const SEASONS=["spring","summer","autumn","winter"];
const SPECIES_GAP=0.6;      // genetic distance at which a new species is recognised
const PLAGUE_TICKS=700;     // how long an infection lasts

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function gauss(){let u=0;while(u===0)u=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*Math.random());}
function clamp(v,a,b){return v<a?a:v>b?b:v;}

const SYL=["ka","lo","mi","ra","ve","zu","to","shi","na","pe","or","il","an","ex","qua","dri","sa","yo","fen","bel","tor","vi"];
function nameFor(id){
  const r=mulberry32(id*9973+17);const k=2+Math.floor(r()*2);let s="";
  for(let i=0;i<k;i++)s+=SYL[Math.floor(r()*SYL.length)];
  return s[0].toUpperCase()+s.slice(1);
}
const ROMAN=["","","II","III","IV","V","VI","VII","VIII","IX","X"];
const EPITHETS={
  hunterBig:["tyrannus","rex","gigas"],hunterFast:["rapax","celer","praedator"],hunter:["ferox","lupina","vorax","sanguinea"],
  big:["magna","grandis","robusta"],small:["minima","parva","pusilla"],fast:["velox","volans","agilis"],slow:["lenta","tarda","quieta"],
  keen:["oculata","vigilans","speculatrix"],
  plain:["vulgaris","communis","pratensis","modesta","errans","placida","silvestris","litoralis","borealis","australis","mitis","simplex","nomada","herbivora","frugalis","humilis"]
};
function epithetPool(g){
  if(g.diet>0.5)return g.size>1.6?EPITHETS.hunterBig:g.speed>1.6?EPITHETS.hunterFast:EPITHETS.hunter;
  if(g.size>1.5)return EPITHETS.big;
  if(g.size<0.75)return EPITHETS.small;
  if(g.speed>1.5)return EPITHETS.fast;
  if(g.speed<0.8)return EPITHETS.slow;
  if(g.sense>100)return EPITHETS.keen;
  return EPITHETS.plain;
}
function dietWord(d){return d>0.5?"hunter":"grazer";}
function seasonOf(t){return Math.floor(((t+YEAR/8)%YEAR)/(YEAR/4));}
function yearOf(t){return Math.floor((t+YEAR/8)/YEAR)+1;}
function days(t){return Math.max(1,Math.round(t/100));}

function cellOf(x,y){const i=clamp((x/CELL)|0,0,G-1),j=clamp((y/CELL)|0,0,G-1);return j*G+i;}
function plantAt(w,x,y){if(x<0||y<0||x>=W||y>=W)return 0;return w.plant[cellOf(x,y)];}
function terrAt(w,x,y){if(x<0||y<0||x>=W||y>=W)return DEEP;return w.terr[cellOf(x,y)];}
function bucketOf(x,y){const i=clamp((x/BUCKET)|0,0,BN-1),j=clamp((y/BUCKET)|0,0,BN-1);return j*BN+i;}

function logEvent(w,text){w.events.unshift({t:w.tick,text});if(w.events.length>40)w.events.length=40;w.eventCount++;}

/* ---------------- world ---------------- */

function makeWorld(seed){
  const r=mulberry32(seed);
  const N=256,lat=new Float32Array(N*N);for(let i=0;i<lat.length;i++)lat[i]=r();
  const sm=t=>t*t*(3-2*t);
  const noise=(x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
    const g=(a,b)=>lat[(a&255)*N+(b&255)];
    const a=g(xi,yi),b=g(xi+1,yi),c=g(xi,yi+1),d=g(xi+1,yi+1),u=sm(xf),v=sm(yf);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
  const ox=r()*100,oy=r()*100;
  const fbm=(x,y)=>{let s=0,amp=0.5,f=1,n=0;for(let o=0;o<5;o++){s+=amp*noise(x*f+ox+o*31.7,y*f+oy+o*17.3);n+=amp;amp*=0.5;f*=2;}return s/n;};
  const terr=new Uint8Array(G*G),fert=new Float32Array(G*G),plant=new Float32Array(G*G),height=new Float32Array(G*G),shade=new Float32Array(G*G);
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i,nx=(i+0.5)/G,ny=(j+0.5)/G,dx=nx-0.5,dy=ny-0.5,d=Math.sqrt(dx*dx+dy*dy)*2;
    const h=fbm(nx*3.4,ny*3.4)*1.15-d*d*0.46+0.1;
    height[k]=h;
    const t=h<0.30?DEEP:h<0.36?SHALLOW:h<0.40?SAND:h<0.60?GRASS:h<0.78?FOREST:ROCK;
    terr[k]=t;
    fert[k]=Math.min(1,FERT[t]*(0.7+0.6*r()));
    plant[k]=fert[k]*(0.3+0.6*r());
  }
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i;
    const hx=height[k]-height[j*G+Math.max(0,i-1)];
    const hy=height[k]-height[Math.max(0,j-1)*G+i];
    shade[k]=clamp(1+(hx+hy)*7,0.72,1.28);
  }
  const w={seed,terr,fert,plant,height,shade,tick:0,season:0.5,creatures:[],nextId:1,maxGen:0,
    events:[],eventCount:0,history:[],buckets:Array.from({length:BN*BN},()=>[]),flashes:[],
    species:new Map(),nextSpecies:1,hueBase:r()*360,spCounts:new Map(),
    climate:null,plagueActive:false,callingLogged:false,
    lastCarnArrival:-99999,hadCarn:false,lowHerbLogged:false,lastConvertLog:-99999,
    births:0,deaths:0,nHerb:0,nCarn:0,nSick:0,nImmune:0,nCalling:0,
    records:{age:{v:0,who:""},kids:{v:0,who:""},kills:{v:0,who:""},gen:{v:0,who:""}}};
  for(let i=0;i<6;i++)spawnGroup(w,"herb",20);
  census(w);
  logEvent(w,"The island rose from the sea. Six species of grazers, 120 creatures with random brains, were released onto it.");
  sample(w);
  return w;
}

function randomLand(w){
  for(let tries=0;tries<400;tries++){
    const k=(Math.random()*G*G)|0,t=w.terr[k];
    if(t===GRASS||t===FOREST||t===SAND){const i=k%G,j=(k/G)|0;return{x:(i+Math.random())*CELL,y:(j+Math.random())*CELL};}
  }
  return{x:W/2,y:W/2};
}

/* ---------------- creatures ---------------- */

function randomGenome(carn){
  return{
    size:carn?1.1+Math.random()*0.5:0.7+Math.random()*0.7,
    speed:carn?1.1+Math.random()*0.5:0.7+Math.random()*0.7,
    sense:carn?70+Math.random()*40:40+Math.random()*50,
    diet:carn?0.75+Math.random()*0.2:Math.random()*0.25,
    mut:0.06+Math.random()*0.08};
}

/* Inputs: 0-8 eyes (plants, prey, hunter) x (left, ahead, right), 9 energy,
   10 water ahead, 11 pulse, 12 calls heard, 13 memory.
   Outputs: 0 turn, 1 speed, 2 call, 3 memory. */
function randomBrain(carn){
  const w1=new Float32Array(NI*NH),b1=new Float32Array(NH),w2=new Float32Array(NO*NH),b2=new Float32Array(NO);
  for(let i=0;i<w1.length;i++)w1[i]=gauss()*0.5;
  for(let i=0;i<NH;i++)b1[i]=gauss()*0.2;
  for(let i=0;i<w2.length;i++)w2[i]=gauss()*0.5;
  const k=(1+Math.random()*1.2)*(Math.random()<0.8?1:0.2);
  const pl=carn?0.2:1;
  w1[0*NI+6]+=k*pl;w1[0*NI+0]-=k*pl;
  if(carn){w1[0*NI+7]+=k;w1[0*NI+1]-=k;}
  w1[0*NI+8]-=k;w1[0*NI+2]+=k;
  w1[0*NI+10]+=0.8*k;
  w2[0*NH+0]+=1.6;
  for(const i of [2,5,8])w1[1*NI+i]+=k*0.8;
  if(carn)for(const i of [1,4,7])w1[1*NI+i]+=k*0.8;
  b1[1]+=0.3;w2[1*NH+1]+=1.4;b2[1]+=0.2;
  b2[2]-=0.8; // calling costs energy, so it starts mostly switched off
  return{w1,b1,w2,b2};
}

function makeCreature(w,x,y,g,brain,gen,parent,energy){
  const c={id:w.nextId++,x,y,a:Math.random()*Math.PI*2,g,
    w1:brain.w1,b1:brain.b1,w2:brain.w2,b2:brain.b2,
    inp:new Float32Array(NI),hid:new Float32Array(NH),out:new Float32Array(NO),
    gen,age:0,kids:0,kills:0,cool:0,v:0,sig:0,mem:0,sick:0,immune:false,dead:false,cause:"",
    sp:parent?parent.sp:0,parentId:parent?parent.id:0};
  c.r=3+g.size*3.2;c.maxE=100*g.size;c.e=Math.min(energy,c.maxE);c.maxAge=2600+Math.random()*900;
  return c;
}

function makeChild(w,p){
  const m=p.g.mut;
  const g={
    size:clamp(p.g.size+gauss()*m*0.4,0.4,2.4),
    speed:clamp(p.g.speed+gauss()*m*0.4,0.3,2.5),
    sense:clamp(p.g.sense+gauss()*m*25,20,150),
    diet:clamp(p.g.diet+gauss()*m*0.25,0,1),
    mut:clamp(p.g.mut*Math.exp(gauss()*0.15),0.01,0.4)};
  const cp=a=>{const o=new Float32Array(a);for(let i=0;i<o.length;i++)if(Math.random()<0.25)o[i]+=gauss()*m*2.5;return o;};
  const ang=Math.random()*Math.PI*2;
  return makeCreature(w,clamp(p.x+Math.cos(ang)*p.r*2,5,W-5),clamp(p.y+Math.sin(ang)*p.r*2,5,W-5),g,
    {w1:cp(p.w1),b1:cp(p.b1),w2:cp(p.w2),b2:cp(p.b2)},p.gen+1,p,0);
}

/* A founder plus n-1 close relatives, recognised as one new species. */
function spawnGroup(w,kind,n,x,y){
  const carn=kind==="carn";
  const p=x===undefined?randomLand(w):{x:clamp(x,5,W-5),y:clamp(y,5,W-5)};
  const g=randomGenome(carn);
  const founder=makeCreature(w,p.x,p.y,g,randomBrain(carn),0,null,60*g.size);
  const sp=newSpecies(w,founder,null);
  founder.sp=sp.id;
  w.creatures.push(founder);
  for(let i=1;i<n;i++){
    const c=makeChild(w,founder);
    let nx=clamp(p.x+gauss()*45,5,W-5),ny=clamp(p.y+gauss()*45,5,W-5);
    if(terrAt(w,nx,ny)===DEEP){nx=p.x;ny=p.y;}
    c.x=nx;c.y=ny;c.gen=0;c.parentId=0;c.e=Math.min(c.maxE,60*c.g.size);
    w.creatures.push(c);
  }
  return sp;
}

/* ---------------- species ---------------- */

function newSpecies(w,rep,parent){
  const id=w.nextSpecies++;
  let genus=parent?parent.genus:"";
  if(genus){let k=0;for(const s of w.species.values())if(s.genus===genus)k++;if(k>=6)genus="";}
  if(!genus)genus=nameFor(id*31+(w.seed%997));
  const v=new Float32Array(NI*NH+NO*NH);v.set(rep.w1,0);v.set(rep.w2,NI*NH);
  const taken=new Set([...w.species.values()].map(s=>s.name));
  const pool=epithetPool(rep.g),start=Math.floor(Math.random()*pool.length);
  let name="";
  for(let i=0;i<pool.length&&!name;i++){const n=genus+" "+pool[(start+i)%pool.length];if(!taken.has(n))name=n;}
  for(let i=0;!name;i++){const p=EPITHETS.plain[i%EPITHETS.plain.length],n=genus+" "+p+(i>=EPITHETS.plain.length?" "+(ROMAN[2+Math.floor(i/EPITHETS.plain.length)-1]||i):"");if(!taken.has(n))name=n;}
  const sp={id,genus,name,hue:(w.hueBase+id*137.508)%360,repG:Object.assign({},rep.g),repW:v,
    count:0,peak:0,born:w.tick,died:0,parentId:parent?parent.id:0,parentName:parent?parent.name:"",
    announced:!parent,extinct:false,diet:rep.g.diet};
  w.species.set(id,sp);
  return sp;
}

function distTo(c,sp){
  const g=c.g,r=sp.repG,v=sp.repW,n1=NI*NH;
  let s=0;
  for(let i=0;i<n1;i++)s+=Math.abs(c.w1[i]-v[i]);
  for(let i=0;i<NO*NH;i++)s+=Math.abs(c.w2[i]-v[n1+i]);
  return Math.abs(g.size-r.size)/2+Math.abs(g.speed-r.speed)/2.2+Math.abs(g.sense-r.sense)/130+Math.abs(g.diet-r.diet)*2+s/v.length;
}

function assignSpecies(w){
  const alive=[];for(const s of w.species.values())if(!s.extinct){s.count=0;alive.push(s);}
  for(const c of w.creatures){
    if(c.dead)continue;
    let sp=w.species.get(c.sp);
    if(!sp||sp.extinct||distTo(c,sp)>SPECIES_GAP){
      let best=null,bd=SPECIES_GAP;
      for(const s of alive){const d=distTo(c,s);if(d<bd){bd=d;best=s;}}
      if(!best){best=newSpecies(w,c,sp||null);alive.push(best);}
      c.sp=best.id;sp=best;
    }
    sp.count++;
  }
  // Each species' reference point follows the average of its members, so a lineage
  // that drifts as a whole stays one species and only a real split creates a new one.
  const L=NI*NH+NO*NH,sums=new Map();
  for(const c of w.creatures){
    if(c.dead)continue;
    let a=sums.get(c.sp);
    if(!a){a={v:new Float32Array(L),size:0,speed:0,sense:0,diet:0,n:0};sums.set(c.sp,a);}
    const v=a.v;for(let i=0;i<NI*NH;i++)v[i]+=c.w1[i];for(let i=0;i<NO*NH;i++)v[NI*NH+i]+=c.w2[i];
    a.size+=c.g.size;a.speed+=c.g.speed;a.sense+=c.g.sense;a.diet+=c.g.diet;a.n++;
  }
  for(const [id,a] of sums){
    const sp=w.species.get(id);if(!sp||a.n<3)continue;
    for(let i=0;i<L;i++)sp.repW[i]=a.v[i]/a.n;
    sp.repG.size=a.size/a.n;sp.repG.speed=a.speed/a.n;sp.repG.sense=a.sense/a.n;sp.repG.diet=sp.diet=a.diet/a.n;
  }
  for(const s of alive){
    if(s.count>s.peak)s.peak=s.count;
    if(!s.announced&&s.count>=10){
      s.announced=true;
      logEvent(w,`A new species, ${s.name}, has split off from ${s.parentName}.`);
    }
    if(s.count===0){
      s.extinct=true;s.died=w.tick;
      if(s.announced&&s.peak>=12)logEvent(w,`${s.name} went extinct after ${days(w.tick-s.born)} days.`);
    }
  }
}

/* ---------------- one creature, one tick ---------------- */

function live(w,c,babies){
  c.age++;if(c.cool>0)c.cool--;
  if(c.sick>0){c.sick--;if(c.sick===0)c.immune=true;}
  const g=c.g,inp=c.inp,B=w.buckets;
  const ca=Math.cos(c.a),sa=Math.sin(c.a);
  for(let e=0;e<3;e++){
    const an=c.a+EYES[e],d=g.sense*0.55;
    inp[e*3]=plantAt(w,c.x+Math.cos(an)*d,c.y+Math.sin(an)*d);inp[e*3+1]=0;inp[e*3+2]=0;
  }
  const sr=g.sense,sr2=sr*sr;
  const bx0=clamp(((c.x-sr)/BUCKET)|0,0,BN-1),bx1=clamp(((c.x+sr)/BUCKET)|0,0,BN-1);
  const by0=clamp(((c.y-sr)/BUCKET)|0,0,BN-1),by1=clamp(((c.y+sr)/BUCKET)|0,0,BN-1);
  const hunter=g.diet>0.5;
  let prey=null,preyD=1e9,heard=0;
  for(let by=by0;by<=by1;by++)for(let bx=bx0;bx<=bx1;bx++){
    const list=B[by*BN+bx];
    for(let n=0;n<list.length;n++){
      const o=list[n];if(o===c||o.dead)continue;
      const dx=o.x-c.x,dy=o.y-c.y,d2=dx*dx+dy*dy;if(d2>sr2)continue;
      const d=Math.sqrt(d2),cl=1-d/sr;
      if(c.sick>0&&o.sick===0&&!o.immune&&d<c.r+o.r+8&&Math.random()<0.03)o.sick=PLAGUE_TICKS;
      if(o.sig*cl>heard)heard=o.sig*cl;
      const smaller=o.r<c.r*1.15;
      if(hunter&&c.cool===0&&smaller&&d<c.r+o.r+1.5&&d<preyD){prey=o;preyD=d;}
      let rel=Math.atan2(dy,dx)-c.a;
      rel=((rel+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
      if(rel<-1.7||rel>1.7)continue;
      const e=rel<-0.35?0:rel>0.35?2:1;
      if(smaller&&cl>inp[e*3+1])inp[e*3+1]=cl;
      if(o.g.diet>0.5&&c.r<o.r*1.15&&cl>inp[e*3+2])inp[e*3+2]=cl;
    }
  }
  inp[9]=c.e/c.maxE;
  const ta=terrAt(w,c.x+ca*14,c.y+sa*14);inp[10]=ta===DEEP?1:ta===SHALLOW?0.5:0;
  inp[11]=Math.sin(c.age*0.12);
  inp[12]=heard;
  inp[13]=c.mem;
  // think
  const hid=c.hid,out=c.out;
  for(let h=0;h<NH;h++){let s=c.b1[h];const o=h*NI;for(let i=0;i<NI;i++)s+=c.w1[o+i]*inp[i];hid[h]=Math.tanh(s);}
  for(let k=0;k<NO;k++){let s=c.b2[k];const o=k*NH;for(let h=0;h<NH;h++)s+=c.w2[o+h]*hid[h];out[k]=Math.tanh(s);}
  // act
  c.a+=out[0]*0.2;
  c.sig=out[2]>0?out[2]:0;
  c.mem=out[3];
  const tt=w.terr[cellOf(c.x,c.y)];
  const v=(out[1]+1)*0.5*g.speed*1.3*MOVE[tt]*(c.sick?0.7:1);
  let nx=c.x+Math.cos(c.a)*v,ny=c.y+Math.sin(c.a)*v;
  if(nx<4||nx>W-4){c.a=Math.PI-c.a;nx=clamp(nx,4,W-4);}
  if(ny<4||ny>W-4){c.a=-c.a;ny=clamp(ny,4,W-4);}
  c.x=nx;c.y=ny;c.v=v;
  const s=g.size;
  let cost=0.04*Math.pow(s,0.8)+0.028*v*v*s+0.0007*g.sense+0.012+0.022*g.diet+0.03*c.sig;
  if(c.sick)cost+=0.07;
  if(tt===DEEP)cost+=0.12;
  c.e-=cost;
  const herb=1-g.diet,eff=herb*herb;
  if(eff>0.02){const k2=cellOf(c.x,c.y),p=w.plant[k2],amt=Math.min(p,0.045*s);w.plant[k2]=p-amt;c.e+=amt*22*eff;}
  if(prey&&!prey.dead){
    const psp=w.species.get(c.sp);
    prey.dead=true;prey.cause="Eaten by "+(psp?psp.name:"a hunter")+" #"+c.id;
    const me=(g.diet-0.5)*2;
    c.e+=(Math.max(0,prey.e)*0.7+30*prey.g.size)*(0.4+0.6*me);
    c.kills++;c.cool=30;
    if(prey.sick&&!c.immune&&!c.sick&&Math.random()<0.5)c.sick=PLAGUE_TICKS;
  }
  if(c.e>c.maxE)c.e=c.maxE;
  if(c.e<=0){c.dead=true;c.cause=c.sick?"Died of plague":tt===DEEP?"Exhausted swimming in deep water":"Starved";return;}
  if(c.age>c.maxAge){c.dead=true;c.cause="Died of old age";return;}
  if(c.e>c.maxE*0.8&&c.age>90&&w.creatures.length+babies.length<CAP){
    const E=c.e,ch=makeChild(w,c);
    c.e=E*0.5;ch.e=Math.min(ch.maxE,E*0.42);
    babies.push(ch);c.kids++;w.births++;
    if(c.g.diet<=0.5&&ch.g.diet>0.5&&w.tick-w.lastConvertLog>3000){
      w.lastConvertLog=w.tick;
      const sp=w.species.get(c.sp);
      logEvent(w,`A grazer of ${sp?sp.name:"the island"} gave birth to a meat-eater. Mutation crossed the line.`);
    }
    if(ch.gen>w.maxGen){
      w.maxGen=ch.gen;
      if(ch.gen%25===0){const sp=w.species.get(ch.sp);logEvent(w,`Generation ${ch.gen} was born: a ${dietWord(ch.g.diet)} of ${sp?sp.name:"unknown species"}.`);}
    }
  }
}

/* ---------------- bookkeeping ---------------- */

function whoIs(w,c){const sp=w.species.get(c.sp);return(sp?sp.name:"Unknown")+" #"+c.id;}
function checkRecords(w,c){
  const R=w.records;
  if(c.age>R.age.v){R.age.v=c.age;R.age.who=whoIs(w,c);}
  if(c.kids>R.kids.v){R.kids.v=c.kids;R.kids.who=whoIs(w,c);}
  if(c.kills>R.kills.v){R.kills.v=c.kills;R.kills.who=whoIs(w,c);}
  if(c.gen>R.gen.v){R.gen.v=c.gen;R.gen.who=whoIs(w,c);}
}

function sample(w){
  let p=0;const P=w.plant;for(let k=0;k<P.length;k++)p+=P[k];
  const sp={};for(const [id,n] of w.spCounts)sp[id]=n;
  w.history.push({h:w.nHerb,c:w.nCarn,p,sp});
  if(w.history.length>360)w.history.shift();
  for(const c of w.creatures)if(!c.dead)checkRecords(w,c);
}

function census(w){
  let herb=0,carn=0,sick=0,immune=0,calling=0;const sc=new Map();
  for(const c of w.creatures){
    if(c.dead)continue;
    if(c.g.diet>0.5)carn++;else herb++;
    if(c.sick)sick++;if(c.immune)immune++;if(c.sig>0.3)calling++;
    sc.set(c.sp,(sc.get(c.sp)||0)+1);
  }
  w.nHerb=herb;w.nCarn=carn;w.nSick=sick;w.nImmune=immune;w.nCalling=calling;w.spCounts=sc;
}

const CLIMATES={
  drought:{label:"drought",mul:0.3,len:1000,start:"Drought. The summer rains have failed and plants are withering.",end:"The drought broke."},
  bloom:{label:"bloom",mul:1.9,len:1000,start:"A warm, wet spring. Plants are blooming everywhere.",end:"The bloom faded."},
  freeze:{label:"hard freeze",mul:0.08,len:1500,start:"A hard freeze set in. This winter will be long.",end:"The freeze lifted."}
};
function rollClimate(w){
  const t=w.tick,q=seasonOf(t);
  if(!w.climate&&t>3000){
    const r=Math.random();
    const kind=q===1&&r<0.2?"drought":q===0&&r<0.16?"bloom":q===3&&r<0.14?"freeze":null;
    if(kind){const C=CLIMATES[kind];w.climate={kind,label:C.label,mul:C.mul,until:t+C.len,end:C.end};logEvent(w,C.start);}
  }
  if(t>6000&&w.creatures.length>150&&!w.plagueActive&&Math.random()<0.05){
    const alive=w.creatures.filter(c=>!c.dead);
    const c=alive[(Math.random()*alive.length)|0];
    if(c){const sp=w.species.get(c.sp);startPlague(w,c.x,c.y,`A plague broke out among ${sp?sp.name:"the grazers"}.`);}
  }
}

/* ---------------- the tick ---------------- */

function step(w){
  const t=++w.tick;
  if(w.climate&&t>=w.climate.until){logEvent(w,w.climate.end);w.climate=null;}
  if(t%1000===500)rollClimate(w);
  const sv=0.5+0.5*Math.sin(t/YEAR*Math.PI*2);w.season=sv;
  const grow=0.0031*(0.28+0.72*sv)*(w.climate?w.climate.mul:1);
  const P=w.plant,F=w.fert;
  for(let k=0;k<P.length;k++){const f=F[k];if(f<=0)continue;let p=P[k];p+=grow*(p+0.03)*(1-p/f);P[k]=p<0?0:p;}
  const B=w.buckets;for(let i=0;i<B.length;i++)B[i].length=0;
  const C=w.creatures;
  for(const c of C)if(!c.dead)B[bucketOf(c.x,c.y)].push(c);
  const babies=[];
  for(const c of C)if(!c.dead)live(w,c,babies);
  let n=0;
  for(const c of C){
    if(c.dead){w.deaths++;checkRecords(w,c);const k=cellOf(c.x,c.y);P[k]=Math.min(1,P[k]+0.2*c.g.size);}
    else C[n++]=c;
  }
  C.length=n;
  for(const b of babies)C.push(b);
  census(w);
  const herb=w.nHerb,carn=w.nCarn,alive=herb+carn;
  if(herb<12&&t%300===0){
    spawnGroup(w,"herb",10);
    if(!w.lowHerbLogged){logEvent(w,"Grazers nearly died out. New ones are drifting in from the coast.");w.lowHerbLogged=true;}
  }
  if(herb>60)w.lowHerbLogged=false;
  if(carn===0&&w.hadCarn){logEvent(w,"The last hunter died. Grazers have the island to themselves, for now.");w.hadCarn=false;}
  if(carn>0)w.hadCarn=true;
  if(carn===0&&t>1500&&herb>80&&t-w.lastCarnArrival>3000){
    const sp=spawnGroup(w,"carn",5);
    w.lastCarnArrival=t;w.hadCarn=true;
    logEvent(w,`Five hunters of a new species, ${sp.name}, washed ashore on driftwood.`);
  }
  if(w.plagueActive&&w.nSick===0){w.plagueActive=false;logEvent(w,w.nImmune?`The plague burned out. ${w.nImmune} survivor${w.nImmune===1?" is":"s are"} now immune.`:"The plague burned out. None of the infected survived.");}
  if(!w.callingLogged&&alive>80&&w.nCalling>alive*0.35){w.callingLogged=true;logEvent(w,`Calling has evolved. ${Math.round(w.nCalling/alive*100)}% of creatures are now signaling to each other.`);}
  else if(w.callingLogged&&alive>80&&w.nCalling<alive*0.05){w.callingLogged=false;logEvent(w,"Calling has fallen out of use.");}
  if(t%100===0)assignSpecies(w);
  if(t%25===0)sample(w);
}

/* ---------------- interventions ---------------- */

function meteor(w,x,y){
  if(x===undefined){const p=randomLand(w);x=p.x;y=p.y;}
  const R=80;let killed=0;
  for(const c of w.creatures){const dx=c.x-x,dy=c.y-y;if(!c.dead&&dx*dx+dy*dy<R*R){c.dead=true;c.cause="Struck by a meteor";killed++;}}
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){const px=(i+0.5)*CELL-x,py=(j+0.5)*CELL-y;if(px*px+py*py<R*R)w.plant[j*G+i]=0;}
  w.flashes.push({x,y,r:R,life:1,kind:"meteor"});
  logEvent(w,killed?`A meteor struck the island and killed ${killed} creature${killed===1?"":"s"}.`:"A meteor struck an empty stretch of the island.");
  return killed;
}

function rain(w,x,y){
  const R=100;
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const px=(i+0.5)*CELL-x,py=(j+0.5)*CELL-y,k=j*G+i;
    if(px*px+py*py<R*R&&w.terr[k]!==DEEP)w.plant[k]=Math.max(w.plant[k],Math.min(1,w.fert[k]*1.3+0.25));
  }
  w.flashes.push({x,y,r:R,life:1,kind:"rain"});
}

function dropHunters(w,x,y){
  const sp=spawnGroup(w,"carn",3,x,y);
  w.hadCarn=true;
  w.flashes.push({x,y,r:40,life:1,kind:"hunters"});
  logEvent(w,`Three hunters of a new species, ${sp.name}, were dropped onto the island.`);
  return sp;
}

function startPlague(w,x,y,message){
  const R=70;let n=0;
  for(const c of w.creatures){if(c.dead||c.immune)continue;const dx=c.x-x,dy=c.y-y;if(dx*dx+dy*dy<R*R){c.sick=PLAGUE_TICKS;n++;}}
  if(n===0){
    let best=null,bd=Infinity;
    for(const c of w.creatures){if(c.dead||c.immune)continue;const dx=c.x-x,dy=c.y-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=c;}}
    if(best){best.sick=PLAGUE_TICKS;n=1;x=best.x;y=best.y;}
  }
  w.flashes.push({x,y,r:R,life:1,kind:"plague"});
  if(n){w.plagueActive=true;logEvent(w,message||`Plague broke out. ${n} creature${n===1?" was":"s were"} infected.`);}
  return n;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    W, G, CELL, NI, NH, NO, YEAR, CAP, DEEP, SHALLOW, SAND, GRASS, FOREST, ROCK, SPECIES_GAP, PLAGUE_TICKS,
    makeWorld, step, census, assignSpecies, distTo, meteor, rain, dropHunters, startPlague,
    makeChild, spawnGroup, nameFor, seasonOf, yearOf, cellOf, terrAt, plantAt,
  };
}
