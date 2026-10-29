"use strict";
/*
 * Primordia simulation core.
 * Pure logic with no DOM access, so it runs in the browser, in a Web Worker and in Node tests.
 * In the browser these top-level declarations are shared with src/host.js and src/ui.js.
 * Every random number comes from the world's own generator (w.rs), and everything a person does
 * is recorded with its tick (w.actions), so a seed and that record always replay the same history
 * and a saved snapshot carries on exactly where it left off.
 */
const W=1024,G=128,CELL=W/G,YEAR=4000,CAP=1000;
const MAX_EYES=6,PER_EYE=4,IE=MAX_EYES*PER_EYE,NI=IE+6,NH=8,NO=4; // 4 inputs per eye slot, then energy, water ahead, pulse, calls, memory, thirst
const SEE_PLANTS=0,SEE_PREY=1,SEE_HUNTER=2,SEE_WATER=3;           // what each eye reports
const DEEP=0,SHALLOW=1,SAND=2,GRASS=3,FOREST=4,ROCK=5;
const FERT=[0,0.25,0.15,1,0.85,0.05];
const MOVE=[0.3,0.6,0.95,1,0.85,0.65];
const EVAP=[0,0,1.5,1,0.7,1.3];   // how quickly each terrain dries out
const HARD=[1,1,0.6,1,1.6,4];      // how hard each terrain is to wear away: roots bind forest soil, rock barely gives
const SEA=0.36;                   // ground lower than this is under the sea
const LAKE=0.004;                 // standing water deeper than this is a lake
const RIVER=1.2,RIVER_SPAN=40;    // discharge where a stream shows, and the range up to a full river
const HYDRO_EVERY=20,ERODE_EVERY=200;
const BUCKET=64,BN=W/BUCKET;
const SEASONS=["spring","summer","autumn","winter"];
const SPECIES_GAP=0.6;      // genetic distance at which a new species is recognised
const PLAGUE_TICKS=700;     // how long an infection lasts
const MATURE=90,MATE_RANGE=26,REST=60,SELF_WAIT=200; // breeding age, how close a mate must be, pause after breeding, wait before budding alone
const FRESH_REACH=6;        // how many cells away an eye can make out fresh water

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function rnd(w){const a=w.rs=(w.rs+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}
function gauss(w){let u=0;while(u===0)u=rnd(w);return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd(w));}
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
  manyEyed:["argus","multoculata","panoptes"],oneEyed:["cyclops","monocula","unoculata"],farSighted:["telescopa","longinqua","prospectans"],
  keen:["oculata","vigilans","speculatrix"],showy:["ornata","pavonina","splendens","fulgens"],
  plain:["vulgaris","communis","pratensis","modesta","errans","placida","silvestris","litoralis","borealis","australis","mitis","simplex","nomada","herbivora","frugalis","humilis"]
};
function epithetPool(g){
  if(g.diet>0.5)return g.size>1.6?EPITHETS.hunterBig:g.speed>1.6?EPITHETS.hunterFast:EPITHETS.hunter;
  if(g.orn>0.65)return EPITHETS.showy;
  if(g.eyes>=5)return EPITHETS.manyEyed;
  if(g.eyes<=1)return EPITHETS.oneEyed;
  if(g.sense>150&&g.fov<2)return EPITHETS.farSighted;
  if(g.size>1.5)return EPITHETS.big;
  if(g.size<0.75)return EPITHETS.small;
  if(g.speed>1.5)return EPITHETS.fast;
  if(g.speed<0.8)return EPITHETS.slow;
  if(g.sense>110)return EPITHETS.keen;
  return EPITHETS.plain;
}
function dietWord(d){return d>0.5?"hunter":"grazer";}
function seasonOf(t){return Math.floor(((t+YEAR/8)%YEAR)/(YEAR/4));}
function yearOf(t){return Math.floor((t+YEAR/8)/YEAR)+1;}
function days(t){return Math.max(1,Math.round(t/100));}
function warmth(t){return 0.5+0.5*Math.sin(t/YEAR*Math.PI*2);}       // 1 in midsummer, 0 in midwinter
function wetness(t){return 1-0.4*Math.sin(t/YEAR*Math.PI*2);}         // dry summers, wet winters

function cellOf(x,y){const i=clamp((x/CELL)|0,0,G-1),j=clamp((y/CELL)|0,0,G-1);return j*G+i;}
function plantAt(w,x,y){if(x<0||y<0||x>=W||y>=W)return 0;return w.plant[cellOf(x,y)];}
function terrAt(w,x,y){if(x<0||y<0||x>=W||y>=W)return DEEP;return w.terr[cellOf(x,y)];}
function freshAt(w,x,y){if(x<0||y<0||x>=W||y>=W)return 0;return w.fresh[cellOf(x,y)];}
function waterAhead(w,x,y){if(x<0||y<0||x>=W||y>=W)return 1;const k=cellOf(x,y),t=w.terr[k];return t===DEEP?1:t===SHALLOW?0.5:w.water[k]/510;}
function bucketOf(x,y){const i=clamp((x/BUCKET)|0,0,BN-1),j=clamp((y/BUCKET)|0,0,BN-1);return j*BN+i;}
function classify(h){return h<0.30?DEEP:h<SEA?SHALLOW:h<0.40?SAND:h<0.60?GRASS:h<0.78?FOREST:ROCK;}
function isLake(w,k){return w.height[k]>=SEA&&w.fill[k]-w.height[k]>LAKE;}

function logEvent(w,text){w.events.unshift({t:w.tick,text});if(w.events.length>40)w.events.length=40;w.eventCount++;}

/* ---------------- world ---------------- */

/* Everything about a world except its living things. Snapshots rebuild worlds through here too. */
function initWorld(seed,height,fnoise){
  const N=G*G;
  const w={seed,rs:(Math.imul(seed|0,0x9E3779B1)^0x85EBCA6B)|0,height,fnoise,
    terr:new Uint8Array(N),fert:new Float32Array(N),plant:new Float32Array(N),shade:new Float32Array(N),
    fill:new Float32Array(N),down:new Int32Array(N),order:new Int32Array(N),
    fast:new Float32Array(N),base:new Float32Array(N),flow:new Float32Array(N),steady:new Float32Array(N),moist:new Float32Array(N),water:new Uint8Array(N),fresh:new Float32Array(N),rainBuf:new Float32Array(N),acc:new Float32Array(N),
    storms:[],wind:0,terrVer:0,hydroVer:0,actions:[],next:0,replayable:true,
    tick:0,season:0.5,creatures:[],nextId:1,maxGen:0,
    events:[],eventCount:0,history:[],buckets:Array.from({length:BN*BN},()=>[]),flashes:[],
    species:new Map(),nextSpecies:1,hueBase:0,spCounts:new Map(),
    climate:null,plagueActive:false,callingLogged:false,pairsLogged:false,eyeLog:false,
    lastCarnArrival:-99999,hadCarn:false,lowHerbLogged:false,lastConvertLog:-99999,
    births:0,pairBirths:0,deaths:0,lastBirths:0,lastPairBirths:0,thirstDead:0,nHerb:0,nCarn:0,nSick:0,nImmune:0,nCalling:0,
    records:{age:{v:0,who:""},kids:{v:0,who:""},kills:{v:0,who:""},gen:{v:0,who:""}}};
  reshape(w);
  return w;
}

