"use strict";
/*
 * Does one species become several on an archipelago? Runs the "isles" scenario headless: four rich
 * islands, all settled by one species, with driftwood now and then carrying a few grazers from one
 * island to another. Every year it notes, for each island, its grazers and the species living there (at least
 * 5 of them), and at the end it counts the species descended from the founders: how many there are,
 * and how many live on one island only, as Darwin's finches do. The same archipelago without
 * driftwood runs alongside for comparison.
 *
 *   npm run archipelago            archipelagos 1001 to 1020, 10 years each
 *   npm run archipelago -- 10 6    archipelagos 1001 to 1010, 6 years each
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");
const SIM = process.env.SIM || "../src/sim.js";
const LIVES = 5; // members a species needs on an island to count as living there

function archipelago(seed, rules, years) {
  const sim = require(SIM), w = sim.makeWorld(seed, [], rules), I = sim.islesOf(w), founders = w.creatures[0].sp;
  const root = id => { let s = w.species.get(id); while (s && s.parentId) s = w.species.get(s.parentId); return s ? s.id : 0; };
  const yearly = [];
  let emptied = 0, rafts = 0;
  const names = [];
  const was = I.map(() => true);
  for (let t = 1; t <= years * sim.YEAR; t++) {
    const logged = w.eventCount;
    sim.step(w);
    for (let i = 0; i < Math.min(w.eventCount - logged, w.events.length); i++) if (w.events[i].text.startsWith("Driftwood")) rafts++; // the newest come first
    if (t % 1000) continue;
    const per = I.map(() => new Map());
    for (const c of w.creatures) if (!c.dead && c.g.diet <= 0.5) { const m = per[sim.isleAt(w, c.x, c.y)]; m.set(c.sp, (m.get(c.sp) || 0) + 1); }
    per.forEach((m, i) => { const n = [...m.values()].reduce((a, b) => a + b, 0); if (was[i] && n === 0) emptied++; was[i] = n > 0; });
    if (t % sim.YEAR) continue;
    const islands = per.map(m => [...m].filter(([, n]) => n >= LIVES).map(([sp]) => sp));
    const kin = new Map(); // founders' descendant species -> islands they live on
    islands.forEach((list, i) => { for (const sp of list) if (root(sp) === founders) kin.set(sp, (kin.get(sp) || []).concat(i)); });
    if (t === years * sim.YEAR) names.push(...I.map((isle, i) => `${isle.name}: ${islands[i].filter(sp => root(sp) === founders).map(sp => w.species.get(sp).name).join(", ") || "-"}`));
    yearly.push({ grazers: per.map(m => [...m.values()].reduce((a, b) => a + b, 0)), kin: kin.size, endemic: [...kin.values()].filter(v => v.length === 1).length,
      held: new Set([...kin.values()].flat()).size, others: islands.flat().filter(sp => root(sp) !== founders).length });
  }
  const end = yearly[yearly.length - 1];
  return { seed, yearly, end, best: Math.max(...yearly.map(y => y.kin)), emptied, rafts, names };
}

if (!isMainThread) {
  parentPort.postMessage(archipelago(workerData.seed, workerData.rules, workerData.years));
} else {
  const n = Number(process.argv[2]) || 20, years = Number(process.argv[3]) || 10;
  const sim = require(SIM), isles = sim.SCENARIOS.isles;
  const setups = process.env.SETUPS ? JSON.parse(process.env.SETUPS) : [["The archipelago, with driftwood", isles], ["Without driftwood", { ...isles, raft: false }]];
  const jobs = [];
  for (let s = 0; s < setups.length; s++) for (let i = 0; i < n; i++) jobs.push({ setup: s, seed: 1001 + i, rules: setups[s][1], years });
  const out = setups.map(() => []), start = Date.now();
  let next = 0;
  const lane = () => new Promise(done => {
    const go = () => {
      if (next >= jobs.length) return done();
      const j = jobs[next++], wk = new Worker(__filename, { workerData: j });
      wk.on("message", r => out[j.setup].push(r));
      wk.on("error", e => { console.error(e); process.exitCode = 1; });
      wk.on("exit", go);
    };
    go();
  });
  Promise.all(Array.from({ length: Math.min(os.cpus().length, jobs.length) }, lane)).then(() => {
    console.log(`${jobs.length} archipelagos, ${years} years each, in ${((Date.now() - start) / 1000).toFixed(0)}s`);
    const avg = (rs, f) => (rs.reduce((s, r) => s + f(r), 0) / rs.length);
    setups.forEach(([label], s) => {
      const rs = out[s].sort((a, b) => a.seed - b.seed);
      console.log(`\n${label}:`);
      console.log("  archipelago  grazers per island at the end  founders' species (most at once)  of them on one island only  islands they hold  other species  islands emptied  driftwood");
      for (const r of rs) console.log(`  ${String(r.seed).padStart(11)}  ${r.end.grazers.map(g => String(g).padStart(3)).join(" ").padEnd(29)}  ${String(r.end.kin).padStart(8)} (${r.best})${" ".repeat(22)}${String(r.end.endemic).padStart(3)}${" ".repeat(24)}${r.end.held}${" ".repeat(17)}${String(r.end.others).padStart(2)}${" ".repeat(13)}${String(r.emptied).padStart(2)}${" ".repeat(10)}${r.rafts}`);
      if (process.env.NAMES) for (const r of rs) console.log(`  ${r.seed}  ${r.names.join("; ")}`);
      const several = rs.filter(r => r.end.kin >= 2).length, three = rs.filter(r => r.end.kin >= 3).length;
      console.log(`  After ${years} years the founders had become ${avg(rs, r => r.end.kin).toFixed(1)} species on average; at least 2 on ${several} of ${n} archipelagos, at least 3 on ${three}. ` +
        `${avg(rs, r => r.end.endemic).toFixed(1)} of them lived on one island only. Grazers per island: ${avg(rs, r => avg([r.end], e => e.grazers.reduce((a, b) => a + b, 0) / 4)).toFixed(0)} on average; ${avg(rs, r => r.emptied).toFixed(1)} times an island lost all its grazers.`);
    });
  });
}
