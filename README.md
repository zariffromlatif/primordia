# Primordia 🧬

An island where creatures with tiny neural brains graze, hunt, learn, court mates, call to each other and split into new species, evolving by Darwin's natural and sexual selection while storms roll in, rain carves rivers through the land and thirsty herds come down to drink. Nothing is scripted: every behavior you see was inherited or learned, and every brain is a mix of its parents' with a few mutations of its own.

## Run it

Open `index.html` in a browser. There's no build step.

```bash
npm start        # serves the folder at http://localhost:3000
npm test         # runs the simulation tests (Node 20+)
npm run ecology  # runs 8 islands for 10 years and reports how well the ecology sustains itself
npm run experiment  # runs the experiments headless and prints their verdicts
```

When the page is served, the simulation runs in a Web Worker, so even a crowded island at 40× speed never stalls drawing. Browsers don't allow workers on pages opened straight from disk, so then the page runs the simulation itself. It works the same, just with a smaller time budget per frame.

Every push to `main` runs the tests and deploys to GitHub Pages. Add `#island-12345` to the URL to reopen a specific island. Every random number comes from the island's own seeded generator, and every use of a tool is recorded in the link as it happens. For example, `#island-12345/m5000.512.300` adds a meteor on tick 5000 at (512, 300). So a link replays an island's whole history, including everything anyone did to it, at the same moments. Using a tool during a replay takes history somewhere new: the link keeps what has happened so far plus the new action, and drops the rest of the replay. History is only guaranteed to match in the same browser and the same version of Primordia, since browsers can round some maths functions differently.

## What you can do

| Tool | What happens |
| --- | --- |
| Inspect | Tap a creature to see its genes, its eyes' sight cone, its inner state, what it has learned and a live diagram of its brain, then follow it with a zoomed camera |
| Feed one | Fills a creature's energy so it breeds sooner. Do it to the creatures you like and you're doing artificial selection |
| Bring rain | Plants spring up wherever you tap, and a storm settles there and swells the rivers |
| Drop hunters | Three hunters of a brand-new species land where you tap |
| Aim a meteor | Wipes out everything in the blast radius and leaves a crater that can fill into a lake |
| Start a plague | Infects the creatures around where you tap |
| Save / Load | Downloads the island as a JSON file. Loading it, or dropping it onto the map, carries on from exactly that moment |

The **family tree** shows every species as a line from the day it split off to today or to its extinction, joined to the species it came from. By default it shows only lineages still alive and their ancestors. Tap a living species to inspect one of its members.

## Experiments

`experiments.html`, linked from the island page, asks questions by running **twin islands**. Twins share a seed, so they rise from the sea with the same terrain and the same founders, and differ in just one rule. Islands vary a lot on their own, so one pair would prove little: each experiment runs several pairs and counts how many came out the same way. A difference counts as clear only when chance alone would produce that much agreement less than 1 time in 20, which is a two-sided sign test. Each chart shows every island faintly and each side's average in bold, the shaded final year is what the verdict compares, and a table lists every pair.

| Question | The one rule that differs | Result, over the final year |
| --- | --- | --- |
| Does learning pay? | Nobody can learn | 37 grazers against 146, and 8% against 70% knowing the safe plant. 6 of 6 pairs, both times |
| What keeps learning alive? | No poison | Learning falls to 0.63% against 1.08%. 9 of 10 pairs |

These are Chromium's numbers; like island links, experiments give the same result every time in the same browser. The page runs several islands at once in Web Workers, or one at a time when it's opened straight from disk. Other questions were tried and left out because their twins didn't agree clearly within a few years: whether choosy mates keep ornaments large, whether hunters change the grazers, whether one eye is worse than several, and whether the island is steadier without winter. Islands with thirst kept more grazers than islands without it, on 6 of 6 pairs, but that isn't understood yet, so it isn't on the page.

## How it works

**The island** is generated from fractal value noise shaped by a radial falloff. Each terrain type has its own fertility, movement cost, dryness and resistance to erosion. Plants regrow logistically, faster in summer and in damp soil. Grazing leaves the roots: a plant can't be eaten below 15% of what its ground can grow, so grazed land grows back instead of staying bare. Random climate events can hit at the start of a season: summer droughts, wet spring blooms and long hard freezes. When a creature dies, its body fertilizes the ground where it fell.

**Water** follows the terrain. A priority-flood pass visits cells from the sea upward, which gives every land cell the neighbor it drains into and fills each hollow to its spill point; the standing water above the ground is a lake. Rain falls as a light drizzle, heavier on high ground and in wet seasons, plus storms that form at random and drift with a wandering wind. The rain that falls on each cell is smoothed two ways:

- **Quick runoff** swells the rivers after a storm.
- **Slow groundwater** keeps the big rivers running through a dry summer.

Both are routed downhill every 20 ticks. A channel only shows where the groundwater supply is steady, so a passing storm swells existing rivers without painting new ones across flat ground. Soil moisture rises with rain and near rivers and lakes, dries out faster in summer and on sand and rock, and drives plant growth.

