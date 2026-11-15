# Verde Block 4 — Hydroponic Glasshouse

A first-person, real-scale walkthrough of a 24 x 36 m Venlo glasshouse running NFT
lettuce benches. Version 4 rebuilds the climate cabinet as a bank of 24 per-bay
switches (fans, shade net, energy screen and roof vent for each of six bays), adds
a free-flying drone view with partial 28° roof vents, a single sliding entrance
door and unlabelled sticky traps, while retaining the underground water store,
Bluelab dosing station and 24 column-mounted HAF fans.

Built with **Three.js** (r187) and **Vite** — no other runtime dependencies.

## Requirements

- Node.js 20.19+ (or 22.12+); Vite 8 requires an up-to-date Node LTS
- A desktop browser with WebGL 2 (Chrome, Edge or Firefox). Mouse + keyboard.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # production bundle in dist/
npm run preview    # serve the built bundle locally
npm run smoke      # headless structure, hydraulic, water, control and UI regression check
npm test           # alias for npm run smoke
```

The boot screen bakes the procedural textures and builds the world in stages
(sky → structure → tables → equipment and water systems), then the **Enter
greenhouse** button starts the walkthrough and captures the mouse.

## Controls

| Input            | Action                                              |
| ---------------- | --------------------------------------------------- |
| `W` `A` `S` `D`  | Walk (collision-aware, slides along walls and beds)  |
| `Shift`          | Sprint                                              |
| Mouse            | Look (pointer lock)                                 |
| `E`              | Interact: operate the target unit or open its inspect panel |
| `Tab`            | Cycle the monitored storage tank (RO-01 / RO-02)    |
| `V`              | Enter / leave the drone view                        |
| `Q` / `E`        | Lower / raise the drone (drone view only)           |
| `Esc`            | Pause menu (also releases the mouse when capture is active) |

If a browser or embed refuses pointer lock, the game warns once and falls back to
**click-drag look** — hold the left mouse button and drag to turn — so the walkthrough
still works; `Esc` then opens the pause menu directly.

## What Version 4 contains

**World and water infrastructure**

- Galvanised steel Venlo structure: gutters, trusses, ridge ties, glazing bars,
  concrete slab and plinths, gable infill, roof/wall glazing, downpipes, a
  twin-leaf sliding entrance and 24 column-mounted HAF fans.
- Six NFT rows on the structural column grid, each split into three independent
  6 m tables with 1.4 m cross walkways. Every table has eight hollow PVC gullies
  with forty real circular planting holes at 150 mm centres (5,760 positions).
- Twin 12,000 L RO tanks buried in independent concrete vaults under the headhouse
  (RO-01 permeate, RO-02 mixed feed). At grade only the sealed covers, floor labels
  and level gauges are visible; the tanks and vaults appear when the drone view
  cuts the floor away.
- A separate 8,000 L buried nutrient-return tank (DR-01) receives every table drain.
  It is never cross-connected to the clean RO store or to the irrigation pump.
- A 5,000 L above-ground rainwater harvester fed by the north roof collector and
  first-flush filter. The transfer pump and distribution manifold top RO-01 / RO-02
  through two individually switchable isolation valves.
- Each table has its own supply branch, valve and gully manifold. The irrigation
  pump draws only from RO-02; all eight gully outlets per table feed a dedicated
  gravity drain back to DR-01.
- Per-bay environmental control: six retractable shade panels, six reflective energy
  screens and twelve hinged ridge-vent leaves that open to a 28° partial position.
- A rebuilt climate cabinet with exactly 24 switches in six bay rows — FAN, SHADE
  NET, ENERGY SCREEN and ROOF VENT for every bay. Each rocker carries a green (on) /
  red (off) indicator and a travel interlock so a reversing command is refused until
  the actuator finishes moving. There are no master/all-bay switches.
- Bluelab Pro Controller with a live EC / pH / temperature / level HMI, two probe
  sets in sample flow cells, three peristaltic dosing channels and six table
  selector valves. The HMI mirrors the selected tank and the shared valve state.
- Twelve yellow sticky traps clipped to structural columns, each with a deterministic
  caught-insect count and a weekly inspection threshold of 25 insects per card.
- Cut-away drone view (`V`) lifts the camera above the crop and hides the floor slab
  and manhole covers so the buried tanks, vaults, pipe risers and full equipment
  layout remain visible. `Q` / `E` change altitude and the first-person pose is
  preserved when the drone lands.

**Gameplay**

- Collision world (boxes + circles) so benches, the Bluelab cabinet, closed entrance
  and walls block movement; the doorway clears automatically as the doors open.
- Centre-screen raycast interaction with a highlight box, HUD hint (name + action +
  distance) and an inspect panel with category, description and spec sheet per unit.
- 127 inspectable units, including 18 NFT tables, 18 table isolation valves, 24 HAF
  fans, the 24-switch climate cabinet, 15 Bluelab / dosing points, 9 water-storage
  points, 12 sticky traps, 2 circulation pumps and the sliding entrance.
- `E` operates the entrance, cabinet door, all 24 bay switches, table and storage
  valves, Bluelab HMI and dosing pumps, and inspects the bay screens, vents and
  sticky traps. `Tab` cycles the monitored RO tank from anywhere in the walkthrough.
- Live HUD climate readout (air temperature, humidity, EC/pH and controller status)
  driven by the same `GreenhouseClimate` model as the cabinet HMI. The cabinet HMI
  shows air temperature, humidity, VPD, PPFD, DLI, EC and pH.
- Water/nutrient model tracks both RO tank levels, return-tank level, harvester level,
  flow, pressure, dosing inventory and valve state; changes propagate to the Bluelab
  HMI and storage gauges.
- Pause menu (resume / settings / respawn) and toast notifications.

**Settings & persistence**

- Quality presets (low / medium / high) change pixel ratio, shadow map size, texture
  anisotropy, environment intensity and detail geometry at runtime without a reload.
- Mouse sensitivity and FOV sliders apply immediately.
- Settings persist in `localStorage` under `verde-block4:settings`.

## Source map

```
index.html                 boot screen + #viewport/#ui-root shells
src/main.js                boot sequence, WebGL guard, exposes window.verdeGame
src/config/layout.js       single source of truth for every dimension (metres)
src/core/Game.js           renderer, lifecycle (start/pause/resume), frame loop, settings
src/core/Quality.js        quality presets
src/world/Environment.js   sky, sun, ground, yard props, fog
src/world/Greenhouse.js    structure, glazing, entrance, bay screens, traps, rain collector
src/world/EntranceDoors.js twin-leaf sliding entrance, animation + collision
src/world/BayScreens.js    6 shade panels, 6 energy panels, 12 ridge-vent leaves
src/world/StickyTraps.js   12 column-mounted pest-monitoring cards
src/world/Equipment.js     tables, pumps, cabinet, fans, hydraulic + interaction wiring
src/world/NftTables.js     column-grid NFT tables, hollow gullies and real planting holes
src/world/HydraulicNetwork.js per-table supply/return network, headers, RO-02 / DR-01 connections
src/world/WaterStorage.js  buried RO vaults, return tank, harvester, gauges, valves, drone cutaway
src/world/BluelabController.js  dosing station, probe cells, selector valves and live HMI
src/world/HafFans.js       24 column-mounted HAF fans + blade animation
src/world/DashboardDisplay.js  canvas-rendered 7-metric cabinet HMI texture
src/world/MaterialLibrary.js / ProceduralTextures.js / Batches.js
src/player/FirstPersonController.js  movement, look, bob, pointer-lock fallback
src/player/DroneController.js        free-flying drone camera with eased altitude control
src/player/CollisionWorld.js         circle-vs-box/circle resolution
src/interaction/InteractionSystem.js centre-screen raycast, highlight box
src/ui/GameUI.js           HUD, hints, inspect panel, modals, toasts
src/systems/GreenhouseControlSystem.js shared bay, pump, valve, tank and dosing state
src/simulation/GreenhouseClimate.js  shared climate/HUD/controller model
src/simulation/WaterNutrientSimulation.js  tank levels, flows, dosing and alarms
src/simulation/PlantSimulation.js    crop-growth placeholder
src/save/SaveSystem.js     versioned localStorage save scaffold
src/styles/main.css        boot, HUD, panels and modal styling
scripts/smoke-equipment.mjs  headless structure/water/control/UI regression check
```

## Notes and limitations

- Desktop only; there is no touch/mobile control scheme yet.
- Crop growth remains a placeholder. The water/nutrient model is deterministic and
  lightweight rather than a calibrated process model; it tracks levels, dosing,
  flows and alarms, not individual gully hydraulics.
- The shared control system supports independent per-bay screens, vents and fans;
  the cabinet exposes one switch per bay circuit, with no master override.
- `SaveSystem` is a versioned scaffold; the walkthrough does not auto-save a pose,
  and only UI settings are persisted today.
- `window.verdeGame` exposes the live `Game` instance for debugging from the console.
