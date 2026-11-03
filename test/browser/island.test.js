"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { setup, until, tick, ENGINE } = require("./helpers.js");
const { ISLANDS, fingerprint, PINNED } = require("../fingerprint.js");

const env = setup(test);
const fast = async page => { for (let i = 0; i < 3; i++) await page.click("#speed"); }; // 40×
const tap = async (page, fx, fy) => {
  const r = await page.$eval("#world", c => { const b = c.getBoundingClientRect(); return [b.left, b.top, b.width]; });
  await page.mouse.click(r[0] + r[2] * fx, r[1] + r[2] * fy);
};
const log = page => page.$$eval("#log li span", ls => ls.map(l => l.textContent));
const dayOf = (page, text) => page.$$eval("#log li", (ls, text) => { const l = ls.find(l => l.querySelector("span").textContent === text); return l && l.querySelector("time").textContent; }, text);

test("the island runs in a worker, keeps its link and shows no errors", { timeout: 60000 }, async () => {
  const page = await env.open("#island-5"), workers = [];
  page.on("worker", w => workers.push(w.url()));
  await until(() => tick(page).then(t => t > 20), 15000, "the island to run");
  assert.equal(await page.evaluate(() => location.hash), "#island-5");
  assert.match(await page.textContent("#seedline"), /This is island 5\./);
  assert.ok(+(await page.textContent("#s-herb")) > 0, "grazers are counted");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("using a tool goes into the link, and opening the link replays it on the same day", { timeout: 120000 }, async () => {
  const page = await env.open("#island-777");
  await fast(page);
  await until(() => tick(page).then(t => t > 1500), 30000, "a few days to pass");
  await page.click("#play");
  await page.click("[data-tool=meteor]");
  await tap(page, 0.5, 0.55);
  const link = await until(() => page.evaluate(() => /\/m\d+\.\d+\.\d+$/.test(location.hash) && location.hash), 5000, "the link to record the meteor");
  const struck = await until(() => log(page).then(l => l.find(t => t.includes("meteor"))), 5000, "the meteor in the log");
  const day = await dayOf(page, struck);
  await page.close();
  const again = await env.open(link.slice(1).replace(/^/, "#"));
  await fast(again);
  const replayed = await until(() => log(again).then(l => l.find(t => t.includes("meteor"))), 90000, "the replayed meteor");
  assert.equal(replayed, struck, "the same meteor, with the same toll");
  assert.equal(await dayOf(again, replayed), day);
  assert.deepEqual(again.errors, []);
  await again.close();
});

test("tapping a living species opens one of its creatures", { timeout: 60000 }, async () => {
  const page = await env.open("#island-5");
  await until(() => page.$("#species .lin"), 15000, "the species list");
  await page.click("#species .lin");
  const name = await until(() => page.evaluate(() => { const n = document.querySelector("#i-name"); return n && n.textContent; }), 10000, "the inspector");
  assert.match(name, /#\d+$/);
  assert.match(await page.textContent("#i-water-v"), /^\d+%$/, "with its water");
  assert.equal(await page.$$eval("#brain", c => c.length), 1, "and its brain");
  await page.close();
});

test("a saved island loads back, and a tampered file is refused without running its code", { timeout: 60000 }, async () => {
  const page = await env.open("#island-8");
  await until(() => tick(page).then(t => t > 50), 15000, "the island to run");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  const file = env.temp("island.json");
  await download.saveAs(file);
  assert.match(download.suggestedFilename(), /^primordia-island-8-day-\d+\.json$/);
  await page.setInputFiles("#load-file", file);
  await until(() => page.textContent("#notice").then(t => t.startsWith("Loaded island 8")), 10000, "the load notice");
  const o = JSON.parse(fs.readFileSync(file, "utf8"));
  o.records.kids.v = '<img src=x onerror="window.__pwned=1">';
  const bad = env.temp("tampered.json");
  fs.writeFileSync(bad, JSON.stringify(o));
  await page.setInputFiles("#load-file", bad);
  await until(() => page.textContent("#notice").then(t => t.includes("damaged")), 10000, "the refusal");
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "the file's code never ran");
  const before = await tick(page);
  await until(() => tick(page).then(t => t > before), 10000, "the island to keep running");
  await page.close();
});

test("a drawing error is reported once, and the island carries on when it clears", { timeout: 60000 }, async () => {
  const page = await env.open("#island-5");
  await until(() => tick(page).then(t => t > 20), 15000, "the island to run");
  await page.evaluate(() => { const f = CanvasRenderingContext2D.prototype.fillText; window.__restore = () => { CanvasRenderingContext2D.prototype.fillText = f; }; CanvasRenderingContext2D.prototype.fillText = () => { throw new Error("draw failed"); }; });
  await until(() => page.textContent("#notice").then(t => t.includes("Something went wrong drawing")), 10000, "the notice");
  const during = await tick(page);
  await until(() => tick(page).then(t => t > during + 30), 10000, "the simulation to keep going");
  await page.evaluate(() => window.__restore());
  assert.equal(page.errors.filter(e => e.includes("draw failed")).length, 1, "logged once");
  await page.close();
});

test("a split link opens the scenario, and keeps it while tools are used", { timeout: 60000 }, async () => {
  const page = await env.open("#split-1003");
  await until(() => page.textContent("#seedline").then(t => t.includes("rich island")), 10000, "the seed line");
  await until(() => tick(page).then(t => t > 20), 15000, "the island to run");
  await page.click("[data-tool=rain]");
  await tap(page, 0.3, 0.5);
  await until(() => page.evaluate(() => location.hash.startsWith("#split-1003/r")), 5000, "the link to record the rain");
  await page.click("#reset");
  await until(() => page.evaluate(() => location.hash.startsWith("#island-")), 5000, "a usual island");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("an archipelago link opens the scenario, and says so", { timeout: 60000 }, async () => {
  const page = await env.open("#isles-1005");
  await until(() => page.textContent("#seedline").then(t => t.startsWith("This is archipelago 1005.") && t.includes("four rich islands")), 10000, "the seed line");
  await until(() => tick(page).then(t => t > 20), 15000, "the archipelago to run");
  assert.equal(await page.evaluate(() => location.hash), "#isles-1005");
  assert.ok(+(await page.textContent("#s-herb")) > 0, "grazers are counted");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("opened straight from disk, the island still runs", { timeout: 60000 }, async () => {
  const page = await env.open(env.fileUrl("index.html") + "#island-5");
  await until(() => tick(page).then(t => t > 20), 15000, "the island to run");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("without workers, the page runs the island itself", { timeout: 60000 }, async () => {
  const page = await env.open("#island-5", {}, { workers: false });
  await until(() => tick(page).then(t => t > 20), 15000, "the island to run");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("on a phone, nothing scrolls sideways, in either theme", { timeout: 60000 }, async () => {
  for (const colorScheme of ["light", "dark"]) for (const where of ["#island-5", "experiments.html"]) {
    const page = await env.open(where, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${where} in ${colorScheme}`);
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});

test(`${ENGINE} computes the same islands as Node, bit for bit`, { timeout: 120000 }, async () => {
  const page = await env.open("experiments.html");
  for (let i = 0; i < ISLANDS.length; i++)
    assert.equal(await page.evaluate(`(${fingerprint})({ makeWorld, step, serialize }, ${JSON.stringify(ISLANDS[i])})`), PINNED[i]);
  await page.close();
});

