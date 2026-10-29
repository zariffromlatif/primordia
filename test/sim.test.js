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

/* ---------- determinism and snapshots ---------- */

const snap = w => JSON.stringify(sim.serialize(w));

test("a seed replays exactly the same history", () => {
  const a = sim.makeWorld(11), b = sim.makeWorld(11);
  for (let i = 0; i < 3000; i++) { sim.step(a); sim.step(b); }
  assert.ok(a.births > 0);
  assert.ok(snap(a) === snap(b), "two runs of island 11 diverged");
});

test("a loaded snapshot carries on exactly as the saved island would have", () => {
  const a = sim.makeWorld(12);
  for (let i = 0; i < 2500; i++) sim.step(a);
  sim.meteor(a, sim.W / 2, sim.W / 2);
  const b = sim.deserialize(JSON.parse(snap(a)));
  assert.equal(b.tick, a.tick);
  assert.equal(b.creatures.length, a.creatures.length);
  assert.ok(snap(a) === snap(b), "the loaded island differs from the saved one");
  for (let i = 0; i < 2500; i++) { sim.step(a); sim.step(b); }
  assert.ok(snap(a) === snap(b), "the loaded island's history diverged");
});

test("loading refuses files that aren't saved islands", () => {
  assert.throws(() => sim.deserialize({ hello: "world" }), /not a saved Primordia island/);
  const o = sim.serialize(sim.makeWorld(1));
  assert.throws(() => sim.deserialize({ ...o, version: 999 }), /format 999/);
  assert.throws(() => sim.deserialize({ ...o, height: "AAAA" }), /damaged/);
});

/* ---------- reproduction ---------- */

test("a child of two parents inherits whole neurons from each", () => {
  const w = sim.makeWorld(13);
  const [p, q] = alive(w);
  for (const [c, v] of [[p, 1], [q, -1]]) { c.w1.fill(v); c.b1.fill(v); c.w2.fill(v); c.g.mut = 0; }
  const fromP = new Set();
  for (let n = 0; n < 20; n++) {
    const ch = sim.makeChild(w, p, q);
    assert.equal(ch.mateId, q.id);
    assert.equal(ch.gen, Math.max(p.gen, q.gen) + 1);
    for (let h = 0; h < sim.NH; h++) {
      const v = ch.b1[h];
      for (let i = 0; i < sim.NI; i++) assert.equal(ch.w1[h * sim.NI + i], v, "a neuron's inputs come from one parent");
      for (let o = 0; o < sim.NO; o++) assert.equal(ch.w2[o * sim.NH + h], v, "a neuron's outputs come from the same parent");
      fromP.add(v);
    }
  }
  assert.deepEqual([...fromP].sort(), [-1, 1], "both parents contributed neurons");
});

test("creatures mostly breed in pairs once the island fills up", () => {
  const w = sim.makeWorld(14);
  for (let i = 0; i < 3000; i++) sim.step(w);
  assert.ok(w.pairBirths > 0);
  assert.ok(w.pairBirths / w.births > 0.3, `only ${w.pairBirths} of ${w.births} births had two parents`);
});

test("a creature with no mate in reach buds on its own", () => {
  const w = sim.makeWorld(15);
  const c = alive(w)[0];
  w.creatures = [c];
  c.age = 200; c.e = c.maxE;
  for (let i = 0; i < 280; i++) sim.step(w);
  assert.ok(w.births >= 1, "the lone creature reproduced");
  assert.equal(w.pairBirths, 0);
});

/* ---------- body plans ---------- */

test("a creature only sees through the eyes it has", () => {
  const w = sim.makeWorld(16);
  for (const c of w.creatures) c.g.eyes = 2;
  for (let i = 0; i < 5; i++) sim.step(w);
  for (const c of alive(w)) {
    if (c.g.eyes !== 2) continue;
    for (let i = 6; i < sim.IE; i++) assert.equal(c.inp[i], 0, `input ${i} of a two-eyed creature`);
  }
});

test("eye count and field of view evolve within their limits", () => {
  const w = sim.makeWorld(17);
  let c = w.creatures[0];
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    c.g.mut = 0.4; c = sim.makeChild(w, c);
    assert.ok(Number.isInteger(c.g.eyes) && c.g.eyes >= 1 && c.g.eyes <= sim.MAX_EYES);
    assert.ok(c.g.fov >= 0.5 && c.g.fov <= 6 && c.g.sense <= 220);
    seen.add(c.g.eyes);
  }
  assert.ok(seen.size >= 3, `eye counts seen: ${[...seen]}`);
});

/* ---------- water ---------- */

test("every land cell drains to the sea", () => {
  const w = sim.makeWorld(18);
  const N = sim.G * sim.G;
  for (let k = 0; k < N; k++) {
    let at = k, n = 0;
    while (w.down[at] >= 0 && n < N) { at = w.down[at]; n++; }
    assert.ok(n < N, `cell ${k} drains in a loop`);
    const i = at % sim.G, j = Math.floor(at / sim.G);
    assert.ok(w.height[at] < sim.SEA || i === 0 || j === 0 || i === sim.G - 1 || j === sim.G - 1, `cell ${k} drains into a dead end`);
  }
});

test("rivers run, and over time they wear the land down and build it up at the coast", () => {
  const w = sim.makeWorld(19);
  const rivers = () => w.water.filter(v => v > 0 && v < 255).length;
  assert.ok(rivers() > 50, `only ${rivers()} river cells`);
  const before = Float32Array.from(w.height);
  for (let i = 0; i < 4000; i++) sim.step(w);
  assert.ok(rivers() > 50, "rivers are still running");
  let cut = 0, built = 0;
  for (let k = 0; k < before.length; k++) {
    if (w.height[k] < before[k] - 1e-4) cut++;
    if (before[k] < sim.SEA && w.height[k] > before[k] + 1e-4) built++;
  }
  assert.ok(cut > 20, `${cut} cells were eroded`);
  assert.ok(built > 0, `${built} sea cells gained sediment`);
});

test("a meteor crater on flat ground fills into a lake", () => {
  const w = sim.makeWorld(20);
  const cx = sim.W / 2, cy = sim.W / 2, R = 20;
  for (let j = 0; j < sim.G; j++) for (let i = 0; i < sim.G; i++) {
    if (Math.hypot(i - cx / sim.CELL, j - cy / sim.CELL) < R) w.height[j * sim.G + i] = 0.5;
  }
  sim.reshape(w);
  assert.ok(!sim.isLake(w, sim.cellOf(cx, cy)));
  sim.meteor(w, cx, cy);
  assert.ok(sim.isLake(w, sim.cellOf(cx, cy)), "the crater holds water");
  assert.equal(w.water[sim.cellOf(cx, cy)], 255);
});

test("bringing rain also brings a storm that soaks the ground", () => {
  const w = sim.makeWorld(21);
  let land = 0;
  while (w.terr[land] !== sim.GRASS) land++;
  const x = (land % sim.G + 0.5) * sim.CELL, y = (Math.floor(land / sim.G) + 0.5) * sim.CELL;
  w.moist[land] = 0;
  const storms = w.storms.length;
  sim.rain(w, x, y);
  assert.equal(w.storms.length, storms + 1);
  assert.equal(w.moist[land], 1);
});
