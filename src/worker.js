"use strict";
/* Runs the simulation off the page's main thread. The messages are described in src/host.js. */
importScripts("sim.js", "host.js");
const host = makeHost((msg, transfer) => postMessage(msg, transfer || []));
onmessage = e => host.handle(e.data);