**Thirst** pulls creatures toward that water. A body dries out faster in hot weather, when moving fast and when it's big. Rivers and lakes refill it quickly, and puddles after heavy rain refill it slowly. Juicy plants in damp soil give a little, and the blood of a fresh kill gives a good drink. A creature low on water burns extra energy, and one that runs dry soon dies of thirst. The island log reports seasons when many creatures died of thirst.

**Erosion** runs every 200 ticks. Rivers cut their beds in proportion to their flow and slope, slower through forest and much slower through rock. What they carry is dropped where the water slows down:

- **In lakes**, which slowly silt up.
- **At the coast**, where deltas grow out into the sea.

The terrain, lakes and drainage are recomputed after every pass, so rivers can change course over the years.

**Each creature** carries a genome: body size, top speed, sight range, diet (0 is pure grazer, 1 is pure hunter), mutation rate, and a body plan of how many eyes it has (1 to 6) and how wide its field of view is. The field of view is split evenly between the eyes. More eyes see the world in finer slices. Bigger and faster bodies burn more energy, every eye has a running cost, and long, wide sight cones cost more than narrow ones. Hunters can kill anything up to 15% bigger than themselves, except hunters of their own species, newborns included.

**Each brain** is a 33 → 8 → 6 feed-forward network with tanh activations.

| Inputs (33) | Outputs (6) |
| --- | --- |
| Food, prey, hunters and fresh water seen by each eye: 4 slots for each of up to 6 eyes, filled only for the eyes the body has (24) | Turn |
| Energy, water ahead (sea, lakes and rivers), an internal pulse, feeling poisoned, thirst (5) | Speed |
| Call A heard, call B heard | Call A, call B (each costs energy) |
| Memory, which is last tick's memory output | Memory |
| Surprise | How dangerous it expects the next moment to be |

The wiring for eyes a creature doesn't have is still inherited and still mutates, but it does nothing until a mutation adds the eye. Food is seen through what the creature has learned about it (see Minds), and fresh water from up to six cells away, more clearly the closer it is. Calling and memory start mostly switched off. Whether they evolve depends on whether they help a lineage survive. The island log notes when calling becomes common and when it falls out of use.

**Reproduction** is mostly sexual. A well-fed adult looks for a ready member of its own species close by:

- **If it finds one,** it picks the most attractive (see Darwin), and they each give up some energy to a child. Every body gene comes from one parent or the other, and so does each hidden neuron, along with all of its incoming and outgoing wiring, so working circuits are passed on whole.
- **If it finds none for a while,** it buds a child on its own, so a lone pioneer can still found a population.

Either way, the child's genes and brain weights are then mutated by an amount set by the parents' mutation-rate genes. The island log notes when pairs come to produce most of the young, and when mates grow too scarce for that.

**Species** are recognised by genetic distance. It combines body-gene distance, including eye count and field of view, with the mean absolute difference between brain weights; only the eyes both creatures actually have are compared. Each species' reference point is the running average of its members, so a lineage that drifts as a whole stays one species. A new species is named only when at least three creatures that are close to each other are all more than `SPECIES_GAP` (0.6) from every existing species. A lone outlier stays with the species it came from. Measured within-species spread is about 0.4 typical and 0.56 at the 90th percentile. Daughter species keep their parent's genus until a genus gets crowded, and the epithet describes the body (*velox* for fast, *ferox* for hunters, *argus* for many-eyed, *cyclops* for one-eyed).

**Plague** spreads on contact, costs energy, slows its host and lasts 700 ticks. Hunters can catch it from sick prey. Survivors are immune for life, but their children aren't.

**Snapshots** are plain JSON (format 3) holding everything that can't be worked out again, including what every creature has learned and the island's running measurements: the terrain heights, plants, water and soil grids, every creature and its brain, every species, the log, the recorded actions and the random generator's state. Drainage, lakes and terrain types are rebuilt on load, so a loaded island carries on exactly as the saved one would have. Every field is checked before anything is loaded, so a damaged or hand-edited file is refused instead of breaking the page. Saves in format 2, from before thirst and recorded actions, still load: the new brain inputs start unwired, every creature starts with a full drink, and since those saves recorded no actions, their link only replays how the island began.

**The worker** owns the world and answers messages from the page. Every animation frame the page asks for the next frame, and the worker steps the simulation by the chosen speed (within a time budget). It replies with:

- **Every frame:** creature positions, plant cover, weather and the selected creature's brain.
- **When they change:** terrain and water.
- **A few times a second:** species, history and records.

Drawing never waits on the simulation, and the population cap is 1,000, up from 380.

## Darwin

Primordia runs on the mechanism Darwin described in *On the Origin of Species* (1859), and each part of his argument maps to something you can see.

