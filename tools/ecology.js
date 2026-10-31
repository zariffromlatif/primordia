"use strict";
/*
 * Does the island sustain itself? Runs islands headless, several at once, and reports whether
 * hunters hold on, how often grazers nearly die out and have to be rescued, and what creatures
 * die of, against the targets the ecology is tuned for.
 *
 *   npm run ecology              islands 1 to 8, 10 years each
 *   npm run ecology -- 4 5       islands 1 to 4, 5 years each
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");

const CAUSES = [["Eaten", "eaten"], ["Poisoned", "poison"], ["Starved", "starved"], ["thirst", "thirst"], ["plague", "plague"],
  ["old age", "old age"], ["deep water", "drowned"], ["meteor", "meteor"]];
const TARGETS = [
  { k: "hunters", label: "Hunters on the island", unit: "% of the time", ok: v => v >= 60, goal: "at least 60%" },
  { k: "rescues", label: "Grazer rescues", unit: " per decade", ok: v => v <= 1, goal: "at most 1" },
  { k: "low", label: "Fewer than 20 grazers", unit: "% of the time", ok: v => v <= 5, goal: "at most 5%" },
];

function island(seed, years) {
  const sim = require("../src/sim.js");
  const w = sim.makeWorld(seed), T = years * sim.YEAR, deaths = {};
  let grazers = 0, low = 0, hunted = 0, run = 0, longest = 0, rescued = 0, waves = 0, died = 0;
  for (let t = 1; t <= T; t++) {
    const before = w.creatures.slice();
    sim.step(w);
    for (const c of before) {
      if (!c.dead) continue;
      const m = CAUSES.find(([text]) => c.cause.includes(text)), k = m ? m[1] : c.cause;
      deaths[k] = (deaths[k] || 0) + 1; died++;
    }
    // A rescue drops ten brand-new grazers in at once, on a tick that's a multiple of 300.
    if (t % 300 === 0) for (const c of w.creatures) if (c.age === 0 && c.gen === 0 && c.g.diet <= 0.5) rescued++;
    if (w.lastCarnArrival === t) waves++;
    grazers += w.nHerb;
    if (w.nHerb < 20) low++;
    if (w.nCarn > 0) { hunted++; run++; if (run > longest) longest = run; } else run = 0;
  }
  const share = {};
  for (const [k, n] of Object.entries(deaths)) share[k] = n / died * 100;
  return { seed, grazers: grazers / T, low: low / T * 100, rescues: rescued / 10 / years * 10, hunters: hunted / T * 100,
    longest: longest / sim.YEAR, waves, share };
}

if (!isMainThread) {
  parentPort.postMessage(island(workerData.seed, workerData.years));
} else {
  const n = Number(process.argv[2]) || 8, years = Number(process.argv[3]) || 10;
  const seeds = Array.from({ length: n }, (_, i) => i + 1), results = [], start = Date.now();
  let next = 0;
  const run = () => new Promise(done => {
    const go = () => {
      if (next >= seeds.length) return done();
      const w = new Worker(__filename, { workerData: { seed: seeds[next++], years } });
      w.on("message", r => results.push(r));
      w.on("error", e => { console.error(e); process.exitCode = 1; go(); });
      w.on("exit", go);
    };
    go();
  });
  Promise.all(Array.from({ length: Math.min(os.cpus().length, n) }, run)).then(() => {
    results.sort((a, b) => a.seed - b.seed);
    const f = (v, d = 0) => v.toFixed(d).padStart(5);
    console.log(`${n} islands, ${years} years each, in ${((Date.now() - start) / 1000).toFixed(0)}s\n`);
    console.log("island  grazers  <20 grazers  rescues/decade  hunters present  longest hunter run  hunter waves");
    for (const r of results)
      console.log(`${String(r.seed).padStart(6)}  ${f(r.grazers)}    ${f(r.low)}%         ${f(r.rescues, 1)}          ${f(r.hunters)}%          ${f(r.longest, 1)} years       ${f(r.waves)}`);
    const avg = k => results.reduce((s, r) => s + r[k], 0) / results.length;
    const causes = {};
    for (const r of results) for (const [k, v] of Object.entries(r.share)) causes[k] = (causes[k] || 0) + v / results.length;
    console.log(`\nWhat creatures die of: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(", ")}`);
    console.log(`Average grazers ${avg("grazers").toFixed(0)}, longest hunter run ${avg("longest").toFixed(1)} years on average\n`);
    for (const t of TARGETS) {
      const v = avg(t.k);
      console.log(`${t.ok(v) ? "pass" : "FAIL"}  ${t.label}: ${v.toFixed(t.k === "rescues" ? 1 : 0)}${t.unit} (target ${t.goal})`);
    }
  });
}
