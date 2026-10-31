"use strict";
/* Runs experiment islands off the page's main thread for experiments.html. Each message asks for
   one island, {id, arm, island}; the replies carry its daily measurements in batches, then done. */
importScripts("sim.js", "experiments.js");
onmessage = e => {
  if (e.data === "ping") return postMessage("pong"); // the page checking that workers run here
  const { id, arm, island } = e.data, t = trial(experiment(id), arm, island);
  while (!t.done()) postMessage({ arm, island, days: t.run(1000) });
  postMessage({ arm, island, done: true });
};
