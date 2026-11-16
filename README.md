# Verde Block 4 — Hydroponic Glasshouse

A first-person, real-scale walkthrough of a 24 x 36 m Venlo glasshouse running NFT
lettuce benches. Version 7 adds a four-position weather selector on a physical
headhouse panel (sunny / cloudy / light rain / heavy rain) with a manual hold and
AUTO key, static NFT gully water films instead of animated pipe markers, and
calmer water materials. The deterministic weather schedule still drives the sky,
sun, exterior rain field and roof-water harvesting. Version 6's full day/night
cycle, two independently pumped irrigation groups, three-switch Main Irrigation
Controller Panel and 360° drone orbit are retained, along with the earlier
configurable sun, 24-switch bay cabinet, 28° roof vents, sliding entrance,
underground reservoirs, Bluelab dosing station, sticky traps and 24 HAF fans.

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
| `Tab`            | Cycle the monitored reservoir (Reservoir 1 / Reservoir 2) |
| `V`              | Enter / leave the drone view                        |
| `←` / `→`        | Orbit the drone through a full 360° yaw             |
| `↑` / `↓`        | Tilt the drone camera up / down (drone view only)   |
| `Q` / `E`        | Lower / raise the drone (drone view only)           |
| `Esc`            | Pause menu (also releases the mouse when capture is active) |

If a browser or embed refuses pointer lock, the game warns once and falls back to
**click-drag look** — hold the left mouse button and drag to turn — so the walkthrough
still works; `Esc` then opens the pause menu directly.

## What Version 7 contains

**World and water infrastructure**

- Galvanised steel Venlo structure: gutters, trusses, ridge ties, glazing bars,
  concrete slab and plinths, gable infill, roof/wall glazing, downpipes, a
  twin-leaf sliding entrance and 24 column-mounted HAF fans.
- A configurable directional sun (`LAYOUT.sun`) plus a physical 24-hour orbit driven
  by `LAYOUT.time`. One real hour advances one game day (0.4 game minutes per
  second). The sun rises east, crosses south and sets west; the sky shader,
  directional light, moon fill, stars, fog and visible solar disc all follow the
  same clock.
- A deterministic four-state weather schedule (`LAYOUT.weather`): sunny, cloudy,
  light rain and heavy rain. The schedule changes every 2–5 game hours and
  modulates PPFD, temperature and humidity. Each state has its own cloud cover,
  rain visual intensity and roof-capture rate, so light and heavy rain fill the
  harvester at different speeds even though they share one particle field.
- Wall-mounted Weather Control Panel beside the main irrigation panel: a detented
  four-position rotary selector, one lamp and label per outlook, and an AUTO key.
  Turning the selector holds that outlook manually (`weatherManual`); AUTO releases
  the hold and resumes the deterministic schedule. The panel's canvas HMI shows
  the latched state, mode, light factor, humidity and temperature bias, and live
  roof capture in mm/h.
- Six NFT rows on the structural column grid, each split into three independent
  6 m tables with 1.4 m cross walkways. Every table has eight hollow PVC gullies
  with forty real circular planting holes at 150 mm centres (5,760 positions).
- Two irrigation groups: Group 1 (Reservoir 1) feeds the west rows at x = −10, −6
  and −2; Group 2 (Reservoir 2) feeds the east rows at x = 2, 6 and 10. Each group
  has its own pump, suction run and supply header; the header is physically split
  at x = 0 so the two sources never mix.
- Twin 12,000 L clean-water reservoirs buried in independent concrete vaults under
  the headhouse (Reservoir 1 permeate, Reservoir 2 mixed feed). At grade only the
  sealed covers, floor labels and level gauges are visible; the tanks and vaults
  appear when the drone view cuts the floor away.
- A separate 8,000 L buried nutrient-return tank (DR-01) receives every table drain.
  It is never cross-connected to the clean-water store or to the irrigation pumps.
- A 5,000 L underground rainwater harvester fed by the north roof collector,
  first-flush chamber and vent. Its HDPE tank and live rain-fed water surface are
  visible in the drone cutaway. The relocated grade-mounted transfer pump sends
  stored water through the distribution manifold to both reservoirs.
- Each table has its own supply branch, valve and gully manifold, and only flows
  when its group pump is on **and** its local valve is open. All eight gully outlets
  per table feed a dedicated gravity drain back to DR-01. While a table flows, a
  static solution film is visible inside its eight channels below the perforated
  top plate; the film is one instanced mesh per table, clipped inside the gully
  envelope, with no surface animation or spill.
- Three-switch Main Irrigation Controller Panel on the north headhouse wall: Pump 1,
  Pump 2 and Rain Transfer, with illuminated selector levers and a live canvas HMI
  showing group flow, valve counts and roof capture. Pipework is a physical model
  only — there are no travelling flow markers or flow-colour display modes.