/* A new island from its seed, plus any recorded actions to replay as their ticks come round. */
function makeWorld(seed,actions){
  const r=mulberry32(seed);
  const N=256,lat=new Float32Array(N*N);for(let i=0;i<lat.length;i++)lat[i]=r();
  const sm=t=>t*t*(3-2*t);
  const noise=(x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
    const g=(a,b)=>lat[(a&255)*N+(b&255)];
    const a=g(xi,yi),b=g(xi+1,yi),c=g(xi,yi+1),d=g(xi+1,yi+1),u=sm(xf),v=sm(yf);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
  const ox=r()*100,oy=r()*100;
  const fbm=(x,y)=>{let s=0,amp=0.5,f=1,n=0;for(let o=0;o<5;o++){s+=amp*noise(x*f+ox+o*31.7,y*f+oy+o*17.3);n+=amp;amp*=0.5;f*=2;}return s/n;};
  const height=new Float32Array(G*G),fnoise=new Float32Array(G*G),start=new Float32Array(G*G);
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i,nx=(i+0.5)/G,ny=(j+0.5)/G,dx=nx-0.5,dy=ny-0.5,d=Math.sqrt(dx*dx+dy*dy)*2;
    height[k]=fbm(nx*3.4,ny*3.4)*1.15-d*d*0.46+0.1;
    fnoise[k]=0.7+0.6*r();
    start[k]=0.3+0.6*r();
  }
  const w=initWorld(seed,height,fnoise);
  w.hueBase=r()*360;
  w.wind=r()*Math.PI*2;
  for(let k=0;k<G*G;k++){w.plant[k]=w.fert[k]*start[k];w.moist[k]=w.terr[k]<=SHALLOW?1:0.5;}
  for(let i=0;i<20;i++)hydro(w,true); // let the rivers find their beds before anything lives here
  for(let i=0;i<6;i++)spawnGroup(w,"herb",20);
  census(w);
  logEvent(w,"The island rose from the sea. Six species of grazers, 120 creatures with random brains, were released onto it.");
  sample(w);
  w.actions=(actions||[]).filter(a=>TOOL_CODES[a.tool]&&Number.isInteger(a.t)&&a.t>=0&&Number.isFinite(a.x)&&Number.isFinite(a.y))
    .map(a=>({t:a.t,tool:a.tool,x:Math.round(clamp(a.x,0,W-1)),y:Math.round(clamp(a.y,0,W-1))})).sort((a,b)=>a.t-b.t);
  replayDue(w);
  return w;
}

function randomLand(w){
  for(let tries=0;tries<400;tries++){
    const k=(rnd(w)*G*G)|0,t=w.terr[k];
    if((t===GRASS||t===FOREST||t===SAND)&&w.water[k]<255){const i=k%G,j=(k/G)|0;return{x:(i+rnd(w))*CELL,y:(j+rnd(w))*CELL};}
  }
  return{x:W/2,y:W/2};
}

/* ---------------- water ---------------- */

/* After the ground changes: terrain types, fertility, hill shading, drainage and lakes. */
function reshape(w){
  const H=w.height,T=w.terr,F=w.fert,S=w.shade,Q=w.fnoise;
  for(let k=0;k<G*G;k++)T[k]=classify(H[k]);
  drain(w);
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i;
    F[k]=Math.min(1,FERT[isLake(w,k)?SHALLOW:T[k]]*Q[k]);
    const hx=H[k]-H[j*G+Math.max(0,i-1)],hy=H[k]-H[Math.max(0,j-1)*G+i];
    S[k]=clamp(1+(hx+hy)*7,0.72,1.28);
  }
  route(w);
  updateWater(w);
  w.terrVer++;
}

/* Priority-flood. Starting from the sea, cells are visited from the lowest up, so each land cell
   is reached first from its lowest neighbour: that neighbour is where its water drains. Hollows
   are filled to their spill point, and the filled surface above the ground is a lake. */
const NB=[-1,0,1,0,0,-1,0,1,-1,-1,1,-1,-1,1,1,1];
function drain(w){
  const N=G*G,H=w.height,F=w.fill,D=w.down,O=w.order,seen=new Uint8Array(N),heap=new Int32Array(N);
  let hn=0;
  const push=k=>{let i=hn++;while(i>0){const p=(i-1)>>1;if(F[heap[p]]<=F[k])break;heap[i]=heap[p];i=p;}heap[i]=k;};
  const pop=()=>{const top=heap[0],last=heap[--hn];let i=0;
    for(;;){let c=2*i+1;if(c>=hn)break;if(c+1<hn&&F[heap[c+1]]<F[heap[c]])c++;if(F[heap[c]]>=F[last])break;heap[i]=heap[c];i=c;}
    heap[i]=last;return top;};
  for(let k=0;k<N;k++){
    const i=k%G,j=(k/G)|0;
    if(H[k]<SEA||i===0||j===0||i===G-1||j===G-1){F[k]=H[k];D[k]=-1;seen[k]=1;push(k);}
  }
  let n=0;
  while(hn){
    const k=pop();O[n++]=k;const i=k%G,j=(k/G)|0;
    for(let q=0;q<16;q+=2){
      const a=i+NB[q],b=j+NB[q+1];if(a<0||b<0||a>=G||b>=G)continue;
      const m=b*G+a;if(seen[m])continue;
      seen[m]=1;F[m]=Math.max(H[m],F[k]+1e-5);D[m]=k;push(m);
    }
  }
}

/* Sends each cell's water down the current drainage. Discharge is half quick runoff from recent
   rain, which swells after a storm, and half slow groundwater from the rain of past seasons, which
   keeps the big rivers running through a dry summer. Routing happens after the smoothing, so when
   a river changes course its old bed dries up at once. */
function route(w){
  const N=G*G,Fa=w.fast,Ba=w.base,Fl=w.flow,St=w.steady,O=w.order,D=w.down;
  for(let k=0;k<N;k++){Fl[k]=(Fa[k]+Ba[k])*0.5;St[k]=Ba[k];}
  for(let n=N-1;n>=0;n--){const k=O[n],d=D[k];if(d>=0){Fl[d]+=Fl[k];St[d]+=St[k];}}
}

/* How much water each cell shows: 255 for lakes, 1-254 for streams and rivers by discharge.
   A channel needs a steady supply, so storm runoff alone swells rivers but doesn't cut new ones. */
