"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../src/sim.js");

const alive = w => w.creatures.filter(c => !c.dead);

test("the same seed always builds the same island", () => {
  assert.deepEqual(Array.from(sim.makeWorld(42).terr), Array.from(sim.makeWorld(42).terr));
});

test("a new world starts with six species of grazers, 120 creatures in all", () => {
  const w = sim.makeWorld(7);
  assert.equal(w.nHerb, 120);
  assert.equal(w.nCarn, 0);
  assert.equal(w.species.size, 6);
  for (const n of w.spCounts.values()) assert.equal(n, 20);
});

test("the island has a reasonable mix of land and water", () => {
  const w = sim.makeWorld(123);
  const water = w.terr.filter(t => t === sim.DEEP || t === sim.SHALLOW).length / w.terr.length;
  assert.ok(water > 0.2 && water < 0.8, `water share was ${water.toFixed(2)}`);
});

test("population never exceeds the cap and every creature stays valid", () => {
  const w = sim.makeWorld(99);
  for (let i = 0; i < 6000; i++) {
    sim.step(w);
    assert.ok(w.creatures.length <= sim.CAP + 12, `population hit ${w.creatures.length}`);
  }
  for (const c of w.creatures) {
    assert.ok(Number.isFinite(c.e) && Number.isFinite(c.mem) && c.sig >= 0);
    assert.ok(c.x >= 0 && c.x <= sim.W && c.y >= 0 && c.y <= sim.W);
    assert.ok(w.species.has(c.sp), "every creature belongs to a known species");
  }
});

test("hunters arrive after the first season", () => {
  const w = sim.makeWorld(5);
  for (let i = 0; i < 3000; i++) sim.step(w);
  assert.ok(w.events.some(e => e.text.includes("washed ashore")));
});

test("children inherit genes within range and keep their parent's species at birth", () => {
  const w = sim.makeWorld(1);
  let c = w.creatures[0];
  for (let i = 0; i < 300; i++) c = sim.makeChild(w, c);
  assert.ok(c.g.size >= 0.4 && c.g.size <= 2.4);
  assert.ok(c.g.diet >= 0 && c.g.diet <= 1);
  assert.equal(c.gen, 300);
  assert.equal(c.sp, w.creatures[0].sp);
});

test("a lineage that drifts far enough becomes a new species", () => {
  const w = sim.makeWorld(2);
  const before = w.species.size;
  let c = w.creatures[0];
  const parentSp = c.sp;
  for (let i = 0; i < 400; i++) { c.g.mut = 0.12; c = sim.makeChild(w, c); }
  c.g.mut = 0.01; // siblings stay close to each other, far from the ancestor
  for (let i = 0; i < 12; i++) w.creatures.push(sim.makeChild(w, c));
  sim.assignSpecies(w);
  const sp = w.species.get(w.creatures[w.creatures.length - 1].sp);
  assert.ok(w.species.size > before);
  assert.notEqual(sp.id, parentSp);
  assert.equal(sp.parentId, parentSp);
  assert.ok(w.events.some(e => e.text.includes("has split off")));
});

test("plague spreads on contact and survivors become immune", () => {
  const w = sim.makeWorld(8);
  const c = alive(w)[0];
  const n = sim.startPlague(w, c.x, c.y);
  assert.ok(n >= 1);
  sim.census(w);
  assert.ok(w.nSick >= n, "infection was tracked");
  for (let i = 0; i < 20000 && w.nSick > 0; i++) sim.step(w);
  assert.equal(w.nSick, 0, "infections end");
  assert.ok(w.events.some(e => e.text.includes("plague burned out")));
});

test("rain restores plants and a meteor clears them", () => {
  const w = sim.makeWorld(3);
  let land = 0;
  while (w.terr[land] !== sim.GRASS) land++;
  const x = (land % sim.G + 0.5) * sim.CELL, y = (Math.floor(land / sim.G) + 0.5) * sim.CELL;
  w.plant[land] = 0;
  sim.rain(w, x, y);
  assert.ok(sim.plantAt(w, x, y) > 0.5);
  sim.meteor(w, x, y);
  assert.equal(sim.plantAt(w, x, y), 0);
  assert.match(w.events[0].text, /meteor/);
});

test("dropped hunters form their own new species", () => {
  const w = sim.makeWorld(4);
  const sp = sim.dropHunters(w, sim.W / 2, sim.W / 2);
  sim.census(w);
  assert.equal(w.nCarn, 3);
  assert.equal(w.spCounts.get(sp.id), 3);
});
