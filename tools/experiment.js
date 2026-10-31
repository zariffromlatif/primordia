"use strict";
/*
 * Runs the experiments from src/experiments.js headless, several islands at once, and prints what
 * the experiments page would show: each arm's average over the final year, every pair of twins,
 * and the verdict.
 *
 *   npm run experiment               every experiment
 *   npm run experiment -- learning   one of them
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");
Object.assign(globalThis, require("../src/sim.js")); // experiments.js reads the simulation from globals, as in the browser
const X = require("../src/experiments.js");

if (!isMainThread) {
  const { id, arm, island } = workerData, t = X.trial(X.experiment(id), arm, island), days = [];
  while (!t.done()) days.push(...t.run(4000));
  parentPort.postMessage(days);
} else {
  const ids = process.argv.slice(2), list = ids.length ? ids.map(X.experiment) : X.EXPERIMENTS;
  if (list.includes(null)) { console.error(`Unknown experiment. Try: ${X.EXPERIMENTS.map(x => x.id).join(", ")}`); process.exit(1); }
  const jobs = [];
  for (const exp of list) for (let arm = 0; arm < 2; arm++) for (let island = 0; island < exp.islands; island++) jobs.push({ exp, arm, island });
  const out = new Map(list.map(exp => [exp.id, [[], []]])), start = Date.now();
  let next = 0;
  const lane = () => new Promise(done => {
    const go = () => {
      if (next >= jobs.length) return done();
      const j = jobs[next++], w = new Worker(__filename, { workerData: { id: j.exp.id, arm: j.arm, island: j.island } });
      w.on("message", days => { out.get(j.exp.id)[j.arm][j.island] = days; });
      w.on("error", e => { console.error(e); process.exitCode = 1; });
      w.on("exit", go);
    };
    go();
  });
  Promise.all(Array.from({ length: Math.min(os.cpus().length, jobs.length) }, lane)).then(() => {
    console.log(`${jobs.length} islands in ${((Date.now() - start) / 1000).toFixed(0)}s`);
    for (const exp of list) {
      console.log(`\n${exp.question} (${exp.id}: ${exp.islands} pairs of twins, ${exp.years} years)`);
      for (const r of X.compare(exp, out.get(exp.id))) {
        const M = X.MEASURES[r.k], f = v => v.toFixed(M.digits).padStart(7);
        console.log(`  ${M.label}, final year, per pair (${exp.arms[0].label} / ${exp.arms[1].label}):`);
        console.log("   " + r.ends[0].map((a, i) => `${f(a).trim()}/${f(r.ends[1][i]).trim()}`).join("  "));
        const v = X.verdict(exp, r);
        console.log(`  ${v.clear ? "CLEAR" : "unclear"}: ${v.text}`);
      }
    }
  });
}
