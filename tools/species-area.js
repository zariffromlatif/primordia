"use strict";
/*
 * Do bigger islands hold more species? Runs the "mixed" archipelago headless: a great island in the
 * west and three small ones in the east, all settled by one species, with driftwood now and then
 * carrying a few grazers between them. For every island it notes its land and the species living
 * there (at least 5 grazers of one) on average over the final year, and how often it lost all its
 * grazers. Then it compares islands by size, and in each archipelago the great island against the
 * smallest one.
 *
 *   npm run species-area            archipelagos 1001 to 1040, 10 years each
 *   npm run species-area -- 10 6    archipelagos 1001 to 1010, 6 years each
 */
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");
const LIVES = 5; // grazers a species needs on an island to count as living there

function archipelago(seed, years) {
  const sim = require("../src/sim.js"), w = sim.makeWorld(seed, [], sim.SCENARIOS.mixed), I = sim.islesOf(w), Y = sim.YEAR;
  const land = I.map(() => 0);
  for (let k = 0; k < sim.G * sim.G; k++) if (w.terr[k] >= sim.SAND) land[sim.isleAt(w, (k % sim.G + 0.5) * sim.CELL, (Math.floor(k / sim.G) + 0.5) * sim.CELL)]++;
  const species = I.map(() => 0), grazers = I.map(() => 0), emptied = I.map(() => 0), was = I.map(() => true);
  let days = 0, last = [];
  for (let t = 1; t <= years * Y; t++) {
    sim.step(w);
    if (t % 100) continue;
    const per = I.map(() => new Map());
    for (const c of w.creatures) if (!c.dead && c.g.diet <= 0.5) { const m = per[sim.isleAt(w, c.x, c.y)]; m.set(c.sp, (m.get(c.sp) || 0) + 1); }
    per.forEach((m, i) => { const n = [...m.values()].reduce((a, b) => a + b, 0); if (was[i] && n === 0) emptied[i]++; was[i] = n > 0; });
    if (t <= (years - 1) * Y) continue;
    days++;
    per.forEach((m, i) => { species[i] += [...m.values()].filter(n => n >= LIVES).length; grazers[i] += [...m.values()].reduce((a, b) => a + b, 0); });
    last = per.map(m => [...m].filter(([, n]) => n >= LIVES).map(([sp]) => w.species.get(sp).name));
  }
  return I.map((isle, i) => ({ seed, name: isle.name, land: land[i], species: species[i] / days, grazers: grazers[i] / days, emptied: emptied[i], names: last[i] }));
}

if (!isMainThread) {
  parentPort.postMessage(archipelago(workerData.seed, workerData.years));
} else {
  const n = Number(process.argv[2]) || 40, years = Number(process.argv[3]) || 10;
  const seeds = Array.from({ length: n }, (_, i) => 1001 + i), rows = [], start = Date.now();
  let next = 0;
  const lane = () => new Promise(done => {
    const go = () => {
      if (next >= seeds.length) return done();
      const wk = new Worker(__filename, { workerData: { seed: seeds[next++], years } });
      wk.on("message", r => rows.push(...r));
      wk.on("error", e => { console.error(e); process.exitCode = 1; });
      wk.on("exit", go);
    };
    go();
  });
  Promise.all(Array.from({ length: Math.min(os.cpus().length, n) }, lane)).then(() => {
    Object.assign(globalThis, require("../src/sim.js"));
    const { chance } = require("../src/experiments.js");
    console.log(`${n} archipelagos, ${years} years each, in ${((Date.now() - start) / 1000).toFixed(0)}s\n`);
    console.log("Species living on each island at the end (land in cells):");
    for (const seed of seeds) console.log(`  ${seed}  ${rows.filter(r => r.seed === seed).map(r => `${r.name} ${r.land}: ${r.names.join(", ") || "-"}`).join("; ")}`);
    const avg = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
    const great = rows.filter(r => r.name === "west"), small = rows.filter(r => r.name !== "west");
    const third = [...small].sort((a, b) => a.land - b.land), cut = [third[Math.floor(third.length / 3)].land, third[Math.floor(2 * third.length / 3)].land];
    console.log("\nIslands by size: species living there over the final year, grazers, and times it lost all its grazers");
    for (const [label, rs] of [["smallest third of the small islands", small.filter(r => r.land < cut[0])], ["middle third", small.filter(r => r.land >= cut[0] && r.land < cut[1])],
      ["largest third", small.filter(r => r.land >= cut[1])], ["the great island", great]])
      console.log(`  ${label.padEnd(36)} ${String(Math.round(avg(rs, "land"))).padStart(5)} cells  ${avg(rs, "species").toFixed(2)} species  ${avg(rs, "grazers").toFixed(0).padStart(3)} grazers  emptied ${avg(rs, "emptied").toFixed(2)} times`);
    let more = 0, fewer = 0;
    for (const seed of seeds) {
      const rs = rows.filter(r => r.seed === seed), g = rs.find(r => r.name === "west"), s = rs.filter(r => r.name !== "west").sort((a, b) => a.land - b.land)[0];
      if (g.species > s.species) more++; else if (g.species < s.species) fewer++;
    }
    const p = chance(Math.max(more, fewer), more + fewer);
    console.log(`\nThe great island held more species than the smallest island on ${more} archipelagos, fewer on ${fewer}, the same on ${n - more - fewer}. ` +
      `Chance alone would do that ${p < 0.01 ? "less than 1 time in 100" : `about ${Math.round(p * 100)} times in 100`}.`);
    const xs = rows.filter(r => r.species > 0), lx = xs.map(r => Math.log(r.land)), ly = xs.map(r => Math.log(r.species));
    const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
    let sxy = 0, sxx = 0; lx.forEach((x, i) => { sxy += (x - mx) * (ly[i] - my); sxx += (x - mx) * (x - mx); });
    console.log(`Species grow with land as land to the power ${(sxy / sxx).toFixed(2)} (the slope of log species on log land, over islands with any).`);
  });
}