| Darwin's idea | In Primordia |
| --- | --- |
| Variation | Every creature has slightly different genes and brain wiring |
| Inheritance | Children get their genes and inborn brain from their parents |
| Struggle for existence | Far more are born than survive. The Natural selection panel shows the share of creatures that die without leaving offspring |
| Natural selection | Traits that help creatures survive and breed become common. The panel measures this live (see below) |
| Sexual selection | Creatures choose mates. Ornaments, drawn as fan-shaped tails, cost energy but attract partners |
| Divergence and common descent | Species split and go extinct, drawn live as the family tree |
| Artificial selection | The Feed one tool lets you choose who breeds, as Darwin's pigeon breeders did |

**Measuring natural selection.** Every 5 days the island compares the parents of every grazer born with the grazer population as a whole, trait by trait. The gap, in standard deviations, is the selection differential, the standard measure in evolutionary biology. The log reports selection only when the same direction holds for 15 days running and is larger than 0.4 standard deviations. Shorter blips are mostly sampling noise.

**Sexual selection.** Each creature has an ornament gene and a mate-preference gene. A creature ready to breed picks the most attractive ready partner in reach, not just the nearest. An ornament only shines on a well-fed body, so showy partners also tend to be good foragers. Creatures start with a mild bias toward showy partners, which biologists call sensory bias. Ornaments grow on some islands and stay small on others, much as sexual selection produces peacocks in some lineages and nothing in others.

## Minds

This section is about intelligence-like abilities, and it's deliberately careful about what it claims.

**Learning from experience.** The island grows gold and blue plants in patches. At the start of each season there's a 50% chance that the poison switches colours, so which plant is safe can't be known at birth. Each grazer keeps a learned value for each colour, starting from an inherited "born liking" gene. Every bite nudges that value toward what happened: up for a good meal, down for poison. The grazer sees food through those values, so its instincts steer it toward plants it trusts and away from ones it doesn't, and it refuses to eat a plant it has learned is bad. This is modelled on taste-aversion learning, one of the most reliable kinds of learning in animals.

Learning costs energy every tick, in proportion to the learning-rate gene, so evolution decides how much of it is worth having. In headless runs on this version (6 islands, 5 years each), grazers fixed at a 2% learning rate kept about twice the population of non-learners (131 against 66 on average) and 76% of them knew which colour was safe, against 17%. Islands where every founder starts unable to learn are back to about 0.8% after the first year and settle near 0.9%, where its benefit balances its cost. Children inherit their parents' genes, not what their parents learned.

**Prediction and surprise.** One output is a guess at how dangerous the next moment will be. The gap between that guess and what actually happens is the creature's surprise, which is fed back in as a sense. Learning creatures tune their guesses from experience, so surprise falls as they get better at anticipating danger. This borrows from predictive-processing theories of the brain.

**Meaningful calls.** Every 5 days the island measures whether each call goes with what the caller sees. If callers see hunters far more than average when making a call, it counts as an alarm call. If they see food, it counts as a food call. A meaning must hold for two measurements in a row before the log reports it. The island also checks comprehension: whether creatures that hear a call speed up while they can't see a hunter themselves. Food calls emerge fairly often. Alarm calls need hunters around to evolve, so dropping hunters helps.

**The inspector's inner state** shows hunger, fear, surprise, mood, learned tastes, the sense currently having the most influence on the brain, and a plain-English readout of all of that. These are translations of numbers in the simulation. They describe what a creature is doing, not what, if anything, it experiences.

**What this is not.** These creatures are not conscious, and nothing here gets close to human intelligence. Each brain has at most 47 neurons. A honeybee has about a million and a human about 86 billion. Nobody knows how to build consciousness, and scientists don't agree on what it is. What Primordia can do is let you watch some of the ingredients that theories of mind point to (learning, prediction, attention and communication) evolve under pressure, and see when they don't.

## Project layout

```
index.html          markup
experiments.html    the experiments page
styles.css          light and dark themes
src/sim.js          simulation core (no DOM, runs in Node, a worker or the page)
src/host.js         owns a world and talks to the page in messages
src/worker.js       runs the host in a Web Worker
src/ui.js           rendering, camera, tools, panels, family tree
src/experiments.js  the experiments, their twin islands and their verdicts (no DOM)
src/lab.js          runs experiment islands in a Web Worker
src/experiments-ui.js  the experiments page: runs, charts, tables
test/sim.test.js    simulation tests
test/host.test.js   message protocol tests
test/experiments.test.js  experiment rules, runs and verdicts
tools/ecology.js    ecology report: do hunters hold on, and how often do grazers nearly die out?
tools/experiment.js runs the experiments headless
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
- [x] Record interventions so a link can replay them too
- [x] Drinking: thirst that pulls creatures toward rivers and lakes
- [x] Mate choice, so sexual selection can shape a species
- [x] Learning from experience, with a measured payoff
- [x] Prediction and surprise
- [x] Two calls, with measured meaning and comprehension
- [x] Live natural-selection meter and struggle for existence
- [x] Artificial selection tool
- [x] Experiments: twin islands that differ in one rule, with a measured verdict
- [ ] Archipelago islands to study speciation by geographic isolation, as with Darwin's Galápagos finches

## License

MIT