- Per-bay environmental control: six retractable shade panels, six reflective energy
  screens and twelve hinged ridge-vent leaves that open to a 28° partial position.
- A rebuilt climate cabinet with exactly 24 switches in six bay rows — FAN, SHADE
  NET, ENERGY SCREEN and ROOF VENT for every bay. Each rocker carries a green (on) /
  red (off) indicator and a travel interlock so a reversing command is refused until
  the actuator finishes moving. There are no master/all-bay switches.
- Bluelab Pro Controller with a live EC / pH / temperature / level HMI, two probe
  sets in sample flow cells, three peristaltic dosing channels and six table
  selector valves. The HMI mirrors the selected tank and the shared valve state.
- Twelve yellow sticky traps snapped flush to the inward face of structural
  columns, each with a deterministic caught-insect count and a weekly inspection
  threshold of 25 insects per card.
- Cut-away drone view (`V`) lifts the camera above the crop and hides the floor slab
  and manhole covers so the buried tanks, harvester vault, pipe risers and full
  equipment layout remain visible. Arrow keys orbit a full 360° and tilt through
  ±85°; `Q` / `E` change altitude and the first-person pose is preserved when the
  drone lands.

**Gameplay**

- Collision world (boxes + circles) so benches, the Bluelab cabinet, closed entrance
  and walls block movement; the doorway clears automatically as the doors open.
- Centre-screen raycast interaction with a highlight box, HUD hint (name + action +
  distance) and an inspect panel with category, description and spec sheet per unit.
- 138 inspectable units, including 18 NFT tables, 18 table isolation valves, 24 HAF
  fans, the 24-switch climate cabinet, 15 Bluelab / dosing points, 9 water-storage
  points, the 3-switch irrigation panel, the 7-point weather panel, 12 sticky traps,
  2 group pumps and the sliding entrance.
- `E` operates the entrance, cabinet door, all 24 bay switches, table and storage
  valves, group pumps, rain transfer pump, weather selector / state lamps / AUTO key,
  Bluelab HMI and dosing pumps, and inspects the bay screens, vents and sticky traps.
  `Tab` cycles the monitored reservoir from anywhere in the walkthrough.
- Live HUD climate readout (game clock, weather label plus mm/h rain rate and HOLD /
  AUTO mode, air temperature, humidity, EC/pH and controller status) driven by the
  same `GreenhouseClimate` model as the cabinet and weather-panel HMIs.
- Water/nutrient model tracks both reservoir levels independently, return-tank level,
  harvester level, rain capture volume, per-group flow and pressure, dosing inventory
  and valve state; changes propagate to the irrigation HMI, Bluelab HMI and gauges.
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
src/world/HydraulicNetwork.js split group headers and per-table supply/return network
src/world/WaterStorage.js  underground reservoirs, return tank, buried harvester, gauges, valves, drone cutaway
src/world/BluelabController.js  dosing station, probe cells, selector valves and live HMI
src/world/IrrigationPanel.js  three-switch main irrigation panel + live group-flow HMI
src/world/WeatherControlPanel.js  four-state rotary weather selector, lamps, AUTO key + HMI
src/world/HafFans.js       24 column-mounted HAF fans + blade animation
src/world/DashboardDisplay.js  canvas-rendered 7-metric cabinet HMI texture
src/world/MaterialLibrary.js / ProceduralTextures.js / Batches.js
src/player/FirstPersonController.js  movement, look, bob, pointer-lock fallback
src/player/DroneController.js        free-flying 360° drone camera with orbit and altitude control
src/player/CollisionWorld.js         circle-vs-box/circle resolution
src/interaction/InteractionSystem.js centre-screen raycast, highlight box
src/ui/GameUI.js           HUD, hints, inspect panel, modals, toasts
src/systems/GreenhouseControlSystem.js shared bay, pump, valve, tank and dosing state
src/simulation/GreenhouseClimate.js  shared climate/HUD/controller model
src/simulation/WaterNutrientSimulation.js  tank levels, flows, dosing and alarms
src/simulation/PlantSimulation.js    crop-growth placeholder
src/save/SaveSystem.js     versioned localStorage save payload (v2)
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
- `SaveSystem` is a version-2 payload: it stores the clock, four-state weather with
  its manual-hold flag and roof-capture rate, pump/valve state, reservoir/return/
  harvester levels and session metadata. Legacy saves that stored the single `rain`
  state restore as heavy rain on the automatic schedule. The walkthrough still does
  not auto-save a pose; UI settings persist separately.
- VERSION_6_REPORT.md summarises the irrigation, climate, drone, harvester and panel
  changes and the regression coverage added for them.
- `window.verdeGame` exposes the live `Game` instance for debugging from the console.