function updateWater(w){
  const Fl=w.flow,St=w.steady,Wt=w.water,T=w.terr,lr=Math.log(RIVER_SPAN);
  for(let k=0;k<G*G;k++){
    if(T[k]<=SHALLOW){Wt[k]=0;continue;}
    if(isLake(w,k)){Wt[k]=255;continue;}
    const f=Fl[k];Wt[k]=f>RIVER&&St[k]>RIVER*0.6?1+Math.min(253,(Math.log(f/RIVER)/lr*253)|0):0;
  }
  // How close the nearest fresh water is, for eyes to make out: 1 on the water, fading to nothing
  // FRESH_REACH cells away. A two-pass chamfer distance, forwards then backwards.
  const Fr=w.fresh,D2=Math.SQRT2;
  for(let k=0;k<G*G;k++)Fr[k]=Wt[k]>0?0:1e9;
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i;let d=Fr[k];if(d===0)continue;
    if(i>0)d=Math.min(d,Fr[k-1]+1);
    if(j>0){d=Math.min(d,Fr[k-G]+1);if(i>0)d=Math.min(d,Fr[k-G-1]+D2);if(i<G-1)d=Math.min(d,Fr[k-G+1]+D2);}
    Fr[k]=d;
  }
  for(let j=G-1;j>=0;j--)for(let i=G-1;i>=0;i--){
    const k=j*G+i;let d=Fr[k];if(d===0)continue;
    if(i<G-1)d=Math.min(d,Fr[k+1]+1);
    if(j<G-1){d=Math.min(d,Fr[k+G]+1);if(i<G-1)d=Math.min(d,Fr[k+G+1]+D2);if(i>0)d=Math.min(d,Fr[k+G-1]+D2);}
    Fr[k]=d;
  }
  for(let k=0;k<G*G;k++)Fr[k]=Math.max(0,1-Fr[k]/FRESH_REACH);
}

const CLIMATE_RAIN={drought:0.08,bloom:1.8,freeze:0.35};
/* Rain falls, runs downhill into rivers and soaks the ground. Runs every HYDRO_EVERY ticks. */
function hydro(w,warm){
  const N=G*G,H=w.height,R=w.rainBuf,M=w.moist,T=w.terr,Wt=w.water;
  const cr=w.climate?CLIMATE_RAIN[w.climate.kind]||1:1,wet=wetness(w.tick)*cr;
  if(!warm){
    w.wind+=gauss(w)*0.15;
    if(w.storms.length<4&&rnd(w)<0.05*wet){
      const sp=0.15+rnd(w)*0.25;
      w.storms.push({x:W*0.1+rnd(w)*W*0.8,y:W*0.1+rnd(w)*W*0.8,r:70+rnd(w)*90,vx:Math.cos(w.wind)*sp,vy:Math.sin(w.wind)*sp,age:0,life:(500+rnd(w)*900)|0,p:0.08+rnd(w)*0.12});
    }
  }
  for(let k=0;k<N;k++)R[k]=0.012*wet*(0.4+H[k]*1.2); // drizzle, heavier on high ground
  for(const s of w.storms){
    const p=s.p*Math.sin(Math.PI*s.age/s.life)*cr,r2=s.r*s.r;
    const i0=clamp(((s.x-s.r)/CELL)|0,0,G-1),i1=clamp(((s.x+s.r)/CELL)|0,0,G-1),j0=clamp(((s.y-s.r)/CELL)|0,0,G-1),j1=clamp(((s.y+s.r)/CELL)|0,0,G-1);
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=(i+0.5)*CELL-s.x,dy=(j+0.5)*CELL-s.y,d2=dx*dx+dy*dy;if(d2<r2)R[j*G+i]+=p*(1-d2/r2);}
  }
  const Fa=w.fast,Ba=w.base,af=warm?0.5:0.25,ab=warm?0.5:0.01;
  for(let k=0;k<N;k++){Fa[k]+=(R[k]-Fa[k])*af;Ba[k]+=(R[k]-Ba[k])*ab;}
  route(w);
  updateWater(w);
  const ev=0.05*(0.55+0.9*warmth(w.tick));
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const k=j*G+i,t=T[k];
    if(t<=SHALLOW||Wt[k]===255){M[k]=1;continue;}
    let rip=0;
    for(let b=Math.max(0,j-1);b<=Math.min(G-1,j+1);b++)for(let c=Math.max(0,i-1);c<=Math.min(G-1,i+1);c++){const v=Wt[b*G+c];if(v>rip)rip=v;}
    const m=M[k]+(R[k]*4+rip/255*0.12)*(1-M[k])-ev*EVAP[t]*M[k];
    M[k]=m<0?0:m>1?1:m;
  }
  w.hydroVer++;
}

/* Storms drift with the wind and fade out. */
function weather(w){
  for(let i=w.storms.length-1;i>=0;i--){const s=w.storms[i];s.age++;s.x+=s.vx;s.y+=s.vy;if(s.age>=s.life)w.storms.splice(i,1);}
}

/* Rivers carve their beds and drop what they carry where they slow down: in lakes, which slowly
   silt up, and at the coast, where deltas grow out into the sea. Runs every ERODE_EVERY ticks. */
const ERODE=0.002,CARRY=0.05;
function erode(w){
  const N=G*G,H=w.height,F=w.fill,Fl=w.flow,D=w.down,O=w.order,S=w.acc;
  S.fill(0);
  for(let n=N-1;n>=0;n--){
    const k=O[n],d=D[k];let s=S[k];
    if(d<0){
      if(s>0&&H[k]<SEA+0.02){
        const dep=Math.min(s*0.6,SEA+0.02-H[k]);H[k]+=dep;
        const i=k%G,j=(k/G)|0;
        for(let q=0;q<8;q+=2){const a=i+NB[q],b=j+NB[q+1];if(a<0||b<0||a>=G||b>=G)continue;const m=b*G+a;if(H[m]<SEA)H[m]+=Math.min(s*0.075,SEA-H[m]);}
      }
      continue;
    }
    const slope=H[k]-H[d];
    if(F[k]-H[k]>1e-4||slope<=0){const dep=Math.min(s*0.12,Math.max(0,F[k]-H[k])*0.5);H[k]+=dep;S[d]+=s-dep;continue;} // still water lets some of the load settle
    const cap=CARRY*Fl[k]*slope;
    if(s>cap){const dep=(s-cap)*0.4;H[k]+=dep;s-=dep;}
    else{const cut=Math.min(ERODE*Math.sqrt(Fl[k])*slope/HARD[w.terr[k]],cap-s,slope*0.4);H[k]-=cut;s+=cut;}
    S[d]+=s;
  }
  reshape(w);
}

/* ---------------- creatures ---------------- */

function randomGenome(w,carn){
  return{
    size:carn?1.1+rnd(w)*0.5:0.7+rnd(w)*0.7,
    speed:carn?1.1+rnd(w)*0.5:0.7+rnd(w)*0.7,
    sense:carn?70+rnd(w)*40:40+rnd(w)*50,
    diet:carn?0.75+rnd(w)*0.2:rnd(w)*0.25,
    mut:0.06+rnd(w)*0.08,
    eyes:3,
    fov:2.8+rnd(w)*1.2,
    orn:rnd(w)*0.3,
    pref:(rnd(w)-0.5)*0.4};
}

