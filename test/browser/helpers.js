"use strict";
/* Shared setup for the browser tests: a small static server for the project folder, and pages that
   collect their own errors. Requests to other hosts (the web font) get an empty answer, so the tests
   don't depend on the network. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const playwright = require("playwright");

// The engine to test in: chromium (the default), firefox or webkit, which is what Safari runs on.
const ENGINE = process.env.BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(ENGINE)) throw new Error(`BROWSER must be chromium, firefox or webkit, not ${ENGINE}`);

const ROOT = path.join(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  return new Promise(ok => {
    const server = http.createServer((req, res) => {
      let file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
      if (file.endsWith(path.sep)) file = path.join(file, "index.html");
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
  });
}

/* Starts the server and a browser once per test file. open() takes a path under the project (served)
   or a file:// URL, and returns a page whose .errors lists anything that went wrong on it. With
   { workers: false } the page has no Web Workers, so it runs the simulation itself. */
function setup(test) {
  const env = {};
  test.before(async () => { env.server = await serve(); env.browser = await playwright[ENGINE].launch(); });
  test.after(async () => { await env.browser.close(); env.server.close(); });
  env.open = async (where, options = {}, { workers = true } = {}) => {
    const page = await env.browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...options });
    page.errors = [];
    page.on("pageerror", e => page.errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") page.errors.push(m.text()); });
    await page.route("**/*", r => /^https?:/.test(r.request().url()) && !r.request().url().startsWith(env.server.url) ? r.fulfill({ status: 200, body: "" }) : r.continue());
    // the simulation's tick, as the page last heard it: from the worker's frames, or from the page's own steps
    await page.addInitScript(() => {
      const W = window.Worker;
      if (W) window.Worker = class extends W { constructor(...a) { super(...a); this.addEventListener("message", e => { if (e.data && e.data.type === "frame") window.__tick = e.data.tick; }); } };
    });
    if (!workers) await page.addInitScript(() => { window.Worker = undefined; });
    await page.goto(where.startsWith("file:") ? where : env.server.url + where);
    await page.evaluate(() => { if (typeof step === "function") { const real = step; window.step = w => { real(w); window.__tick = w.tick; }; } });
    return page;
  };
  env.fileUrl = name => "file://" + path.join(ROOT, name);
  env.temp = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "primordia-")), name);
  return env;
}

/* Waits until fn() gives something truthy, and returns it. */
async function until(fn, ms = 30000, what = "the condition") {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

/* The island's tick, as the page last heard it from the simulation. */
const tick = page => page.evaluate(() => window.__tick || 0);

module.exports = { setup, until, tick, ROOT, ENGINE };
