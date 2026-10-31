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
    assert.ok(Number.isFinite(c.e) && Number.isFinite(c.mem) && c.sigA >= 0 && c.sigB >= 0 && Number.isFinite(c.surprise));
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

test("loading refuses a file with fields of the wrong kind, so an edited file can't break or take over the page", () => {
  const w = sim.makeWorld(47);
  for (let i = 0; i < 600; i++) sim.step(w);
  const text = snap(w), edit = f => { const o = JSON.parse(text); f(o); return o; };
  const bad = {
    "markup in a record": o => { o.records.kids.v = '<img src=x onerror="alert(1)">'; },
    "markup as a species id": o => { o.species[0].id = '"><svg onload="alert(1)">'; },
    "markup as a creature id": o => { o.creatures[0].id = "<b>1</b>"; },
    "a number written as text": o => { o.tick = "600"; },
    "a number too big to store": o => { o.season = Infinity; },
    "an object where a list belongs": o => { o.history = {}; },
    "a missing field": o => { delete o.records.age; },
    "an impossible eye count": o => { o.creatures[0].g.eyes = sim.MAX_EYES + 1; },
    "a third plant colour": o => { o.toxic = 2; },
    "a species descended from itself": o => { o.species[0].parentId = o.species[0].id; },
    "a grid that isn't base64": o => { o.plant = "%%%%"; },
    "an action with an unknown tool": o => { o.actions = [{ t: 5, tool: "flood", x: 1, y: 1 }]; o.next = 1; },
    "a replay that has run past its record": o => { o.next = o.actions.length + 1; },
    "a format 2 file with no creature list": o => { o.version = 2; o.creatures = "none"; },
  };
  for (const [what, f] of Object.entries(bad)) assert.throws(() => sim.deserialize(edit(f)), /damaged/, what);
  assert.equal(sim.deserialize(JSON.parse(text)).tick, w.tick, "the untouched file still loads");
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
    for (let i = 2 * sim.PER_EYE; i < sim.IE; i++) assert.equal(c.inp[i], 0, `input ${i} of a two-eyed creature`);
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

/* ---------- minds: learning, prediction and calls ---------- */

const living = w => w.creatures.filter(c => !c.dead);
function grazerOnPlant(w, kind) {
  const c = living(w).find(c => c.g.diet <= 0.5);
  let k = 0;
  while (!(w.terr[k] === sim.GRASS && w.ptype[k] === kind && w.water[k] === 0)) k++;
  const place = () => { c.x = (k % sim.G + 0.5) * sim.CELL; c.y = (Math.floor(k / sim.G) + 0.5) * sim.CELL; w.plant[k] = 1; };
  w.toxic = kind; w.creatures = [c];
  return { c, place };
}

test("a grazer that can learn comes to avoid the poisonous plant, then refuses to eat it", () => {
  const w = sim.makeWorld(21);
  const { c, place } = grazerOnPlant(w, 1);
  c.g.learn = 0.04; c.val[1] = 0.5; c.e = c.maxE * 0.5;
  for (let i = 0; i < 40; i++) { place(); sim.step(w); }
  assert.ok(c.val[1] < -0.2, `value of the poisonous plant fell to ${c.val[1].toFixed(2)}`);
  const bites = c.bites;
  place(); sim.step(w);
  assert.equal(c.bites, bites, "it no longer eats the plant it learned is bad");
});

test("a grazer that cannot learn keeps its inborn taste", () => {
  const w = sim.makeWorld(21);
  const { c, place } = grazerOnPlant(w, 1);
  c.g.learn = 0; const before = c.val[1];
  for (let i = 0; i < 20; i++) { place(); sim.step(w); }
  assert.equal(c.val[1], before);
});

test("what a creature learns about danger is not inherited", () => {
  const w = sim.makeWorld(6);
  const p = w.creatures[0];
  p.pw.fill(4); // pretend the parent learned a lot
  const child = sim.makeChild(w, p);
  assert.deepEqual(Array.from(child.pw), Array.from(child.w2.subarray(5 * sim.NH, 6 * sim.NH)), "a newborn's predictor starts from its genes");
  assert.ok(Math.max(...child.pw) < 3.9);
});

test("surprise falls as a creature learns what danger to expect", () => {
  const w = sim.makeWorld(12);
  const c = living(w)[0];
  w.creatures = [c];
  c.g.learn = 0.05; c.pb = 3; // its brain starts out expecting danger everywhere
  for (let i = 0; i < 5; i++) sim.step(w);
  const early = c.surprise;
  for (let i = 0; i < 400; i++) { c.e = c.maxE * 0.7; sim.step(w); }
  assert.ok(early > 0.1 && c.surprise < 0.05, `surprise went from ${early.toFixed(3)} to ${c.surprise.toFixed(3)}`);
});

test("a call made mostly when hunters are in sight is recognised as an alarm call, only after two measurements", () => {
  const w = sim.makeWorld(30);
  const fill = () => {
    const M = w.mind;
    M.n = 5000; M.threat = 5000 * 0.05; M.food = 5000 * 0.3; M.calmN = 4000; M.calmSpeed = 4000 * 0.1;
    Object.assign(M.calls[0], { n: 400, threat: 400 * 0.6, food: 400 * 0.3, hearN: 200, hearSpeed: 200 * 0.5 });
  };
  fill(); sim.analyzeMinds(w);
  assert.equal(w.calls[0].meaning, null, "one measurement is not enough");
  fill(); sim.analyzeMinds(w);
  assert.equal(w.calls[0].meaning, "danger");
  assert.ok(w.events.some(e => e.text.includes("alarm call")));
  assert.ok(w.events.some(e => e.text.includes("Listeners understand call A")));
  assert.equal(w.calls[1].meaning, null, "the unused call has no meaning");
});

test("which plant is poisonous can change with the seasons, and gold and blue both grow", () => {
  const w = sim.makeWorld(50);
  let blue = 0; for (const t of w.ptype) blue += t;
  assert.ok(blue / w.ptype.length > 0.25 && blue / w.ptype.length < 0.75);
  assert.deepEqual(Array.from(sim.plantKinds(50)), Array.from(w.ptype), "plant patches are fixed by the seed");
  const start = w.toxic;
  for (let i = 0; i < 6000; i++) sim.step(w);
  assert.ok(w.poisonFlips > 0 || w.toxic === start);
  assert.ok(w.events.some(e => e.text.includes("poisonous")));
});

/* ---------- Darwin: natural and sexual selection ---------- */

test("choosy creatures prefer showy, well-fed partners", () => {
  const w = sim.makeWorld(41);
  const [c, plain, showy] = living(w);
  c.g.pref = 1; plain.g.orn = 0; showy.g.orn = 1;
  plain.e = plain.maxE; showy.e = showy.maxE;
  let wins = 0;
  for (let i = 0; i < 200; i++) if (sim.mateScore(w, c, showy) > sim.mateScore(w, c, plain)) wins++;
  assert.ok(wins > 190, `showy partner won ${wins} of 200`);
  c.g.pref = -1; wins = 0;
  for (let i = 0; i < 200; i++) if (sim.mateScore(w, c, showy) > sim.mateScore(w, c, plain)) wins++;
  assert.ok(wins < 10, "a creature that dislikes ornaments avoids showy partners");
});

test("the selection meter detects when parents are bigger than average", () => {
  const w = sim.makeWorld(42);
  const grazers = living(w).filter(c => c.g.diet <= 0.5);
  grazers.forEach((c, i) => { c.g.size = 0.8 + (i % 10) * 0.1; });
  for (let i = 0; i < 4; i++) sim.samplePopulation(w);
  const big = grazers.filter(c => c.g.size >= 1.5);
  for (let i = 0; i < 80; i++) sim.recordParents(w, big[i % big.length], null);
  sim.analyzeSelection(w);
  assert.ok(w.selection.size.s > 1, `selection differential on size was ${w.selection.size.s.toFixed(2)}`);
  assert.equal(w.selection.taste, undefined, "only listed traits are measured");
});

test("natural selection is only reported after a sustained signal", () => {
  const w = sim.makeWorld(43);
  const grazers = living(w).filter(c => c.g.diet <= 0.5);
  grazers.forEach((c, i) => { c.g.speed = 0.6 + (i % 10) * 0.1; });
  const fast = grazers.filter(c => c.g.speed >= 1.3);
  const round = () => { for (let i = 0; i < 4; i++) sim.samplePopulation(w); for (let i = 0; i < 80; i++) sim.recordParents(w, fast[i % fast.length], null); w.tick += 500; sim.analyzeSelection(w); };
  w.tick = 5000;
  round(); round();
  assert.ok(!w.events.some(e => e.text.includes("favoring faster")), "two measurements are not enough");
  round();
  assert.ok(w.events.some(e => e.text.includes("Natural selection is favoring faster bodies")));
});

test("the struggle for existence counts deaths that left no offspring", () => {
  const w = sim.makeWorld(44);
  w.deathsAll = 50; w.deathsNoKids = 40;
  sim.analyzeSelection(w);
  assert.equal(w.struggle, 0.8);
});

test("hand-feeding a creature fills its energy (artificial selection)", () => {
  const w = sim.makeWorld(45);
  const c = living(w)[0];
  c.e = 1;
  assert.equal(sim.feedCreature(w, c.x, c.y), c);
  assert.equal(c.e, c.maxE);
  assert.ok(w.events.some(e => e.text.includes("artificial selection")));
});

test("everything learned and measured survives a save and load", () => {
  const w = sim.makeWorld(46);
  for (let i = 0; i < 1500; i++) sim.step(w);
  const c = living(w)[0];
  c.val[0] = -0.7; c.pw[2] = 1.25; c.surprise = 0.3;
  const back = sim.deserialize(JSON.parse(JSON.stringify(sim.serialize(w))));
  const d = back.creatures.find(x => x.id === c.id);
  assert.equal(d.val[0], c.val[0]);
  assert.equal(d.pw[2], c.pw[2]);
  assert.equal(d.surprise, 0.3);
  assert.equal(back.toxic, w.toxic);
  assert.deepEqual(back.calls, w.calls);
  assert.deepEqual(Array.from(back.ptype), Array.from(w.ptype));
});

/* ---------- recorded actions ---------- */

test("a seed and its recorded actions replay exactly the same history", () => {
  const a = sim.makeWorld(51);
  for (let i = 0; i < 300; i++) sim.step(a);
  assert.ok(sim.act(a, "meteor", 500.4, 499.6));
  for (let i = 0; i < 200; i++) sim.step(a);
  sim.act(a, "rain", 300, 300);
  sim.act(a, "hunters", 600, 400);
  const c = alive(a)[0];
  sim.act(a, "feed", c.x, c.y);
  for (let i = 0; i < 700; i++) sim.step(a);
  assert.deepEqual(a.actions.map(x => [x.t, x.tool]), [[300, "meteor"], [500, "rain"], [500, "hunters"], [500, "feed"]]);
  assert.deepEqual([a.actions[0].x, a.actions[0].y], [500, 500], "positions are rounded");
  const b = sim.makeWorld(51, sim.decodeActions(sim.encodeActions(a.actions)));
  for (let i = 0; i < 1200; i++) sim.step(b);
  assert.equal(b.next, 4);
  assert.ok(snap(a) === snap(b), "the replayed island diverged");
});

test("acting during a replay drops the actions still to come", () => {
  const w = sim.makeWorld(52, [{ t: 100, tool: "meteor", x: 500, y: 500 }, { t: 900, tool: "rain", x: 200, y: 200 }]);
  for (let i = 0; i < 200; i++) sim.step(w);
  assert.equal(w.next, 1);
  sim.act(w, "plague", 400, 400);
  assert.deepEqual(w.actions.map(x => x.tool), ["meteor", "plague"]);
  assert.equal(w.next, 2);
});

test("actions survive a trip through a link, and junk is ignored", () => {
  const list = [{ t: 0, tool: "rain", x: 0, y: 1023 }, { t: 5000, tool: "meteor", x: 512, y: 300 }, { t: 6000, tool: "feed", x: 7, y: 8 }];
  assert.equal(sim.encodeActions(list), "/r0.0.1023/m5000.512.300/f6000.7.8");
  assert.deepEqual(sim.decodeActions("/m5000.512.300/x1.2.3/f6000.7.8/r0.0.1023/p9.9999.4"),
    [list[0], { t: 9, tool: "plague", x: 1023, y: 4 }, list[1], list[2]]);
  assert.equal(sim.act(sim.makeWorld(1), "flood", 1, 1), false);
  assert.equal(sim.makeWorld(1, [{ t: -1, tool: "rain", x: 1, y: 1 }, { t: 3, tool: "__proto__", x: 1, y: 1 }]).actions.length, 0);
});

/* ---------- thirst ---------- */

function cellWhere(w, ok) {
  for (let k = 0; k < sim.G * sim.G; k++) if (ok(k)) return { k, x: (k % sim.G + 0.5) * sim.CELL, y: (Math.floor(k / sim.G) + 0.5) * sim.CELL };
  throw new Error("no such cell");
}

test("creatures drink at rivers and dry out away from water", () => {
  const w = sim.makeWorld(53);
  const river = cellWhere(w, k => w.water[k] > 60 && w.water[k] < 255);
  const dry = cellWhere(w, k => w.terr[k] === sim.GRASS && w.water[k] === 0 && w.moist[k] < 0.8);
  const [a, b] = alive(w);
  w.creatures = [a, b];
  Object.assign(a, { x: river.x, y: river.y, h: 0.5 });
  Object.assign(b, { x: dry.x, y: dry.y, h: 0.5 });
  w.plant[dry.k] = 0; // nothing juicy to eat there
  sim.step(w);
  assert.ok(a.h > 0.5, `the drinker went from 0.5 to ${a.h}`);
  assert.ok(b.h < 0.5, `the dry one went from 0.5 to ${b.h}`);
  assert.equal(a.inp[sim.IE + 8], 0.5, "thirst is an input");
});

test("a creature that runs dry dies of thirst, and a bad season for it is logged", () => {
  const w = sim.makeWorld(54);
  const dry = cellWhere(w, k => w.terr[k] === sim.GRASS && w.water[k] === 0 && w.moist[k] < 0.8);
  const c = alive(w)[0];
  w.creatures = [c];
  Object.assign(c, { x: dry.x, y: dry.y, h: 0, e: 0.1 });
  w.plant[dry.k] = 0;
  sim.step(w);
  assert.equal(c.cause, "Died of thirst");
  assert.equal(w.thirstDead, 1);
  w.tick = 499; w.thirstDead = 20;
  sim.step(w);
  assert.ok(w.events.some(e => e.text === "20 creatures died of thirst during the spring."));
  assert.equal(w.thirstDead, 0, "the count starts again each season");
});

test("eyes can make out fresh water from a few cells away", () => {
  const w = sim.makeWorld(55);
  let near = 0;
  for (let k = 0; k < sim.G * sim.G; k++) {
    if (w.water[k] > 0) assert.equal(w.fresh[k], 1);
    else if (w.fresh[k] > 0 && w.fresh[k] < 1) near++;
  }
  assert.ok(near > 100, `${near} cells see water nearby`);
  for (let i = 0; i < 3; i++) sim.step(w);
  const c = alive(w).find(c => c.g.eyes >= 1 && c.inp.some((v, i) => i < sim.IE && i % sim.PER_EYE === sim.SEE_WATER && v > 0));
  assert.ok(c, "some creature's eyes report water");
});

/* ---------- older saves ---------- */

test("an island saved in format 2, before thirst and recorded actions, still loads", () => {
  const w = sim.makeWorld(56);
  for (let i = 0; i < 300; i++) sim.step(w);
  const o = sim.serialize(w), NI2 = sim.MAX_EYES * 3 + 8, IE2 = sim.MAX_EYES * 3, H = sim.NH;
  // turn this snapshot back into what format 2 wrote: three inputs per eye, and no thirst
  const down = v3 => {
    const v2 = new Float32Array(v3.length - (sim.NI - NI2) * H);
    for (let h = 0; h < H; h++) {
      for (let e = 0; e < sim.MAX_EYES; e++) for (let t = 0; t < 3; t++) v2[h * NI2 + e * 3 + t] = v3[h * sim.NI + e * sim.PER_EYE + t];
      for (let n = 0; n < 8; n++) v2[h * NI2 + IE2 + n] = v3[h * sim.NI + sim.IE + n];
    }
    v2.set(v3.subarray(sim.NI * H), NI2 * H);
    return v2;
  };
  const L3 = sim.NI * H + H + sim.NO * H + sim.NO;
  for (const c of o.creatures) { c.brain = sim.toB64(down(sim.fromB64(c.brain, L3))); delete c.h; }
  for (const s of o.species) s.repW = sim.toB64(down(sim.fromB64(s.repW, sim.NI * H + sim.NO * H)));
  for (const k of ["actions", "next", "replayable", "thirstDead"]) delete o[k];
  o.version = 2;
  const v = sim.deserialize(JSON.parse(JSON.stringify(o)));
  assert.equal(v.replayable, false, "its link can only replay how the island began");
  const before = w.creatures[0], after = v.creatures[0];
  for (let h = 0; h < H; h++) {
    for (let e = 0; e < sim.MAX_EYES; e++) {
      for (let t = 0; t < 3; t++) assert.equal(after.w1[h * sim.NI + e * sim.PER_EYE + t], before.w1[h * sim.NI + e * sim.PER_EYE + t]);
      assert.equal(after.w1[h * sim.NI + e * sim.PER_EYE + sim.SEE_WATER], 0, "the new water channel starts unwired");
    }
    for (let n = 0; n < 8; n++) assert.equal(after.w1[h * sim.NI + sim.IE + n], before.w1[h * sim.NI + sim.IE + n]);
    assert.equal(after.w1[h * sim.NI + sim.IE + 8], 0, "so does thirst");
  }
  assert.deepEqual(Array.from(after.w2), Array.from(before.w2));
  assert.equal(after.h, 1);
  for (let i = 0; i < 300; i++) sim.step(v);
  assert.ok(v.creatures.length > 0);
});

/* ---------- ecology ---------- */

test("hunters leave hunters of their own species alone, newborns included, but still eat other kinds", () => {
  const w = sim.makeWorld(57);
  const parent = sim.spawnGroup(w, "carn", 1, 500, 500) && w.creatures[w.creatures.length - 1];
  const land = { x: parent.x, y: parent.y };
  const baby = sim.makeChild(w, parent), grazer = alive(w).find(c => c.g.diet <= 0.5);
  w.creatures = [parent, baby, grazer];
  Object.assign(parent, { e: parent.maxE * 0.3, cool: 0, a: 0 });
  Object.assign(baby, { x: land.x + parent.r, y: land.y, e: baby.maxE * 0.5 });
  Object.assign(grazer, { x: land.x, y: land.y + parent.r, e: grazer.maxE * 0.5 });
  grazer.g.size = baby.g.size = parent.g.size * 0.8; grazer.r = baby.r = parent.r * 0.8;
  sim.step(w);
  assert.equal(baby.dead, false, "its own newborn survives");
  assert.equal(grazer.dead, true, "a grazer in reach is eaten");
  assert.match(grazer.cause, /^Eaten by/);
});

test("grazing leaves the roots, so a grazed patch can grow back", () => {
  const w = sim.makeWorld(58);
  const c = alive(w).find(c => c.g.diet <= 0.5);
  let k = 0;
  while (!(w.terr[k] === sim.GRASS && w.water[k] === 0 && w.fert[k] > 0.5)) k++;
  w.creatures = [c]; w.toxic = 1 - w.ptype[k]; c.val[w.ptype[k]] = 1;
  for (let i = 0; i < 50; i++) {
    Object.assign(c, { x: (k % sim.G + 0.5) * sim.CELL, y: (Math.floor(k / sim.G) + 0.5) * sim.CELL, e: c.maxE * 0.5, h: 1 });
    sim.step(w);
  }
  const floor = sim.ROOTS * w.fert[k], grazed = w.plant[k];
  assert.ok(c.bites >= 3, "it grazed there");
  assert.ok(grazed >= floor - 1e-6 && grazed < floor + 0.02, `the plant was eaten down to ${grazed.toFixed(3)}, against a floor of ${floor.toFixed(3)}`);
  w.creatures = [];
  for (let i = 0; i < 200; i++) sim.step(w);
  assert.ok(w.plant[k] > grazed, "left alone, it grows back");
});

test("feeling poisoned wears off", () => {
  const w = sim.makeWorld(59);
  const { c, place } = grazerOnPlant(w, 1);
  c.g.learn = 0; c.val[1] = 0.8; c.e = c.maxE * 0.6;
  place(); sim.step(w);
  assert.ok(c.poisoned > 0, "a bad bite makes it feel sick");
  sim.step(w);
  assert.equal(c.inp[sim.IE + 3], 1, "and its brain feels it");
  w.creatures = [c];
  for (let i = 0; i < 45; i++) { c.e = c.maxE * 0.6; c.x = 4; c.y = 4; sim.step(w); }
  assert.equal(c.poisoned, 0, "the sickness wears off");
  sim.step(w);
  assert.equal(c.inp[sim.IE + 3], 0);
});