/* Inputs: four per eye slot (plants, prey, hunters, fresh water), filled only for the eyes the
   body has, from the leftmost eye to the rightmost; then energy, water ahead, pulse, calls heard,
   memory and thirst. Outputs: 0 turn, 1 speed, 2 call, 3 memory.
   Founders start with a few instincts wired into hidden neuron 0 (turning) and 1 (speed). */
function randomBrain(w,carn){
  const w1=new Float32Array(NI*NH),b1=new Float32Array(NH),w2=new Float32Array(NO*NH),b2=new Float32Array(NO);
  for(let i=0;i<w1.length;i++)w1[i]=gauss(w)*0.5;
  for(let i=0;i<NH;i++)b1[i]=gauss(w)*0.2;
  for(let i=0;i<w2.length;i++)w2[i]=gauss(w)*0.5;
  const k=(1+rnd(w)*1.2)*(rnd(w)<0.8?1:0.2);
  const pl=carn?0.2:1,eye=(e,t)=>e*PER_EYE+t,T=0,S=NI; // eyes 0, 1, 2 look left, ahead, right
  w1[T+eye(2,SEE_PLANTS)]+=k*pl;w1[T+eye(0,SEE_PLANTS)]-=k*pl;
  if(carn){w1[T+eye(2,SEE_PREY)]+=k;w1[T+eye(0,SEE_PREY)]-=k;}
  w1[T+eye(2,SEE_HUNTER)]-=k;w1[T+eye(0,SEE_HUNTER)]+=k;
  w1[T+eye(2,SEE_WATER)]+=0.3*k;w1[T+eye(0,SEE_WATER)]-=0.3*k;
  w1[T+IE+1]+=0.8*k;
  w2[0*NH+0]+=1.6;
  for(let e=0;e<3;e++)w1[S+eye(e,SEE_HUNTER)]+=k*0.8;
  if(carn)for(let e=0;e<3;e++)w1[S+eye(e,SEE_PREY)]+=k*0.8;
  w1[S+IE+5]+=0.4*k; // thirst hurries a creature along
  b1[1]+=0.3;w2[1*NH+1]+=1.4;b2[1]+=0.2;
  b2[2]-=0.8; // calling costs energy, so it starts mostly switched off
  return{w1,b1,w2,b2};
}

function shell(g,brain){
  const c={id:0,x:0,y:0,a:0,g,w1:brain.w1,b1:brain.b1,w2:brain.w2,b2:brain.b2,
    inp:new Float32Array(NI),hid:new Float32Array(NH),out:new Float32Array(NO),
    gen:0,age:0,kids:0,kills:0,cool:0,rest:0,wait:0,v:0,sig:0,mem:0,sick:0,immune:false,dead:false,cause:"",
    sp:0,parentId:0,mateId:0,e:0,h:1,maxAge:0,r:3+g.size*3.2,maxE:100*g.size};
  return c;
}

function makeCreature(w,x,y,g,brain,gen,parent,energy){
  const c=shell(g,brain);
  c.id=w.nextId++;c.x=x;c.y=y;c.a=rnd(w)*Math.PI*2;c.gen=gen;
  c.sp=parent?parent.sp:0;c.parentId=parent?parent.id:0;
  c.e=Math.min(energy,c.maxE);c.maxAge=2600+rnd(w)*900;
  return c;
}

/* A child of p alone, or of p and q. With two parents every body gene comes from one or the
   other, and so does each hidden neuron along with all of its wiring, so working circuits are
   passed on whole. Then everything mutates a little. */
function makeChild(w,p,q){
  const pick=()=>q&&rnd(w)<0.5?q:p;
  const m=q?(p.g.mut+q.g.mut)/2:p.g.mut;
  let eyes=pick().g.eyes;
  if(rnd(w)<m*0.25)eyes=clamp(eyes+(rnd(w)<0.5?-1:1),1,MAX_EYES);
  const g={
    size:clamp(pick().g.size+gauss(w)*m*0.4,0.4,2.4),
    speed:clamp(pick().g.speed+gauss(w)*m*0.4,0.3,2.5),
    sense:clamp(pick().g.sense+gauss(w)*m*25,20,220),
    diet:clamp(pick().g.diet+gauss(w)*m*0.25,0,1),
    mut:clamp(pick().g.mut*Math.exp(gauss(w)*0.15),0.01,0.4),
    eyes,
    fov:clamp(pick().g.fov+gauss(w)*m*1.2,0.5,6),
    orn:clamp(pick().g.orn+gauss(w)*m*0.3,0,1),
    pref:clamp(pick().g.pref+gauss(w)*m*0.4,-1,1)};
  const w1=new Float32Array(NI*NH),b1=new Float32Array(NH),w2=new Float32Array(NO*NH),b2=new Float32Array(NO);
  for(let h=0;h<NH;h++){
    const s=pick();
    w1.set(s.w1.subarray(h*NI,h*NI+NI),h*NI);b1[h]=s.b1[h];
    for(let o=0;o<NO;o++)w2[o*NH+h]=s.w2[o*NH+h];
  }
  for(let o=0;o<NO;o++)b2[o]=pick().b2[o];
  for(const a of [w1,b1,w2,b2])for(let i=0;i<a.length;i++)if(rnd(w)<0.25)a[i]+=gauss(w)*m*2.5;
  const ang=rnd(w)*Math.PI*2,cx=q?(p.x+q.x)/2:p.x,cy=q?(p.y+q.y)/2:p.y;
  const c=makeCreature(w,clamp(cx+Math.cos(ang)*p.r*2,5,W-5),clamp(cy+Math.sin(ang)*p.r*2,5,W-5),g,
    {w1,b1,w2,b2},(q?Math.max(p.gen,q.gen):p.gen)+1,p,0);
  if(q)c.mateId=q.id;
  return c;
}

