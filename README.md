# Primordia 🧬

An island where creatures with tiny neural brains graze, hunt, call to each other and split into new species. Nothing is scripted: every behavior you see was inherited, and every brain is slightly different from its parent's.

## Run it

Open `index.html` in a browser. There's no build step.

```bash
npm start        # serves the folder at http://localhost:3000
npm test         # runs the simulation tests (Node 20+)
```

Every push to `main` runs the tests and deploys to GitHub Pages. Add `#island-12345` to the URL to reopen a specific island. The terrain is the same each time, but history plays out differently.

## What you can do

| Tool | What happens |
| --- | --- |
| Inspect | Tap a creature to see its genes and a live diagram of its brain, then follow it with a zoomed camera |
| Bring rain | Plants spring up wherever you tap |
| Drop hunters | Three hunters of a brand-new species land where you tap |
| Aim a meteor | Wipes out everything in the blast radius |
| Start a plague | Infects the creatures around where you tap |

## How it works

**The island** is generated from fractal value noise shaped by a radial falloff. Each terrain type has its own fertility and movement cost. Plants regrow logistically, faster in summer and slower in winter. Random climate events can hit at the start of a season: summer droughts, spring blooms and long hard freezes. When a creature dies, its body fertilizes the ground where it fell.

**Each creature** carries a genome: body size, top speed, sight range, diet (0 is pure grazer, 1 is pure hunter) and mutation rate. Bigger and faster bodies burn more energy. Hunters can kill anything up to 15% bigger than themselves.

**Each brain** is a 14 → 8 → 4 feed-forward network with tanh activations.

| Inputs (14) | Outputs (4) |
| --- | --- |
| Plants, prey and hunters seen by the left, centre and right eyes (9) | Turn |
| Energy, water ahead, an internal pulse (3) | Speed |
| Calls heard from nearby creatures | Call (costs energy) |
| Memory, which is last tick's memory output | Memory |

Calling and memory start mostly switched off. Whether they evolve depends on whether they help a lineage survive, for example warning relatives about hunters. The island log notes when calling becomes common and when it falls out of use.

**Reproduction** is asexual. When a creature has enough energy it splits, and the child's genes and every brain weight are mutated by an amount set by the parent's own mutation-rate gene.

**Species** are recognised by genetic distance, combining a body-gene distance with the mean absolute difference between brain weights. Each species' reference point is the running average of its members, so a lineage that drifts as a whole stays one species. A new species is named only when a group of creatures is more than `SPECIES_GAP` (0.6) from every existing species. Measured within-species spread is about 0.2 typical and 0.47 at the 99th percentile, so 0.6 catches real splits rather than noise. Daughter species keep their parent's genus until a genus gets crowded, and the epithet describes the body (*velox* for fast, *ferox* for hunters, *minima* for small).

**Plague** spreads on contact, costs energy, slows its host and lasts 700 ticks. Hunters can catch it from sick prey. Survivors are immune for life, but their children aren't.

## Project layout

```
index.html          markup
styles.css          light and dark themes
src/sim.js          simulation core (no DOM, runs in Node)
src/ui.js           rendering, camera, tools, panels
test/sim.test.js    simulation tests
.github/workflows   CI tests and GitHub Pages deploy
```

## Roadmap

- [x] Shareable islands via `#island-1234`
- [x] Brains with memory
- [x] Species recognition and naming
- [x] Interventions: rain, hunters, meteors, plague
- [x] Climate events
- [ ] Save and load a world snapshot
- [ ] Sexual reproduction with crossover between members of the same species
- [ ] A family-tree view of species splits
- [ ] Move the simulation into a Web Worker for bigger populations
- [ ] Rivers, rain and erosion
- [ ] Evolvable body plans (more eyes, longer sight cones)

## License

MIT
