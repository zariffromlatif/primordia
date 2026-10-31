"use strict";
/* The experiments page. Runs an experiment's twin islands, in Web Workers when the page is served
   and in the page itself when it isn't, and draws each measure as the days come in.
   Uses EXPERIMENTS, MEASURES, SAMPLE, trial, compare and verdict from src/experiments.js. */
(function(){
const $=(s,el)=>(el||document).querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const PLOT_H=190,TOP=18,BOTTOM=26,LEFT=46,RIGHT=60; // chart geometry, in CSS pixels
const PER_YEAR=YEAR/SAMPLE;                          // measurements per island per year
const NUMBERS=["no","one","two","three","four","five","six","seven","eight","nine","ten"];
const cap=w=>w[0].toUpperCase()+w.slice(1);

/* ---------- engines ---------- */

let workers=false; // whether experiments can run in workers; settled by probe() before any run
function probe(){
  return new Promise(ok=>{
    let w;try{w=new Worker("src/lab.js");}catch(e){return ok(false);} // pages opened from disk can't start workers
    const give=v=>{clearTimeout(t);w.terminate();ok(v);},t=setTimeout(()=>give(false),4000);
    w.onmessage=()=>give(true);
    w.onerror=e=>{e.preventDefault();give(false);};
    w.postMessage("ping");
  });
}

/* Runs every island of an experiment, twins side by side. Calls got(arm, island, days) as
   measurements arrive and finished() once every island is done. Returns a function that stops it. */
function start(exp,got,finished){
  const jobs=[];for(let island=0;island<exp.islands;island++)for(let arm=0;arm<2;arm++)jobs.push({arm,island});
  let left=jobs.length,stopped=false;
  const one=()=>{if(--left===0&&!stopped)finished();};
  if(workers){
    const lanes=Math.max(1,Math.min(8,(navigator.hardwareConcurrency||4)-1,jobs.length)),pool=[];
    const next=w=>{const j=jobs.shift();if(j)w.postMessage({id:exp.id,arm:j.arm,island:j.island});else w.terminate();};
    for(let i=0;i<lanes;i++){
      const w=new Worker("src/lab.js");pool.push(w);
      w.onmessage=e=>{const m=e.data;if(m.days&&m.days.length)got(m.arm,m.island,m.days);if(m.done){one();next(w);}};
      next(w);
    }
    return()=>{stopped=true;for(const w of pool)w.terminate();};
  }
  // In the page, every island takes a short turn in rotation, so the page stays responsive.
  let i=0;
  const slice=()=>{
    if(stopped)return;
    const t0=performance.now();
    while(jobs.length&&performance.now()-t0<12){
      i%=jobs.length;const j=jobs[i];
      if(!j.t)j.t=trial(exp,j.arm,j.island);
      const days=j.t.run(100);
      if(days.length)got(j.arm,j.island,days);
      if(j.t.done()){jobs.splice(i,1);one();}else i++;
    }
    if(jobs.length)setTimeout(slice,0);
  };
  slice();
  return()=>{stopped=true;};
}

/* ---------- charts ---------- */

/* A clean scale from 0 with about four steps. Percentages that get past half run to 100. */
function scale(max,pct){
  if(pct&&max>50)return{top:100,step:25};
  if(!(max>0))return{top:pct?100:10,step:pct?25:2.5};
  const raw=max/4,p=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].map(k=>k*p).find(s=>s>=raw);
  return{top:Math.ceil(max/step-1e-9)*step,step};
}
/* The arm's average, day by day, over the days every one of its islands has reached, leaving out
   islands with no reading that day. */
function meanLine(arm,m){
  if(!arm.length||arm.some(days=>!days))return[];
  const n=Math.min(...arm.map(days=>days.length)),out=new Array(n);
  for(let d=0;d<n;d++){let s=0,k=0;for(const days of arm){const v=days[d][m];if(Number.isFinite(v)){s+=v;k++;}}out[d]=k?s/k:NaN;}
  return out;
}

function draw(card,f){
  const {exp,m}=f,M=MEASURES[exp.measures[m]],plot=$(".plot",f.el),svg=$("svg",plot);
  const W=Math.max(280,Math.round(plot.clientWidth)),H=TOP+PLOT_H+BOTTOM,D=exp.years*PER_YEAR,data=card.data;
  let max=0,any=false;
  for(const arm of data)for(const days of arm)if(days)for(const d of days){any=true;if(d[m]>max)max=d[m];}
  const {top,step}=scale(max*1.05,M.unit==="%");
  const X=d=>LEFT+(W-LEFT-RIGHT)*(d+1)/D,Y=v=>TOP+PLOT_H*(1-Math.min(v,top)/top);
  const path=vals=>{let s="",pen=false;for(let d=0;d<vals.length;d++){if(!Number.isFinite(vals[d])){pen=false;continue;}s+=(pen?"L":"M")+X(d).toFixed(1)+" "+Y(vals[d]).toFixed(1);pen=true;}return s;};
  let s="";
  // the final year, which the verdict compares
  const b0=X(D-PER_YEAR-1),b1=X(D-1);
  s+=`<rect class="band" x="${b0.toFixed(1)}" y="${TOP}" width="${(b1-b0).toFixed(1)}" height="${PLOT_H}"/>`;
  s+=`<text class="tick" x="${((b0+b1)/2).toFixed(1)}" y="${TOP-5}" text-anchor="middle">Compared</text>`;
  for(let v=0;v<=top+1e-9;v+=step){
    const y=Y(v).toFixed(1);
    s+=`<line class="grid" x1="${LEFT}" x2="${W-RIGHT}" y1="${y}" y2="${y}"/><text class="tick" x="${LEFT-8}" y="${y}" text-anchor="end" dominant-baseline="middle">${+v.toFixed(3)}${M.unit==="%"?"%":""}</text>`;
  }
  const every=Math.ceil(64/((W-LEFT-RIGHT)/exp.years)); // label every year, or every second one when they'd crowd
  for(let y=0;y<exp.years;y+=every)s+=`<text class="tick" x="${X((y+0.5)*PER_YEAR-1).toFixed(1)}" y="${H-6}" text-anchor="middle">Year ${y+1}</text>`;
  if(!any)s+=`<text class="empty" x="${(LEFT+W-RIGHT)/2}" y="${TOP+PLOT_H/2}" text-anchor="middle" dominant-baseline="middle">Not run yet</text>`;
  data.forEach((arm,a)=>arm.forEach(days=>{if(days&&days.length)s+=`<path class="twin ${"ab"[a]}" d="${path(days.map(r=>r[m]))}"/>`;}));
  f.means=data.map(arm=>meanLine(arm,m));
  f.means.forEach((ln,a)=>{if(ln.length)s+=`<path class="mean ${"ab"[a]}" d="${path(ln)}"/>`;});
  if(card.done){
    // each arm's final-year average across the compared band: the numbers the verdict quotes,
    // labelled where the two are far enough apart to read
    const r=card.results[m],avg=[r.a,r.b],apart=Math.abs(Y(avg[0])-Y(avg[1]))>=14;
    if(avg.every(Number.isFinite))avg.forEach((v,a)=>{
      const y=Y(v).toFixed(1);
      s+=`<path class="avg ${"ab"[a]}" d="M${b0.toFixed(1)} ${y}H${b1.toFixed(1)}"/>`;
      if(apart)s+=`<text class="val" x="${(b1+8).toFixed(1)}" y="${y}" dominant-baseline="middle">${esc(v.toFixed(M.digits)+M.unit)}</text>`;
    });
  }
  s+=`<line class="hair" x1="0" x2="0" y1="${TOP}" y2="${TOP+PLOT_H}" visibility="hidden"/>`;
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.setAttribute("width",W);svg.setAttribute("height",H);
  svg.innerHTML=s;
  f.X=X;f.W=W;f.D=D;
  if(f.at!=null)show(card,f,f.at);
}

/* The crosshair and its readout: each arm's average on that day. */
function show(card,f,d){
  const {exp}=f,M=MEASURES[exp.measures[f.m]],seen=Math.max(0,...card.data.flat().map(days=>days?days.length:0));
  const svg=$("svg",f.el),hair=$(".hair",svg),tip=$(".tip",f.el);
  if(!seen){hide(f);return;}
  d=Math.max(0,Math.min(seen-1,d));f.at=d;
  const x=f.X(d);hair.setAttribute("x1",x);hair.setAttribute("x2",x);hair.setAttribute("visibility","visible");
  tip.replaceChildren();
  const head=document.createElement("div");head.className="tip-head";
  head.textContent=`Day ${d+1} · year ${Math.floor(d/PER_YEAR)+1}`;tip.append(head);
  exp.arms.forEach((arm,a)=>{
    const row=document.createElement("div"),key=document.createElement("i"),val=document.createElement("b"),name=document.createElement("span");
    row.className="tip-row";key.className="key "+"ab"[a];
    const v=f.means[a]&&f.means[a][d];
    val.textContent=Number.isFinite(v)?v.toFixed(M.digits)+M.unit:"–";name.textContent=arm.label;
    row.append(key,val,name);tip.append(row);
  });
  tip.hidden=false;
  const r=svg.getBoundingClientRect(),px=x/f.W*r.width,tw=tip.offsetWidth;
  tip.style.left=(px+14+tw>r.width?Math.max(0,px-14-tw):px+14)+"px";
}
function hide(f){f.at=null;const h=$(".hair",f.el);if(h)h.setAttribute("visibility","hidden");$(".tip",f.el).hidden=true;}

/* ---------- the page ---------- */

const cards=[];
function build(){
  const root=$("#experiments");
  for(const exp of EXPERIMENTS){
    const el=document.createElement("section");el.className="xp";el.id=exp.id;
    const [A,B]=exp.arms;
    el.innerHTML=`<h2>${esc(exp.question)}</h2><p>${esc(exp.about)}</p>
      <ul class="arms" aria-label="The two kinds of island"><li><i class="key a"></i>${esc(A.label)} <span class="muted">(as usual)</span></li><li><i class="key b"></i>${esc(B.label)}</li></ul>
      ${exp.note?`<p class="note">${esc(exp.note)}</p>`:""}
      <p class="muted small">${cap(NUMBERS[exp.islands]||String(exp.islands))} pairs of twins, ${exp.years} years each. The verdict compares the final year.</p>
      <div class="xp-actions"><button class="primary run">Run the experiment</button><button class="stop" hidden>Stop</button></div>
      <div class="meter xp-progress" hidden><span>Progress</span><div class="bar"><i></i></div><em></em></div>
      ${exp.measures.map((k,m)=>`<figure class="xp-chart" data-m="${m}"><figcaption>${esc(MEASURES[k].label)}${MEASURES[k].about?`<small>${esc(MEASURES[k].about)}</small>`:""}</figcaption>
        <div class="plot"><svg tabindex="0" role="group" aria-label="${esc(MEASURES[k].label)} on every island, day by day. Arrow keys read each kind of island's average; the table lists every pair."></svg><div class="tip" hidden></div></div>
        <p class="verdict muted">Run the experiment to see the result.</p>
        <button class="ghost numbers" hidden aria-expanded="false">Show the numbers for each pair</button>
        <div class="table-wrap" hidden></div></figure>`).join("")}`;
    root.append(el);
    const card={exp,el,data:[[],[]],done:false,stop:null,figs:[]};
    card.figs=[...el.querySelectorAll(".xp-chart")].map(fig=>({exp,el:fig,m:+fig.dataset.m,at:null}));
    for(const f of card.figs){
      const svg=$("svg",f.el);
      svg.addEventListener("pointermove",e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)*f.W/r.width;show(card,f,Math.round((x-LEFT)/(f.W-LEFT-RIGHT)*f.D-1));});
      svg.addEventListener("pointerleave",()=>{if(document.activeElement!==svg)hide(f);});
      svg.addEventListener("focus",()=>show(card,f,f.D));
      svg.addEventListener("blur",()=>hide(f));
      svg.addEventListener("keydown",e=>{
        const k={ArrowLeft:-10,ArrowRight:10,PageUp:-PER_YEAR,PageDown:PER_YEAR}[e.key];
        if(k){e.preventDefault();show(card,f,(f.at==null?f.D:f.at)+k*(e.shiftKey?5:1));}
        else if(e.key==="Home"){e.preventDefault();show(card,f,0);}
        else if(e.key==="End"){e.preventDefault();show(card,f,f.D);}
        else if(e.key==="Escape")hide(f);
      });
      $(".numbers",f.el).addEventListener("click",e=>{const t=$(".table-wrap",f.el),open=t.hidden;t.hidden=!open;e.target.setAttribute("aria-expanded",String(open));e.target.textContent=open?"Hide the numbers":"Show the numbers for each pair";});
    }
    $(".run",el).addEventListener("click",()=>run(card));
    $(".stop",el).addEventListener("click",()=>stop(card,true));
    new ResizeObserver(()=>redraw(card)).observe(el);
    cards.push(card);
  }
}

