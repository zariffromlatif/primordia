"use strict";
/*
 * Primordia experiments: questions answered by running twin islands that differ in one thing.
 * Island i of one arm and island i of the other share a seed, so they rise from the sea with the
 * same terrain and the same founders, and only the rule under test differs. A single pair would
 * prove little, since islands vary a lot, so each experiment runs several twins and counts how
 * many of them went the same way.
 * Pure logic, shared by experiments.html, its workers (src/lab.js) and Node (tools/experiment.js).
 * Depends on globals from src/sim.js.
 */
const SAMPLE=100; // ticks between measurements: one day

const MEASURES={
  grazers:{label:"Grazers",unit:"",digits:0,get:w=>w.nHerb},
  know:{label:"Grazers that know the safe plant",unit:"%",digits:0,get:w=>w.know*100},
  learn:{label:"Average learning rate",unit:"%",digits:2,get:w=>avgLearn(w)*100}
};

/* Each one is checked headless with npm run experiment before it goes on the page, and kept only
   if its twins agree clearly. Ornaments, eyes, hunters, thirst and winter were tried and showed no
   clear difference within a few years, or one not yet understood, so they aren't here. */
const EXPERIMENTS=[
  {id:"learning",question:"Does learning pay?",
    about:"Grazers must learn which plant colour is poisonous, because it can change every season. On one island of each pair, nobody can learn.",
    arms:[{label:"Can learn",rules:{}},{label:"Can't learn",rules:{genes:{learn:0}}}],
    measures:["grazers","know"],years:5,islands:6},
  {id:"poison",question:"What keeps learning alive?",
    about:"Learning costs energy, so evolution keeps it only where it pays. On one island of each pair there is no poison, so there is nothing worth learning about plants.",
    arms:[{label:"Poison",rules:{}},{label:"No poison",rules:{poison:false}}],
    measures:["learn"],years:8,islands:10}
];

function experiment(id){return EXPERIMENTS.find(x=>x.id===id)||null;}
function seedOf(i){return 1001+i;} // island i of every arm and every experiment

/* One island of one arm. Call run() until done(); each call steps up to n ticks and returns the
   measurements taken on the way, one list of values per day, in the experiment's measure order. */
function trial(exp,arm,island){
  const w=makeWorld(seedOf(island),[],exp.arms[arm].rules),end=exp.years*YEAR,get=exp.measures.map(k=>MEASURES[k].get);
  return{
    done:()=>w.tick>=end,
    tick:()=>w.tick,
    run(n){
      const out=[];
      for(let i=0;i<n&&w.tick<end;i++){step(w);if(w.tick%SAMPLE===0)out.push(get.map(f=>f(w)));}
      return out;
    }
  };
}

/* series[arm][island] is that island's list of daily measurements. Each measure is summed up over
   the final year: the mean of each arm, and how many twins came out higher in the second arm. */
function compare(exp,series){
  const last=Math.round(YEAR/SAMPLE),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  return exp.measures.map((k,m)=>{
    const end=series.map(arm=>arm.map(days=>mean(days.slice(-last).map(d=>d[m]))));
    let higher=0,lower=0;
    for(let i=0;i<exp.islands;i++){if(end[1][i]>end[0][i])higher++;else if(end[1][i]<end[0][i])lower++;}
    return{k,a:mean(end[0]),b:mean(end[1]),ends:end,higher,lower,n:exp.islands};
  });
}

/* How often chance alone would make at least this many of n twins all go the same way, as if a
   coin decided each pair: a two-sided sign test. */
function chance(same,n){
  let s=0,c=1;
  for(let k=0;k<=n;k++){if(k>=same)s+=c;c=c*(n-k)/(k+1);}
  return Math.min(1,2*s/2**n);
}

/* The result in words, for one measure. A difference counts as clear only when chance alone would
   produce that much agreement between twins less than 1 time in 20. */
function verdict(exp,r){
  const M=MEASURES[r.k],f=v=>v.toFixed(M.digits)+M.unit,[A,B]=exp.arms.map(a=>a.label.toLowerCase());
  const n=r.higher+r.lower,same=Math.max(r.higher,r.lower),dir=r.higher>r.lower?"higher":"lower",p=n?chance(same,n):1;
  const odds=p<0.01?"less than 1 time in 100":`about ${Math.round(p*100)} times in 100`;
  const head=`${M.label} over the last year: ${f(r.b)} with “${B}” against ${f(r.a)} with “${A}”.`;
  if(p<0.05)return{clear:true,p,text:`${head} On ${same} of ${n} pairs, the “${B}” twin came out ${dir}. Chance alone would do that ${odds}.`};
  return{clear:false,p,text:`${head} The twins split ${r.higher} higher and ${r.lower} lower. Chance alone would do that ${odds}, so this doesn't show a clear difference.`};
}

if (typeof module !== "undefined" && module.exports) module.exports = { EXPERIMENTS, MEASURES, SAMPLE, experiment, seedOf, trial, compare, chance, verdict };