/* A founder plus n-1 close relatives, recognised as one new species. */
function spawnGroup(w,kind,n,x,y){
  const carn=kind==="carn";
  const p=x===undefined?randomLand(w):{x:clamp(x,5,W-5),y:clamp(y,5,W-5)};
  const g=randomGenome(w,carn);
  const founder=makeCreature(w,p.x,p.y,g,randomBrain(w,carn),0,null,60*g.size);
  const sp=newSpecies(w,founder,null);
  founder.sp=sp.id;
  w.creatures.push(founder);
  for(let i=1;i<n;i++){
    const c=makeChild(w,founder);
    let nx=clamp(p.x+gauss(w)*45,5,W-5),ny=clamp(p.y+gauss(w)*45,5,W-5);
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
  const v=brainVec(rep);
  const taken=new Set([...w.species.values()].map(s=>s.name));
  const pool=epithetPool(rep.g),start=Math.floor(rnd(w)*pool.length);
  let name="";
  for(let i=0;i<pool.length&&!name;i++){const n=genus+" "+pool[(start+i)%pool.length];if(!taken.has(n))name=n;}
  for(let i=0;!name;i++){const p=EPITHETS.plain[i%EPITHETS.plain.length],n=genus+" "+p+(i>=EPITHETS.plain.length?" "+(ROMAN[2+Math.floor(i/EPITHETS.plain.length)-1]||i):"");if(!taken.has(n))name=n;}
  const sp={id,genus,name,hue:(w.hueBase+id*137.508)%360,repG:Object.assign({},rep.g),repW:v,
    count:0,peak:0,born:w.tick,died:0,parentId:parent?parent.id:0,parentName:parent?parent.name:"",
    announced:!parent,extinct:false,showy:false,diet:rep.g.diet};
  w.species.set(id,sp);
  return sp;
}

function brainVec(c){const v=new Float32Array(NI*NH+NO*NH);v.set(c.w1,0);v.set(c.w2,NI*NH);return v;}

/* Body genes plus the mean difference between brain weights. Only the eyes both sides
   actually have are compared, since the wiring of a missing eye drifts without consequence. */
function distTo(c,sp){
  const g=c.g,r=sp.repG,v=sp.repW,ne=Math.min(g.eyes,Math.round(r.eyes))*PER_EYE,n1=NI*NH;
  let s=0;
  for(let h=0;h<NH;h++){
    const o=h*NI;
    for(let i=0;i<ne;i++)s+=Math.abs(c.w1[o+i]-v[o+i]);
    for(let i=IE;i<NI;i++)s+=Math.abs(c.w1[o+i]-v[o+i]);
  }
  for(let i=0;i<NO*NH;i++)s+=Math.abs(c.w2[i]-v[n1+i]);
  return Math.abs(g.size-r.size)/2+Math.abs(g.speed-r.speed)/2.2+Math.abs(g.sense-r.sense)/130+Math.abs(g.diet-r.diet)*2
    +Math.abs(g.eyes-r.eyes)*0.08+Math.abs(g.fov-r.fov)/10+Math.abs(g.orn-r.orn)*0.4+Math.abs(g.pref-r.pref)*0.2
    +s/(NH*(ne+NI-IE)+NO*NH);
}

function assignSpecies(w){
  const alive=[],orphans=[];for(const s of w.species.values())if(!s.extinct){s.count=0;alive.push(s);}
  for(const c of w.creatures){
    if(c.dead)continue;
    let sp=w.species.get(c.sp);
    if(!sp||sp.extinct||distTo(c,sp)>SPECIES_GAP){
      let best=null,bd=SPECIES_GAP;
      for(const s of alive){const d=distTo(c,s);if(d<bd){bd=d;best=s;}}
      if(!best){orphans.push(c);continue;}
      c.sp=best.id;sp=best;
    }
    sp.count++;
  }
  // Creatures that fit no species found a new one together, as a group of at least three
  // that are close to each other. A lone outlier stays with the species it came from.
  for(let i=0;i<orphans.length;i++){
    const o=orphans[i];if(!o)continue;
    const ref={repG:o.g,repW:brainVec(o)},group=[o];
    for(let j=i+1;j<orphans.length;j++){const q=orphans[j];if(q&&distTo(q,ref)<SPECIES_GAP/2){group.push(q);orphans[j]=null;}}
    const old=w.species.get(o.sp);
    if(group.length>=3||!old||old.extinct){
      const sp=newSpecies(w,o,old||null);alive.push(sp);
      for(const c of group){c.sp=sp.id;sp.count++;}
    }else for(const c of group){
      let s=w.species.get(c.sp);
      if(!s||s.extinct){s=newSpecies(w,c,s||null);alive.push(s);c.sp=s.id;}
      s.count++;
    }
  }
  // Each species' reference point follows the average of its members, so a lineage
  // that drifts as a whole stays one species and only a real split creates a new one.
  const L=NI*NH+NO*NH,sums=new Map();
  for(const c of w.creatures){
    if(c.dead)continue;
    let a=sums.get(c.sp);
    if(!a){a={v:new Float32Array(L),size:0,speed:0,sense:0,diet:0,eyes:0,fov:0,orn:0,pref:0,n:0};sums.set(c.sp,a);}
    const v=a.v;for(let i=0;i<NI*NH;i++)v[i]+=c.w1[i];for(let i=0;i<NO*NH;i++)v[NI*NH+i]+=c.w2[i];
    a.size+=c.g.size;a.speed+=c.g.speed;a.sense+=c.g.sense;a.diet+=c.g.diet;a.eyes+=c.g.eyes;a.fov+=c.g.fov;a.orn+=c.g.orn;a.pref+=c.g.pref;a.n++;
  }
  for(const [id,a] of sums){
    const sp=w.species.get(id);if(!sp||a.n<3)continue;
    for(let i=0;i<L;i++)sp.repW[i]=a.v[i]/a.n;
    const R=sp.repG;
    R.size=a.size/a.n;R.speed=a.speed/a.n;R.sense=a.sense/a.n;R.diet=sp.diet=a.diet/a.n;R.eyes=a.eyes/a.n;R.fov=a.fov/a.n;
    R.orn=a.orn/a.n;R.pref=a.pref/a.n;
  }
  for(const s of alive){
    if(s.count>s.peak)s.peak=s.count;
    if(!s.announced&&s.count>=10){
      s.announced=true;
      logEvent(w,`A new species, ${s.name}, has split off from ${s.parentName}.`);
    }
    if(!s.showy&&s.count>=10&&s.repG.orn>0.65&&s.repG.pref>0.25){
      s.showy=true;
      logEvent(w,`Sexual selection is at work in ${s.name}. Its members choose showy mates, and their ornaments have grown to ${Math.round(s.repG.orn*100)}% of the most a body can carry.`);
    }
    if(s.count===0){
      s.extinct=true;s.died=w.tick;
      if(s.announced&&s.peak>=12)logEvent(w,`${s.name} went extinct after ${days(w.tick-s.born)} days.`);
    }
  }
}

/* ---------------- one creature, one tick ---------------- */

function live(w,c,babies){
  c.age++;if(c.cool>0)c.cool--;if(c.rest>0)c.rest--;
  if(c.sick>0){c.sick--;if(c.sick===0)c.immune=true;}
  const g=c.g,inp=c.inp,B=w.buckets,ne=g.eyes,half=g.fov/2,sec=g.fov/ne,ch=Math.cos(half);
  const ca=Math.cos(c.a),sa=Math.sin(c.a);
  // each eye looks down the middle of its own slice of the field of view
  inp.fill(0,0,IE);
  const pd=g.sense*0.55;
  for(let e=0;e<ne;e++){
    const an=c.a-half+(e+0.5)*sec,x=c.x+Math.cos(an)*pd,y=c.y+Math.sin(an)*pd;
    inp[e*PER_EYE+SEE_PLANTS]=plantAt(w,x,y);inp[e*PER_EYE+SEE_WATER]=freshAt(w,x,y);
  }
  const sr=g.sense,sr2=sr*sr;
  const bx0=clamp(((c.x-sr)/BUCKET)|0,0,BN-1),bx1=clamp(((c.x+sr)/BUCKET)|0,0,BN-1);
  const by0=clamp(((c.y-sr)/BUCKET)|0,0,BN-1),by1=clamp(((c.y+sr)/BUCKET)|0,0,BN-1);
  const hunter=g.diet>0.5,ready=c.rest===0&&c.age>MATURE&&c.e>c.maxE*0.8;
  let prey=null,preyD=1e9,mate=null,mateS=-1e9,heard=0;
  for(let by=by0;by<=by1;by++)for(let bx=bx0;bx<=bx1;bx++){
    const list=B[by*BN+bx];
    for(let n=0;n<list.length;n++){
      const o=list[n];if(o===c||o.dead)continue;
      const dx=o.x-c.x,dy=o.y-c.y,d2=dx*dx+dy*dy;if(d2>sr2)continue;
      const d=Math.sqrt(d2),cl=1-d/sr;
      if(c.sick>0&&o.sick===0&&!o.immune&&d<c.r+o.r+8&&rnd(w)<0.03)o.sick=PLAGUE_TICKS;
      if(o.sig*cl>heard)heard=o.sig*cl;
      const smaller=o.r<c.r*1.15,threat=o.g.diet>0.5&&c.r<o.r*1.15;
      if(hunter&&c.cool===0&&smaller&&d<c.r+o.r+1.5&&d<preyD){prey=o;preyD=d;}
      if(ready&&o.sp===c.sp&&o.rest===0&&o.age>MATURE&&o.e>o.maxE*0.5&&d<c.r+o.r+MATE_RANGE){
        // Choice is mutual: each side must not be put off by the other's ornament. Among the
        // acceptable, the one this creature likes best wins, and nearer breaks ties.
        const like=g.pref*(o.g.orn-0.5);
        if(like>-0.2&&o.g.pref*(g.orn-0.5)>-0.2&&like-d*0.002>mateS){mate=o;mateS=like-d*0.002;}
      }
      if(!smaller&&!threat)continue;
      const fx=dx*ca+dy*sa;if(fx<d*ch)continue; // outside the sight cone
      const b=Math.min(ne-1,((Math.atan2(dy*ca-dx*sa,fx)+half)/sec)|0)*PER_EYE;
      if(smaller){const vis=Math.min(1,cl*(1+0.6*o.g.orn));if(vis>inp[b+SEE_PREY])inp[b+SEE_PREY]=vis;} // ornaments catch the eye
      if(threat&&cl>inp[b+SEE_HUNTER])inp[b+SEE_HUNTER]=cl;
    }
  }
  inp[IE]=c.e/c.maxE;
  inp[IE+1]=waterAhead(w,c.x+ca*14,c.y+sa*14);
  inp[IE+2]=Math.sin(c.age*0.12);
  inp[IE+3]=heard;
  inp[IE+4]=c.mem;
  inp[IE+5]=1-c.h;
  // think
  const hid=c.hid,out=c.out;
  for(let h=0;h<NH;h++){let s=c.b1[h];const o=h*NI;for(let i=0;i<NI;i++)s+=c.w1[o+i]*inp[i];hid[h]=Math.tanh(s);}
  for(let k=0;k<NO;k++){let s=c.b2[k];const o=k*NH;for(let h=0;h<NH;h++)s+=c.w2[o+h]*hid[h];out[k]=Math.tanh(s);}
  // act
  c.a+=out[0]*0.2;
  c.sig=out[2]>0?out[2]:0;
  c.mem=out[3];
  const k0=cellOf(c.x,c.y),tt=w.terr[k0];
  const v=(out[1]+1)*0.5*g.speed*1.3*MOVE[tt]*(1-0.4*w.water[k0]/255)*(c.sick?0.7:1);
  let nx=c.x+Math.cos(c.a)*v,ny=c.y+Math.sin(c.a)*v;
  if(nx<4||nx>W-4){c.a=Math.PI-c.a;nx=clamp(nx,4,W-4);}
  if(ny<4||ny>W-4){c.a=-c.a;ny=clamp(ny,4,W-4);}
  c.x=nx;c.y=ny;c.v=v;
  const s=g.size;
  // wide, long sight cones cost more to run, and so do every extra eye and a showy ornament
  let cost=0.04*Math.pow(s,0.8)+0.028*v*v*s+0.0007*g.sense*(0.35+0.65*g.fov/3.4)+0.006+0.002*ne+0.022*g.diet+0.03*c.sig+0.012*g.orn;
  if(c.sick)cost+=0.07;
  if(tt===DEEP)cost+=0.12;
  if(c.h<0.25)cost+=0.06*(0.25-c.h)/0.25+(c.h<=0?0.1:0); // dehydration
  c.e-=cost;
  // Heat and hurry dry a body out. Rivers, lakes and puddles after rain fill it back up. Juicy
  // plants in damp soil help a little, and the blood of a fresh kill a lot.
  const k2=cellOf(c.x,c.y),mk=w.moist[k2];
  let hy=c.h-(0.0004+0.0006*w.season)*(1+0.4*v)*Math.pow(s,0.3);
  if(w.water[k2]>0)hy+=0.03;else if(mk>0.8)hy+=(mk-0.8)*0.03;
  const herb=1-g.diet,eff=herb*herb;
  if(eff>0.02){const p=w.plant[k2],amt=Math.min(p,0.045*s);w.plant[k2]=p-amt;c.e+=amt*22*eff;hy+=amt*0.04*mk;}
  if(prey&&!prey.dead){
    hy+=0.35;
    const psp=w.species.get(c.sp);
    prey.dead=true;prey.cause="Eaten by "+(psp?psp.name:"a hunter")+" #"+c.id;
    const me=(g.diet-0.5)*2;
    c.e+=(Math.max(0,prey.e)*0.7+30*prey.g.size)*(0.4+0.6*me);
    c.kills++;c.cool=30;
    if(prey.sick&&!c.immune&&!c.sick&&rnd(w)<0.5)c.sick=PLAGUE_TICKS;
  }
  c.h=hy<0?0:hy>1?1:hy;
  if(c.e>c.maxE)c.e=c.maxE;
  if(c.e<=0){
    c.dead=true;
    c.cause=c.sick?"Died of plague":c.h<=0?"Died of thirst":tt===DEEP?"Exhausted swimming in deep water":"Starved";
    if(c.h<=0)w.thirstDead++;
    return;
  }
  if(c.age>c.maxAge){c.dead=true;c.cause="Died of old age";return;}
  // Breed with a willing member of the same species close by. A creature that finds no mate
  // for a while buds on its own instead, so a lone pioneer can still found a population.
  if(ready&&w.creatures.length+babies.length<CAP){
    let ch=null;
    if(mate&&!mate.dead){
      ch=makeChild(w,c,mate);
      const ec=c.e*0.3,em=mate.e*0.3;
      c.e-=ec;mate.e-=em;ch.e=Math.min(ch.maxE,(ec+em)*0.85);
      mate.rest=REST;mate.kids++;w.pairBirths++;
    }else if(++c.wait>SELF_WAIT){
      const E=c.e;ch=makeChild(w,c);
      c.e=E*0.5;ch.e=Math.min(ch.maxE,E*0.42);
    }
    if(ch){
      c.rest=REST;c.wait=0;babies.push(ch);c.kids++;w.births++;
      if(c.g.diet<=0.5&&ch.g.diet>0.5&&w.tick-w.lastConvertLog>3000){
        w.lastConvertLog=w.tick;
        const sp=w.species.get(c.sp);
        logEvent(w,`A grazer of ${sp?sp.name:"the island"} gave birth to a meat-eater. Mutation crossed the line.`);
      }
      if(ch.gen>w.maxGen){
        w.maxGen=ch.gen;
        if(ch.gen%25===0){const sp=w.species.get(ch.sp);logEvent(w,`Generation ${ch.gen} was born: a ${dietWord(ch.g.diet)} of ${sp?sp.name:"unknown species"}.`);}
      }
      if(ch.g.eyes!==c.g.eyes&&(ch.g.eyes===MAX_EYES||ch.g.eyes===1)&&!w.eyeLog){
        w.eyeLog=true;
        const sp=w.species.get(c.sp);
        logEvent(w,`A ${ch.g.eyes===1?"one-eyed":`${MAX_EYES}-eyed`} ${dietWord(ch.g.diet)} was born to ${sp?sp.name:"the island"}.`);
      }
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
  w.history.push({h:w.nHerb,c:w.nCarn,p,sp,b:w.births-w.lastBirths,pb:w.pairBirths-w.lastPairBirths});
  w.lastBirths=w.births;w.lastPairBirths=w.pairBirths;
  if(w.history.length>360)w.history.shift();
  for(const c of w.creatures)if(!c.dead)checkRecords(w,c);
}

/* Share of births over the last n samples that had two parents, or -1 if there were too few. */
function pairShare(w,n){
  let b=0,pb=0;const H=w.history;
  for(let i=Math.max(0,H.length-n);i<H.length;i++){b+=H[i].b||0;pb+=H[i].pb||0;}
  return b>=40?pb/b:-1;
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
  drought:{label:"drought",mul:0.45,len:1000,start:"Drought. The summer rains have failed and plants are withering.",end:"The drought broke."},
  bloom:{label:"bloom",mul:1.6,len:1000,start:"A warm, wet spring. Storms roll in and plants are blooming everywhere.",end:"The bloom faded."},
  freeze:{label:"hard freeze",mul:0.08,len:1500,start:"A hard freeze set in. The rivers are slowing and this winter will be long.",end:"The freeze lifted."}
};
function rollClimate(w){
  const t=w.tick,q=seasonOf(t);
  if(!w.climate&&t>3000){
    const r=rnd(w);
    const kind=q===1&&r<0.2?"drought":q===0&&r<0.16?"bloom":q===3&&r<0.14?"freeze":null;
    if(kind){const C=CLIMATES[kind];w.climate={kind,label:C.label,mul:C.mul,until:t+C.len,end:C.end};logEvent(w,C.start);}
  }
  if(t>6000&&w.creatures.length>150&&!w.plagueActive&&rnd(w)<0.05){
    const alive=w.creatures.filter(c=>!c.dead);
    const c=alive[(rnd(w)*alive.length)|0];
    if(c){const sp=w.species.get(c.sp);startPlague(w,c.x,c.y,`A plague broke out among ${sp?sp.name:"the grazers"}.`);}
  }
}

/* ---------------- the tick ---------------- */

function step(w){
  const t=++w.tick;
  if(w.climate&&t>=w.climate.until){logEvent(w,w.climate.end);w.climate=null;}
  if(t%1000===500){ // a new season
    if(w.thirstDead>=15)logEvent(w,`${w.thirstDead} creatures died of thirst during the ${SEASONS[seasonOf(t-1)]}.`);
    w.thirstDead=0;
    rollClimate(w);
  }
  const sv=warmth(t);w.season=sv;
  weather(w);
  if(t%HYDRO_EVERY===0)hydro(w);
  if(t%ERODE_EVERY===0)erode(w);
  const grow=0.0031*(0.28+0.72*sv)*(w.climate?w.climate.mul:1);
  const P=w.plant,F=w.fert,M=w.moist;
  for(let k=0;k<P.length;k++){const f=F[k];if(f<=0)continue;let p=P[k];p+=grow*(0.45+1.1*M[k])*(p+0.03)*(1-p/f);P[k]=p<0?0:p;}
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
  if(t%1000===0){
    const ps=pairShare(w,40);
    if(!w.pairsLogged&&ps>0.6){w.pairsLogged=true;logEvent(w,`Most young now have two parents. ${Math.round(ps*100)}% of recent births came from pairs mixing their genes.`);}
    else if(w.pairsLogged&&ps>=0&&ps<0.25){w.pairsLogged=false;logEvent(w,"Mates have grown scarce. Most young are budding off a single parent again.");}
  }
  if(t%100===0)assignSpecies(w);
  if(t%25===0)sample(w);
  replayDue(w);
}

/* ---------------- interventions ---------------- */

function meteor(w,x,y){
  if(x===undefined){const p=randomLand(w);x=p.x;y=p.y;}
  const R=80;let killed=0;
  for(const c of w.creatures){const dx=c.x-x,dy=c.y-y;if(!c.dead&&dx*dx+dy*dy<R*R){c.dead=true;c.cause="Struck by a meteor";killed++;}}
  // the impact clears the plants and digs a crater, which rain can fill into a lake
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const px=(i+0.5)*CELL-x,py=(j+0.5)*CELL-y,d2=(px*px+py*py)/(R*R),k=j*G+i;
    if(d2<1){w.plant[k]=0;w.height[k]-=0.06*(1-d2);}
  }
  reshape(w);
  w.flashes.push({x,y,r:R,life:1,kind:"meteor"});
  logEvent(w,killed?`A meteor struck the island and killed ${killed} creature${killed===1?"":"s"}.`:"A meteor struck an empty stretch of the island.");
  return killed;
}

function rain(w,x,y){
  const R=100;
  for(let j=0;j<G;j++)for(let i=0;i<G;i++){
    const px=(i+0.5)*CELL-x,py=(j+0.5)*CELL-y,k=j*G+i;
    if(px*px+py*py<R*R&&w.terr[k]!==DEEP){w.plant[k]=Math.max(w.plant[k],Math.min(1,w.fert[k]*1.3+0.25));w.moist[k]=1;}
  }
  w.storms.push({x,y,r:R,vx:0,vy:0,age:0,life:400,p:0.3});
  w.hydroVer++;
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

/* ---------------- recorded actions ---------------- */

/* Everything a person does to an island is recorded with the tick it happened on, so a link can
   replay it at the same moment. Positions are rounded to whole units, live and replayed alike. */
const TOOL_CODES={rain:"r",hunters:"h",meteor:"m",plague:"p"};
const CODE_TOOLS={r:"rain",h:"hunters",m:"meteor",p:"plague"};

function applyTool(w,tool,x,y){
  if(tool==="rain")rain(w,x,y);
  else if(tool==="hunters")dropHunters(w,x,y);
  else if(tool==="meteor")meteor(w,x,y);
  else if(tool==="plague")startPlague(w,x,y);
}

/* Use a tool now, between ticks. Acting during a replay takes history somewhere new, so the
   actions still waiting to be replayed are dropped. */
function act(w,tool,x,y){
  if(!TOOL_CODES[tool])return false;
  x=Math.round(clamp(x,0,W-1));y=Math.round(clamp(y,0,W-1));
  w.actions.length=w.next;
  w.actions.push({t:w.tick,tool,x,y});w.next++;
  applyTool(w,tool,x,y);
  return true;
}

function replayDue(w){
  const A=w.actions;
  while(w.next<A.length&&A[w.next].t<=w.tick){const a=A[w.next++];applyTool(w,a.tool,a.x,a.y);}
}

/* Actions in a link: /m5000.512.300 is a meteor on tick 5000 at (512, 300). */
function encodeActions(list){return list.map(a=>`/${TOOL_CODES[a.tool]}${a.t}.${a.x}.${a.y}`).join("");}
function decodeActions(text){
  const out=[],re=/\/([rhmp])(\d{1,9})\.(\d{1,4})\.(\d{1,4})/g;let m;
  while((m=re.exec(text)))out.push({t:+m[2],tool:CODE_TOOLS[m[1]],x:Math.min(W-1,+m[3]),y:Math.min(W-1,+m[4])});
  return out.sort((a,b)=>a.t-b.t);
}

/* ---------------- snapshots ---------------- */

/* A snapshot is plain JSON. It holds everything that can't be worked out again, including the
   random generator's state, so a loaded world continues exactly as the saved one would have. */
const SNAPSHOT_VERSION=2;
const WORLD_KEYS=["seed","rs","tick","season","wind","storms","terrVer","hydroVer","actions","next","replayable","thirstDead",
  "nextId","maxGen","events","eventCount","history",
  "nextSpecies","hueBase","climate","plagueActive","callingLogged","pairsLogged","eyeLog","lastCarnArrival","hadCarn","lowHerbLogged",
  "lastConvertLog","births","pairBirths","deaths","lastBirths","lastPairBirths","records"];
const CREATURE_KEYS=["id","x","y","a","gen","age","kids","kills","cool","rest","wait","v","sig","mem","sick","immune","dead","cause",
  "sp","parentId","mateId","e","h","maxAge"];
const GRIDS=["height","fnoise","plant","fast","base","moist"];
const BRAIN=[["w1",NI*NH],["b1",NH],["w2",NO*NH],["b2",NO]];

function toB64(a){
  const u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let s="";
  for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));
  return btoa(s);
}
function fromB64(s,n){
  const bin=atob(s);if(bin.length!==n*4)throw new Error("This island file is damaged.");
  const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}

function serialize(w){
  const o={format:"primordia",version:SNAPSHOT_VERSION,savedAt:days(w.tick)};
  for(const k of WORLD_KEYS)o[k]=w[k];
  for(const k of GRIDS)o[k]=toB64(w[k]);
  o.creatures=w.creatures.map(c=>{
    const s={g:Object.assign({},c.g)};for(const k of CREATURE_KEYS)s[k]=c[k];
    const b=new Float32Array(NI*NH+NH+NO*NH+NO);let at=0;for(const [k] of BRAIN){b.set(c[k],at);at+=c[k].length;}
    s.brain=toB64(b);return s;
  });
  o.species=[...w.species.values()].map(s=>Object.assign({},s,{repG:Object.assign({},s.repG),repW:toB64(s.repW)}));
  return o;
}

/* Format 1 brains had three inputs per eye and no thirst. The new inputs start unwired, the new
   genes start neutral, and since format 1 kept no record of actions, the link can't replay it. */
function upgrade1(o){
  const NI1=23,IE1=18,remap=(src,dst)=>{
    for(let h=0;h<NH;h++){
      for(let e=0;e<MAX_EYES;e++)for(let t=0;t<3;t++)dst[h*NI+e*PER_EYE+t]=src[h*NI1+e*3+t];
      for(let n=0;n<5;n++)dst[h*NI+IE+n]=src[h*NI1+IE1+n];
    }
  };
  for(const s of o.creatures){
    const b=fromB64(s.brain,NI1*NH+NH+NO*NH+NO),nb=new Float32Array(NI*NH+NH+NO*NH+NO);
    remap(b,nb);nb.set(b.subarray(NI1*NH),NI*NH);
    s.brain=toB64(nb);s.g.orn=0;s.g.pref=0;s.h=1;
  }
  for(const s of o.species){
    const v=fromB64(s.repW,NI1*NH+NO*NH),nv=new Float32Array(NI*NH+NO*NH);
    remap(v,nv);nv.set(v.subarray(NI1*NH),NI*NH);
    s.repW=toB64(nv);s.repG.orn=0;s.repG.pref=0;s.showy=false;
  }
  return Object.assign(o,{version:2,actions:[],next:0,replayable:false,thirstDead:0});
}

function deserialize(o){
  if(!o||o.format!=="primordia")throw new Error("This file is not a saved Primordia island.");
  if(o.version===1)o=upgrade1(o);
  if(o.version!==SNAPSHOT_VERSION)throw new Error(`This island was saved in format ${o.version}, but this version of Primordia reads format ${SNAPSHOT_VERSION}.`);
  const N=G*G;
  const w=initWorld(o.seed,fromB64(o.height,N),fromB64(o.fnoise,N));
  for(const k of GRIDS.slice(2))w[k].set(fromB64(o[k],N));
  for(const k of WORLD_KEYS)if(k in o)w[k]=o[k];
  route(w);
  updateWater(w);
  for(const s of o.species){s.repW=fromB64(s.repW,NI*NH+NO*NH);w.species.set(s.id,s);}
  for(const s of o.creatures){
    const b=fromB64(s.brain,NI*NH+NH+NO*NH+NO),brain={};let at=0;
    for(const [k,n] of BRAIN){brain[k]=b.slice(at,at+n);at+=n;}
    const c=shell(s.g,brain);for(const k of CREATURE_KEYS)c[k]=s[k];
    w.creatures.push(c);
  }
  census(w);
  return w;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    W, G, CELL, NI, NH, NO, IE, MAX_EYES, PER_EYE, SEE_PLANTS, SEE_PREY, SEE_HUNTER, SEE_WATER, YEAR, CAP,
    DEEP, SHALLOW, SAND, GRASS, FOREST, ROCK, SEA, SPECIES_GAP, PLAGUE_TICKS, HYDRO_EVERY, ERODE_EVERY, REST, MATE_RANGE, MATURE,
    makeWorld, step, census, assignSpecies, distTo, meteor, rain, dropHunters, startPlague, hydro, erode, reshape, isLake,
    makeChild, spawnGroup, nameFor, seasonOf, yearOf, days, cellOf, terrAt, plantAt, pairShare, serialize, deserialize, rnd, warmth,
    act, encodeActions, decodeActions, toB64, fromB64,
  };
}
