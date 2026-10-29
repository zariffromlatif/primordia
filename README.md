# Primordia 🧬

An island where creatures with tiny neural brains graze, hunt, pair up, call to each other and split into new species, while storms roll in and rain carves rivers through the land. Nothing is scripted: every behavior you see was inherited, and every brain is a mix of its parents' with a few mutations of its own.

## Run it

Open `index.html` in a browser. There's no build step.

```bash
npm start        # serves the folder at http://localhost:3000
npm test         # runs the simulation tests (Node 20+)
```

When the page is served, the simulation runs in a Web Worker, so even a crowded island at 40× speed never stalls drawing. Browsers don't allow workers on pages opened straight from disk, so then the page runs the simulation itself. It works the same, just with a smaller time budget per frame.

Every push to `main` runs the tests and deploys to GitHub Pages. Add `#island-12345` to the URL to reopen a specific island. Every random number comes from the island's own seeded generator, so the same link replays the same terrain and the same history until someone uses a tool. History is only guaranteed to match in the same browser, since browsers can round some maths functions differently.

## What you can do

| Tool | What happens |
| --- | --- |
| Inspect | Tap a creature to see its genes, its eyes' sight cone and a live diagram of its brain, then follow it with a zoomed camera |
| Bring rain | Plants spring up wherever you tap, and a storm settles there and swells the rivers |
| Drop hunters | Three hunters of a brand-new species land where you tap |
| Aim a meteor | Wipes out everything in the blast radius and leaves a crater that can fill into a lake |
| Start a plague | Infects the creatures around where you tap |
| Save / Load | Downloads the island as a JSON file. Loading it, or dropping it onto the map, carries on from exactly that moment |

The **family tree** shows every species as a line from the day it split off to today or to its extinction, joined to the species it came from. By default it shows only lineages still alive and their ancestors. Tap a living species to inspect one of its members.

## How it works

**The island** is generated from fractal value noise shaped by a radial falloff. Each terrain type has its own fertility, movement cost, dryness and resistance to erosion. Plants regrow logistically, faster in summer and in damp soil. Random climate events can hit at the start of a season: summer droughts, wet spring blooms and long hard freezes. When a creature dies, its body fertilizes the ground where it fell.

**Water** follows the terrain. A priority-flood pass visits cells from the sea upward, which gives every land cell the neighbor it drains into and fills each hollow to its spill point; the standing water above the ground is a lake. Rain falls as a light drizzle, heavier on high ground and in wet seasons, plus storms that form at random and drift with a wandering wind. The rain that falls on each cell is smoothed two ways:

- **Quick runoff** swells the rivers after a storm.
- **Slow groundwater** keeps the big rivers running through a dry summer.

Both are routed downhill every 20 ticks. A channel only shows where the groundwater supply is steady, so a passing storm swells existing rivers without painting new ones across flat ground. Soil moisture rises with rain and near rivers and lakes, dries out faster in summer and on sand and rock, and drives plant growth.

**Erosion** runs every 200 ticks. Rivers cut their beds in proportion to their flow and slope, slower through forest and much slower through rock. What they carry is dropped where the water slows down:

- **In lakes**, which slowly silt up.
- **At the coast**, where deltas grow out into the sea.

The terrain, lakes and drainage are recomputed after every pass, so rivers can change course over the years.

**Each creature** carries a genome: body size, top speed, sight range, diet (0 is pure grazer, 1 is pure hunter), mutation rate, and a body plan of how many eyes it has (1 to 6) and how wide its field of view is. The field of view is split evenly between the eyes. More eyes see the world in finer slices. Bigger and faster bodies burn more energy, every eye has a running cost, and long, wide sight cones cost more than narrow ones. Hunters can kill anything up to 15% bigger than themselves.

**Each brain** is a 23 → 8 → 4 feed-forward network with tanh activations.

