"use strict";
/*
 * A fingerprint of an island's whole state after a stretch of time. The tests pin it in Node
 * (test/sim.test.js) and in every browser engine (test/browser/island.test.js), so the same seed has
 * to give bit-for-bit the same history everywhere. If you change the simulation on purpose, the
 * fingerprints change too: run `node test/fingerprint.js` and paste its output over PINNED.
 */
const ISLANDS = [
  { seed: 7, rules: {}, ticks: 3000 }, // brains, eyes, seasons, rivers, mating and mutation
  { seed: 1013, rules: { land: "two", flood: 1500, rich: 2 }, ticks: 3000 }, // and two halves, a flood and a rich island
];

/* Runs an island and hashes everything a save would hold (FNV-1a over the saved JSON). `sim` is the
   simulation's functions: the module in Node, the page's globals in a browser. */
function fingerprint(sim, island) {
  const w = sim.makeWorld(island.seed, [], island.rules);
  for (let t = 0; t < island.ticks; t++) sim.step(w);
  const s = JSON.stringify(sim.serialize(w));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `island ${island.seed}: ${w.creatures.length} creatures on tick ${w.tick}, fingerprint ${(h >>> 0).toString(16).padStart(8, "0")}`;
}

const PINNED = [
  "island 7: 86 creatures on tick 3000, fingerprint 5fccbee0",
  "island 1013: 95 creatures on tick 3000, fingerprint 6625f8b2"
];

module.exports = { ISLANDS, fingerprint, PINNED };

if (require.main === module) {
  const sim = require("../src/sim.js");
  console.log(JSON.stringify(ISLANDS.map(i => fingerprint(sim, i)), null, 2));
}