function redraw(card){for(const f of card.figs)draw(card,f);}

function progress(card){
  const {exp}=card,all=2*exp.islands*exp.years*PER_YEAR;
  let have=0;for(const arm of card.data)for(const days of arm)if(days)have+=days.length;
  const p=Math.round(have/all*100),el=$(".xp-progress",card.el);
  $("i",el).style.width=p+"%";$("em",el).textContent=p+"%";
}

function run(card){
  const {exp,el}=card;
  stop(card,false);
  card.data=[Array.from({length:exp.islands},()=>[]),Array.from({length:exp.islands},()=>[])];card.done=false;
  for(const f of card.figs){
    $(".verdict",f.el).className="verdict muted";
    $(".verdict",f.el).textContent=`Running. The verdict comes once every island has lived its ${exp.years} years.`;
    $(".numbers",f.el).hidden=true;$(".table-wrap",f.el).hidden=true;
  }
  $(".run",el).hidden=true;$(".stop",el).hidden=false;$(".xp-progress",el).hidden=false;
  for(const c of cards)if(c!==card)$(".run",c.el).disabled=true;
  try{history.replaceState(null,"","#"+exp.id);}catch(e){/* no history on this page */}
  let queued=false;
  const later=()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;redraw(card);progress(card);},250);};
  card.stop=start(exp,(arm,island,days)=>{const d=card.data[arm][island];for(const r of days)d.push(r);later();},()=>finish(card));
  redraw(card);progress(card);
}