| Inputs (23) | Outputs (4) |
| --- | --- |
| Plants, prey and hunters seen by each eye: 3 slots for each of up to 6 eyes, filled only for the eyes the body has (18) | Turn |
| Energy, water ahead (sea, lakes and rivers), an internal pulse (3) | Speed |
| Calls heard from nearby creatures | Call (costs energy) |
| Memory, which is last tick's memory output | Memory |

The wiring for eyes a creature doesn't have is still inherited and still mutates, but it does nothing until a mutation adds the eye. Calling and memory start mostly switched off. Whether they evolve depends on whether they help a lineage survive, for example warning relatives about hunters. The island log notes when calling becomes common and when it falls out of use.

**Reproduction** is mostly sexual. A well-fed adult looks for a ready member of its own species close by:

- **If it finds one,** they each give up some energy to a child. Every body gene comes from one parent or the other, and so does each hidden neuron, along with all of its incoming and outgoing wiring, so working circuits are passed on whole.
- **If it finds none for a while,** it buds a child on its own, so a lone pioneer can still found a population.

Either way, the child's genes and brain weights are then mutated by an amount set by the parents' mutation-rate genes. The island log notes when pairs come to produce most of the young, and when mates grow too scarce for that.

**Species** are recognised by genetic distance. It combines body-gene distance, including eye count and field of view, with the mean absolute difference between brain weights; only the eyes both creatures actually have are compared. Each species' reference point is the running average of its members, so a lineage that drifts as a whole stays one species. A new species is named only when at least three creatures that are close to each other are all more than `SPECIES_GAP` (0.6) from every existing species. A lone outlier stays with the species it came from. Measured within-species spread is about 0.4 typical and 0.56 at the 90th percentile. Daughter species keep their parent's genus until a genus gets crowded, and the epithet describes the body (*velox* for fast, *ferox* for hunters, *argus* for many-eyed, *cyclops* for one-eyed).

**Plague** spreads on contact, costs energy, slows its host and lasts 700 ticks. Hunters can catch it from sick prey. Survivors are immune for life, but their children aren't.

**Snapshots** are plain JSON holding everything that can't be worked out again: the terrain heights, plants, water and soil grids, every creature and its brain, every species, the log, and the random generator's state. Drainage, lakes and terrain types are rebuilt on load, so a loaded island carries on exactly as the saved one would have.

**The worker** owns the world and answers messages from the page. Every animation frame the page asks for the next frame, and the worker steps the simulation by the chosen speed (within a time budget). It replies with:

- **Every frame:** creature positions, plant cover, weather and the selected creature's brain.
- **When they change:** terrain and water.
- **A few times a second:** species, history and records.

Drawing never waits on the simulation, and the population cap is 1,000, up from 380.

## Project layout

```
index.html          markup
styles.css          light and dark themes
src/sim.js          simulation core (no DOM, runs in Node, a worker or the page)
src/host.js         owns a world and talks to the page in messages
src/worker.js       runs the host in a Web Worker
src/ui.js           rendering, camera, tools, panels, family tree
test/sim.test.js    simulation tests
test/host.test.js   message protocol tests
.github/workflows   CI tests and GitHub Pages deploy
```

## Roadmap

- [x] Shareable islands via `#island-1234`
- [x] Brains with memory
- [x] Species recognition and naming
- [x] Interventions: rain, hunters, meteors, plague
- [x] Climate events
- [x] Deterministic history from a seed
- [x] Save and load a world snapshot
- [x] Sexual reproduction with crossover between members of the same species
- [x] A family-tree view of species splits
- [x] Move the simulation into a Web Worker for bigger populations
- [x] Rivers, rain and erosion
- [x] Evolvable body plans (more eyes, longer sight cones)
- [ ] Record interventions so a link can replay them too
- [ ] Drinking: thirst that pulls creatures toward rivers and lakes
- [ ] Mate choice, so sexual selection can shape a species

## License

MIT
