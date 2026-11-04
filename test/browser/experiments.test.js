"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, until } = require("./helpers.js");

const env = setup(test);

test("a link to an experiment starts it in workers, and it can be stopped", { timeout: 60000 }, async () => {
  const page = await env.open("experiments.html#learning"), workers = [];
  page.on("worker", w => workers.push(w.url()));
  await until(() => page.textContent("#engine").then(t => /island(s)? at a time/.test(t)), 10000, "the engine note");
  await until(() => page.$eval("#learning .xp-progress em", e => parseInt(e.textContent) > 0), 30000, "progress");
  assert.ok(workers.some(u => u.endsWith("src/lab.js")), "islands run in workers");
  assert.match(await page.textContent("#learning .verdict"), /^Running/);
  await page.click("#learning .stop");
  await until(() => page.textContent("#learning .verdict").then(t => t.startsWith("Stopped before the end")), 5000, "the stop");
  assert.equal(await page.isVisible("#learning .run"), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("without workers, a short experiment runs in the page to a verdict, a chart and a table of every pair", { timeout: 180000 }, async () => {
  const page = await env.open("experiments.html", {}, { workers: false });
  await until(() => page.textContent("#engine").then(t => t.includes("one island at a time")), 10000, "the engine note");
  await page.evaluate(() => { const x = EXPERIMENTS.find(e => e.id === "learning"); x.years = 1; x.islands = 3; }); // a quick version
  await page.click("#learning .run");
  await until(() => page.textContent("#learning .verdict").then(t => !t.startsWith("Running")), 150000, "the verdict");
  const verdicts = await page.$$eval("#learning .verdict", ps => ps.map(p => p.textContent));
  assert.equal(verdicts.length, 2);
  for (const v of verdicts) assert.match(v, /^(Clear difference|No clear difference)\. .* over the last year: /);
  assert.equal(await page.evaluate(() => location.hash), "#learning", "the run can be shared");
  assert.equal(await page.$$eval("#learning .xp-chart:first-of-type path.mean", p => p.length), 2, "an average line for each kind of island");
  const svg = await page.$("#learning .xp-chart svg"), box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  assert.equal(await page.$$eval("#learning .xp-chart .tip .tip-row", r => r.length), 2, "hovering reads out both averages");
  await page.click("#learning .numbers");
  assert.equal(await page.$$eval("#learning .xp-chart:first-of-type tbody tr", r => r.length), 3, "one row per pair");
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("opened straight from disk, the experiments page still sets itself up", { timeout: 30000 }, async () => {
  const page = await env.open(env.fileUrl("experiments.html"));
  await until(() => page.textContent("#engine").then(t => /at a time/.test(t)), 10000, "the engine note");
  assert.equal(await page.$$eval("#experiments .xp", s => s.length), 4);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("the experiments page links to the islands where a species splits, and to archipelagos where it becomes several", { timeout: 30000 }, async () => {
  const page = await env.open("experiments.html");
  const links = await page.$$eval("#watch .watch a", as => as.map(a => a.getAttribute("href")));
  assert.deepEqual(links, ["index.html#split-1014", "index.html#split-1015", "index.html#split-1019"]);
  const isles = await page.$$eval("#watch-isles .watch a", as => as.map(a => a.getAttribute("href")));
  assert.deepEqual(isles, ["index.html#isles-1001", "index.html#isles-1009", "index.html#isles-1013"]);
  await page.close();
});
