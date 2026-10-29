"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../src/sim.js");
Object.assign(globalThis, sim); // in the browser and the worker these are shared script globals
const { makeHost, STRIDE } = require("../src/host.js");

/* A host whose replies are collected in order. */
function open() {
  const inbox = [];
  const host = makeHost(m => inbox.push(m));
  const ask = m => { inbox.length = 0; host.handle(m); return inbox.slice(); };
  return { ask };
}

test("a new island announces itself, then sends its terrain and panels once", () => {
  const { ask } = open();
  const [hello] = ask({ type: "new", seed: 31 });
  assert.deepEqual(hello, { type: "world", seed: 31, tick: 0, loaded: false, actions: [], replayable: true });
  const [f1] = ask({ type: "frame", run: true, speed: 4 });
  assert.equal(f1.tick, 4);
  assert.equal(f1.cr.length % STRIDE, 0);
  assert.equal(f1.cr.length / STRIDE, f1.stats.herb + f1.stats.carn);
  assert.ok(f1.terrain && f1.hydro && f1.panels && f1.events);
  const [f2] = ask({ type: "frame", run: false });
  assert.equal(f2.tick, 4, "a paused frame doesn't step");
  assert.ok(!f2.terrain && !f2.panels && !f2.events, "unchanged things aren't resent");
});

test("a selected creature's details come with every frame", () => {
  const { ask } = open();
  ask({ type: "new", seed: 32 });
  const [f] = ask({ type: "frame", run: true, speed: 1 });
  const id = f.cr[0];
  ask({ type: "select", id });
  const [g] = ask({ type: "frame", run: true, speed: 1 });
  assert.equal(g.sel.id, id);
  assert.equal(g.sel.inp.length, sim.NI);
  assert.ok(g.sel.name.includes(" "));
  ask({ type: "select", id: 0 });
  assert.equal(ask({ type: "frame", run: false })[0].sel, undefined);
  ask({ type: "select", id: 999999 });
  assert.equal(ask({ type: "frame", run: false })[0].missing, 999999, "a creature that's gone is reported once");
  assert.equal(ask({ type: "frame", run: false })[0].missing, undefined);
});

test("tools change the island and refresh the panels", () => {
  const { ask } = open();
  ask({ type: "new", seed: 33 });
  ask({ type: "frame", run: true, speed: 1 });
  ask({ type: "frame", run: true, speed: 1 });
  assert.deepEqual(ask({ type: "tool", tool: "meteor", x: 512, y: 512 }), []);
  const [f] = ask({ type: "frame", run: false });
  assert.equal(f.flashes[0].kind, "meteor");
  assert.deepEqual(f.actions, [{ t: 2, tool: "meteor", x: 512, y: 512 }], "the page hears what to put in its link");
  assert.equal(ask({ type: "frame", run: false })[0].actions, undefined);
  assert.ok(f.terrain, "the crater changed the ground");
  assert.ok(f.panels && f.events[0].text.includes("meteor"));
});

test("an island saved through one host loads into another and carries on identically", () => {
  const a = open(), b = open();
  a.ask({ type: "new", seed: 34 });
  a.ask({ type: "frame", run: true, speed: 600, budget: 1e9 });
  const [snap] = a.ask({ type: "save" });
  assert.equal(snap.type, "snapshot");
  assert.match(snap.name, /^primordia-island-34-day-\d+\.json$/);
  const [hello] = b.ask({ type: "load", text: snap.text });
  assert.deepEqual(hello, { type: "world", seed: 34, tick: 600, loaded: true, actions: [], replayable: true });
  const fa = a.ask({ type: "frame", run: true, speed: 300, budget: 1e9 })[0], fb = b.ask({ type: "frame", run: true, speed: 300, budget: 1e9 })[0];
  assert.deepEqual(Array.from(fb.cr), Array.from(fa.cr));
});

test("a bad file is reported, and the current island keeps running", () => {
  const { ask } = open();
  ask({ type: "new", seed: 35 });
  const [err] = ask({ type: "load", text: "{not json" });
  assert.equal(err.type, "error");
  assert.match(err.message, /not a saved Primordia island/);
  assert.equal(ask({ type: "frame", run: true, speed: 1 })[0].tick, 1);
});

test("a new island can start with actions to replay", () => {
  const { ask } = open();
  const actions = [{ t: 3, tool: "rain", x: 100, y: 100 }];
  assert.deepEqual(ask({ type: "new", seed: 36, actions })[0].actions, actions);
  const [f] = ask({ type: "frame", run: true, speed: 5 });
  assert.equal(f.flashes[0].kind, "rain", "the recorded rain fell on its tick");
  assert.equal(f.actions, undefined, "a replay doesn't change the link");
});
