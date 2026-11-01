"use strict";
/*
 * Can one species become two? Runs the "split" scenario headless: a rich island that the sea cuts in
 * two after three years, by which time one lineage usually holds the whole island. It follows
 * that lineage to year 8 and calls it split once both halves still have at least 5 of its grazers
 * but no species of it lives on both sides. The same cut island, without the richness, runs alongside
 * for comparison.
 *
 *   npm run speciation             islands 1001 to 1020
 *   npm run speciation -- 10       islands 1001 to 1010
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");
const END = 8, CUT = 3;

function island(seed, rules) {
  const sim = require("../src/sim.js"), W = sim.W, w = sim.makeWorld(seed, [], rules);
  const root = id => { let s = w.species.get(id); while (s && s.parentId) s = w.species.get(s.parentId); return s ? s.id : 0; };
  const most = list => { const n = new Map(); for (const x of list) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]; };
  let line = 0, split = 0, names = "", lost = 0;
  for (let t = 1; t <= END * sim.YEAR; t++) {
    sim.step(w);
    if (t % sim.YEAR || t < CUT * sim.YEAR) continue;
    const g = w.creatures.filter(c => !c.dead && c.g.diet <= 0.5), west = g.filter(c => c.x < W / 2), east = g.filter(c => c.x >= W / 2);
    if (t === CUT * sim.YEAR) {
      const a = most(west.map(c => root(c.sp))), b = most(east.map(c => root(c.sp)));
      line = a && b && a[0] === b[0] ? a[0] : 0;
      if (!line) break;
      continue;
    }
    const lw = west.filter(c => root(c.sp) === line), le = east.filter(c => root(c.sp) === line);
    if (lw.length < 5 || le.length < 5) { lost = t / sim.YEAR; break; }
    const sw = new Set(lw.map(c => c.sp));
    if (!split && t >= (CUT + 2) * sim.YEAR && !le.some(c => sw.has(c.sp))) {
      split = t / sim.YEAR;
      names = `${w.species.get(most(lw.map(c => c.sp))[0]).name} in the west, ${w.species.get(most(le.map(c => c.sp))[0]).name} in the east`;
    }
  }
  return { seed, line: !!line, split, names, lost };
}

if (!isMainThread) {
  parentPort.postMessage(island(workerData.seed, workerData.rules));
} else {
  const sim = require("../src/sim.js"), n = Number(process.argv[2]) || 20;
  const setups = [["Rich, cut in two (the split scenario)", sim.SCENARIOS.split], ["Usual richness, cut in two", { land: "two", flood: CUT * sim.YEAR }]];
  const jobs = [];
  for (const [, rules] of setups) for (let i = 0; i < n; i++) jobs.push({ seed: 1001 + i, rules });
  const out = new Map(setups.map(([label]) => [label, []])), start = Date.now();
  let next = 0;
  const lane = () => new Promise(done => {
    const go = () => {
      if (next >= jobs.length) return done();
      const j = jobs[next++], wk = new Worker(__filename, { workerData: j });
      wk.on("message", r => out.get(setups.find(([, rules]) => rules === j.rules)[0]).push(r));
      wk.on("error", e => { console.error(e); process.exitCode = 1; });
      wk.on("exit", go);
    };
    go();
  });
  Promise.all(Array.from({ length: Math.min(os.cpus().length, jobs.length) }, lane)).then(() => {
    console.log(`${jobs.length} islands in ${((Date.now() - start) / 1000).toFixed(0)}s`);
    for (const [label] of setups) {
      const rs = out.get(label).sort((a, b) => a.seed - b.seed), held = rs.filter(r => r.line), splits = rs.filter(r => r.split);
      console.log(`\n${label}: one lineage held both halves at the flood on ${held.length} of ${n} islands; it split into two species on ${splits.length}.`);
      for (const r of splits) console.log(`  island ${r.seed}: split ${r.split - CUT} years after the flood (${r.names})`);
    }
  });
}
