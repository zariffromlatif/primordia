"use strict";
/*
 * Primordia host: owns one world and talks to the page in messages. It normally runs inside a
 * Web Worker (src/worker.js), so a big population never stalls drawing. When workers aren't
 * available, for example when index.html is opened straight from disk, the page runs it itself.
 * Depends on globals from src/sim.js.
 *
 * Page to host:  new {seed}, load {text}, frame {run, speed, budget}, tool {tool, x, y},
 *                select {id}, save
 * Host to page:  world {seed, tick, loaded}, frame {...}, snapshot {text, name}, error {message}
 *                (a frame carries missing {id} when a selected creature was already gone)
 */
const STRIDE=11; // floats per creature in a frame: id, x, y, angle, radius, hue, diet, call, sick, eyes, field of view

function makeHost(send){
  let w=null,sel=null,missing=0,frames=0,sent=null;
  const now=typeof performance!=="undefined"?()=>performance.now():()=>Date.now();
  const reset=()=>{sel=null;missing=0;sent={terr:-1,hydro:-1,events:-1,slow:-1e9};};

  function begin(nw,loaded){
    w=nw;reset();
    send({type:"world",seed:w.seed,tick:w.tick,loaded:!!loaded});
  }

  function detail(c){
    const sp=w.species.get(c.sp);
    return{id:c.id,x:c.x,y:c.y,a:c.a,r:c.r,dead:c.dead,cause:c.cause,name:sp?sp.name:"Unknown",hue:sp?sp.hue:0,
      gen:c.gen,e:c.e,maxE:c.maxE,age:c.age,kids:c.kids,kills:c.kills,sick:c.sick,immune:c.immune,sig:c.sig,v:c.v,
      parentId:c.parentId,mateId:c.mateId,g:Object.assign({},c.g),
      inp:c.inp.slice(),hid:c.hid.slice(),out:c.out.slice(),w1:c.w1.slice(),w2:c.w2.slice()};
  }

  /* The slower-changing panels: species, the family tree, records and the chart's history. */
  function panels(){
    const rep=new Map();
    for(const c of w.creatures){if(c.dead)continue;const b=rep.get(c.sp);if(!b||c.gen>b.gen)rep.set(c.sp,c);}
    const species=[];
    for(const s of w.species.values())species.push({id:s.id,name:s.name,hue:s.hue,diet:s.diet,born:s.born,died:s.died,
      parentId:s.parentId,parentName:s.parentName,announced:s.announced,extinct:s.extinct,peak:s.peak,
      n:w.spCounts.get(s.id)||0,rep:rep.has(s.id)?rep.get(s.id).id:0});
    return{species,history:w.history,records:w.records,pairs:pairShare(w,40)};
  }

  function frame(m){
    if(m.run){
      const t0=now(),n=m.speed||1,budget=m.budget||40;
      for(let i=0;i<n;i++){step(w);if(now()-t0>budget)break;}
    }
    frames++;
    const C=w.creatures;let n=0;for(const c of C)if(!c.dead)n++;
    const cr=new Float32Array(n*STRIDE);let o=0;
    for(const c of C){
      if(c.dead)continue;
      const sp=w.species.get(c.sp);
      cr[o]=c.id;cr[o+1]=c.x;cr[o+2]=c.y;cr[o+3]=c.a;cr[o+4]=c.r;cr[o+5]=sp?sp.hue:0;
      cr[o+6]=c.g.diet;cr[o+7]=c.sig;cr[o+8]=c.sick?1:0;cr[o+9]=c.g.eyes;cr[o+10]=c.g.fov;o+=STRIDE;
    }
    const plant=w.plant.slice(),transfer=[cr.buffer,plant.buffer];
    const f={type:"frame",tick:w.tick,season:w.season,climate:w.climate?{kind:w.climate.kind,label:w.climate.label}:null,
      cr,plant,storms:w.storms.map(s=>({x:s.x,y:s.y,r:s.r,p:s.p*Math.sin(Math.PI*s.age/s.life)})),
      flashes:w.flashes.splice(0),stats:{herb:w.nHerb,carn:w.nCarn,species:w.spCounts.size,gen:w.maxGen}};
    if(w.terrVer!==sent.terr){
      sent.terr=w.terrVer;
      f.terrain={terr:w.terr.slice(),shade:w.shade.slice(),down:w.down.slice()};
      transfer.push(f.terrain.terr.buffer,f.terrain.shade.buffer,f.terrain.down.buffer);
    }
    if(w.hydroVer!==sent.hydro){
      sent.hydro=w.hydroVer;
      const moist=new Uint8Array(G*G);for(let k=0;k<G*G;k++)moist[k]=w.moist[k]*255;
      f.hydro={water:w.water.slice(),moist};
      transfer.push(f.hydro.water.buffer,moist.buffer);
    }
    if(w.eventCount!==sent.events){sent.events=w.eventCount;f.events=w.events.slice(0,10);}
    if(frames-sent.slow>=10){sent.slow=frames;f.panels=panels();}
    if(sel)f.sel=detail(sel);
    if(missing){f.missing=missing;missing=0;}
    send(f,transfer);
  }

  function handle(m){
    try{
      switch(m.type){
        case "new":begin(makeWorld(m.seed));break;
        case "load":{
          let o;
          try{o=JSON.parse(m.text);}catch(e){throw new Error("This file is not a saved Primordia island.");}
          begin(deserialize(o),true);
          break;
        }
        case "frame":if(w)frame(m);break;
        case "tool":{
          if(!w)break;
          const {x,y}=m;
          if(m.tool==="rain")rain(w,x,y);
          else if(m.tool==="hunters")dropHunters(w,x,y);
          else if(m.tool==="meteor")meteor(w,x,y);
          else if(m.tool==="plague")startPlague(w,x,y);
          census(w);sent.slow=-1e9;
          break;
        }
        case "select":
          sel=null;
          if(w&&m.id){for(const c of w.creatures)if(c.id===m.id){sel=c;break;}if(!sel)missing=m.id;}
          break;
        case "save":
          if(w)send({type:"snapshot",text:JSON.stringify(serialize(w)),name:`primordia-island-${w.seed}-day-${days(w.tick)}.json`});
          break;
      }
    }catch(e){
      send({type:"error",message:e&&e.message?e.message:String(e)});
    }
  }

  return{handle};
}

if (typeof module !== "undefined" && module.exports) module.exports = { makeHost, STRIDE };
