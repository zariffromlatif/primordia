"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../src/sim.js");
Object.assign(globalThis, sim); // in the browser and the workers these are shared script globals
const X = require("../src/experiments.js");

const alive = w => w.creatures.filter(c => !c.dead);

test("every experiment is well formed", () => {
  assert.equal(new Set(X.EXPERIMENTS.map(x => x.id)).size, X.EXPERIMENTS.length, "ids are unique");
  for (const x of X.EXPERIMENTS) {
    assert.equal(x.arms.length, 2, `${x.id} has two arms`);
    assert.ok(x.measures.length && x.measures.every(k => X.MEASURES[k]), `${x.id} measures known things`);
    assert.ok(x.islands >= 6 && x.years >= 2, `${x.id} runs enough twins for long enough`);
    assert.equal(X.experiment(x.id), x);
  }
  assert.equal(X.experiment("nonsense"), null);
});

test("an experiment can fix a gene for everyone born on an island", () => {
  const w = sim.makeWorld(7, [], { genes: { learn: 0 } });
  assert.ok(alive(w).every(c => c.g.learn === 0), "founders");
  for (let i = 0; i < 1500; i++) sim.step(w);
  assert.ok(w.births > 0);
  assert.ok(alive(w).every(c => c.g.learn === 0), "and everyone born since");
});

test("an experiment can take the poison away, and its twin starts out identical", () => {
  const plain = sim.makeWorld(8), safe = sim.makeWorld(8, [], { poison: false });
  assert.equal(plain.rs, safe.rs, "both islands begin from the same random numbers");
  assert.deepEqual(alive(plain).map(c => c.x), alive(safe).map(c => c.x), "with the same founders in the same places");
  for (let i = 0; i < 3000; i++) { sim.step(safe); for (const c of safe.creatures) assert.equal(c.poisoned, 0); }
  assert.equal(safe.poisonFlips, 0, "the poison never switches colour");
  assert.ok(!safe.events.some(e => e.text.includes("turned poisonous")));
});

test("the main island has no rules, and snapshots don't carry them", () => {
  const w = sim.makeWorld(9);
  assert.deepEqual(w.rules, {});
  assert.ok(!("rules" in sim.serialize(w)));
});

test("an experiment's island measures itself every day and replays exactly", () => {
  const exp = { ...X.experiment("learning"), years: 1 };
  const run = () => { const t = X.trial(exp, 1, 0), days = []; while (!t.done()) days.push(...t.run(700)); return days; };
  const a = run(), b = run();
  assert.equal(a.length, sim.YEAR / X.SAMPLE);
  assert.ok(a.every(d => d.length === exp.measures.length && d.every(Number.isFinite)));
  assert.deepEqual(a, b);
});

test("the verdict calls a difference clear only when chance alone would rarely produce it", () => {
  assert.equal(X.chance(6, 6).toFixed(3), "0.031");
  assert.equal(X.chance(5, 6).toFixed(3), "0.219");
  const exp = { id: "t", arms: [{ label: "A" }, { label: "B" }], measures: ["grazers"], islands: 6, years: 1 };
  const days = v => Array.from({ length: sim.YEAR / X.SAMPLE }, () => [v]);
  const series = higher => [Array.from({ length: 6 }, () => days(50)), Array.from({ length: 6 }, (_, i) => days(i < higher ? 80 : 20))];
  const all = X.compare(exp, series(6))[0];
  assert.deepEqual([all.a, all.b, all.higher, all.lower], [50, 80, 6, 0]);
  assert.equal(X.verdict(exp, all).clear, true);
  assert.match(X.verdict(exp, all).text, /On 6 of 6 pairs, the “b” twin came out higher/);
  const most = X.compare(exp, series(5))[0];
  assert.equal(X.verdict(exp, most).clear, false, "5 of 6 happens by chance about 1 time in 5");
  assert.match(X.verdict(exp, most).text, /doesn't show a clear difference/);
});

test("twin islands match tick for tick until the sea floods one of them in two", () => {
  const joined = sim.makeWorld(1001, [], { land: "two" }), flooded = sim.makeWorld(1001, [], { land: "two", flood: 300 });
  const middle = w => { let deep = 0, n = 0; for (let j = 20; j < sim.G - 20; j++) { n++; if (w.terr[j * sim.G + sim.G / 2] === sim.DEEP) deep++; } return deep / n; };
  assert.equal(middle(joined), 0, "the two islands start out joined by land");
  for (let i = 0; i < 299; i++) { sim.step(joined); sim.step(flooded); }
  assert.ok(JSON.stringify(sim.serialize(joined)) === JSON.stringify(sim.serialize(flooded)), "identical before the flood");
  sim.step(joined); sim.step(flooded);
  assert.equal(middle(flooded), 1, "deep sea between them after it");
  assert.equal(middle(joined), 0);
  assert.ok(flooded.events.some(e => e.text.includes("flooded the middle")));
});

test("genetic distance is zero for a creature against itself and grows between strangers", () => {
  const w = sim.makeWorld(5), [a] = alive(w), stranger = alive(w).find(c => c.sp !== a.sp);
  assert.equal(sim.geneDistance(a, a), 0);
  assert.ok(sim.geneDistance(a, stranger) > sim.geneDistance(a, sim.makeChild(w, a)), "a child is closer than a stranger");
});