function stop(card,byHand){
  if(card.stop){card.stop();card.stop=null;}
  $(".run",card.el).hidden=false;$(".stop",card.el).hidden=true;
  for(const c of cards)$(".run",c.el).disabled=false;
  if(byHand){
    $(".xp-progress",card.el).hidden=true;
    for(const f of card.figs){$(".verdict",f.el).className="verdict muted";$(".verdict",f.el).textContent="Stopped before the end, so there's no verdict.";}
  }
}

function finish(card){
  const {exp}=card;
  card.done=true;card.stop=null;card.results=compare(exp,card.data);stop(card,false);
  $(".run",card.el).textContent="Run it again";
  redraw(card);progress(card);
  card.results.forEach((r,m)=>{
    const f=card.figs[m],v=verdict(exp,r),p=$(".verdict",f.el),b=document.createElement("b");
    b.textContent=v.clear?"Clear difference. ":"No clear difference. ";
    p.className="verdict";p.replaceChildren(b,document.createTextNode(v.text));
    table(f,exp,r);
    $(".numbers",f.el).hidden=false;
  });
}

/* Every pair's final-year average: the numbers the verdict rests on, readable without the chart. */
function table(f,exp,r){
  const M=MEASURES[r.k],fmt=v=>v.toFixed(M.digits)+M.unit,t=document.createElement("table"),cap=t.createCaption(),head=t.createTHead().insertRow(),body=t.createTBody();
  cap.textContent=`${M.label}, averaged over the final year`;
  for(const h of["Pair",exp.arms[0].label,exp.arms[1].label,`“${exp.arms[1].label}” twin`]){const th=document.createElement("th");th.scope="col";th.textContent=h;head.append(th);}
  for(let i=0;i<exp.islands;i++){
    const a=r.ends[0][i],b=r.ends[1][i],row=body.insertRow();
    const ok=Number.isFinite(a)&&Number.isFinite(b);
    for(const v of[`${i+1}`,Number.isFinite(a)?fmt(a):"–",Number.isFinite(b)?fmt(b):"–",!ok?"left out":b>a?"higher":b<a?"lower":"the same"])row.insertCell().textContent=v;
  }
  const foot=t.createTFoot().insertRow();
  for(const v of[r.missing?"Average of the rest":"Average",fmt(r.a),fmt(r.b),""])foot.insertCell().textContent=v;
  $(".table-wrap",f.el).replaceChildren(t);
}

build();
for(const c of cards)redraw(c);
probe().then(ok=>{
  workers=ok;
  const n=Math.max(1,Math.min(8,(navigator.hardwareConcurrency||4)-1));
  $("#engine").textContent+=ok?` This one will run ${n} island${n===1?"":"s"} at a time.`:" This page was opened straight from disk, so it can only run one island at a time. Serve the folder (npm start) to use more of your processor.";
  const c=cards.find(c=>"#"+c.exp.id===location.hash);
  if(c){c.el.scrollIntoView();run(c);}
});
})();
