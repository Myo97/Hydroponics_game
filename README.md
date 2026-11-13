# Verde Block 4 — Hydroponic Glasshouse

A first-person, real-scale walkthrough of a 24 x 36 m Venlo glasshouse running NFT
lettuce benches. Version 2 adds the sliding entrance, shade deck, eight-gully
tables, per-table hydraulics and 24 column-mounted HAF fans while retaining the
existing environment walkthrough and inspection system.

Built with **Three.js** (r187) and **Vite** — no other runtime dependencies.

## Requirements

- Node.js 18+ (Vite 8 requires an up-to-date Node LTS)
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
npm run smoke      # headless structure, hydraulic, door and fan regression check
npm test           # same regression check (test alias)
```

The boot screen bakes the procedural textures and builds the world in stages
(sky → structure → tables → equipment), then the **Enter greenhouse** button starts
the walkthrough and captures the mouse.

## Controls

| Input            | Action                                              |
| ---------------- | --------------------------------------------------- |
| `W` `A` `S` `D`  | Walk (collision-aware, slides along walls and beds)  |
| `Shift`          | Sprint                                              |
| Mouse            | Look (pointer lock)                                 |
| `E`              | Interact: open/close entrance or cabinet, inspect units |
| `F`              | Pause / resume HAF fan rotation (test control)      |
| `Esc`            | Pause menu (also releases the mouse when capture is active) |

If a browser or embed refuses pointer lock, the game warns once and falls back to
**click-drag look** — hold the left mouse button and drag to turn — so the walkthrough
still works; `Esc` then opens the pause menu directly.

## What Version 2 contains

**World**

- Galvanised steel Venlo structure: gutters, trusses, ridge ties, glazing bars,
  concrete slab and plinths, gable infill, roof/wall glazing, downpipes, a
  twin-leaf sliding entrance with top track and bottom guide, and a horizontal
  woven shade deck hung from the truss bottom chords.
- Procedural sky/environment lighting (the sun drives shadows and the pre-filtered
  environment map for glass and metal), distance fog, a sun shadow frustum sized to
  the glasshouse, grass, concrete apron, drainage, bollards and hedge windbreaks.
- Six NFT rows on the structural column grid, each split into three independent
  6 m tables with 1.4 m cross walkways. Every table has eight hollow PVC gullies
  with forty real circular planting holes at 150 mm centres (5,760 positions in
  total), plus reservoirs, nutrient station, circulation pumps, climate cabinet,
  24 HAF fans and two fully separate hydraulic networks.
- Each table has its own supply branch, valve and gully distribution manifold.
  Returns are separate: eight gully outlets feed a table collector, then a
  dedicated gravity drain back to reservoir 02. The pump suction and discharge
  are physically connected to the tank and main header respectively.
- The climate cabinet has a hinged door and an illuminated controller HMI showing
  live air temperature, humidity, VPD, PPFD, DLI, EC and pH.

**Gameplay**

- Collision world (boxes + circles) so benches, tanks, cabinet, closed entrance and
  walls block movement; the doorway clears automatically as the doors open.
- Centre-screen raycast interaction with a highlight box, HUD hint (name + action +
  distance) and an inspect panel with category, description and spec sheet per unit.
- 52 inspectable units: 18 NFT tables, 2 reservoirs, 3 nutrient drums, 2 pumps,
  the climate cabinet, 24 HAF fans, the sliding entrance and shade screen. Aim at
  the entrance or cabinet and press `E` to operate it.
- Live HUD climate readout (air temperature, humidity, EC/pH and controller status)
  driven by the same `GreenhouseClimate` model as the cabinet HMI.
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
src/world/Greenhouse.js    structure, glazing, plinth, entrance, shade deck
src/world/EntranceDoors.js twin-leaf sliding entrance, animation + collision
src/world/ShadeScreen.js   woven shade deck, tension wires and hangers
src/world/Equipment.js     tanks, pumps, cabinet, fans, hydraulic + interaction wiring
src/world/NftTables.js     column-grid NFT tables, hollow gullies and real planting holes
src/world/HydraulicNetwork.js per-table supply/return network, headers, reservoir connections
src/world/HafFans.js       24 column-mounted HAF fans + blade animation
src/world/DashboardDisplay.js  canvas-rendered 7-metric cabinet HMI texture
src/world/MaterialLibrary.js / ProceduralTextures.js / Batches.js
src/player/FirstPersonController.js  movement, look, bob, pointer-lock fallback
src/player/CollisionWorld.js         circle-vs-box/circle resolution
src/interaction/InteractionSystem.js centre-screen raycast, highlight box
src/ui/GameUI.js           HUD, hints, inspect panel, modals, toasts
src/simulation/GreenhouseClimate.js  shared climate/HUD/controller model
src/simulation/            crop + water/nutrient state (Milestone 2/3 scaffolds)
src/save/SaveSystem.js     versioned localStorage save scaffold
src/styles/main.css        boot, HUD, panels and modal styling
scripts/smoke-equipment.mjs  headless structure/table/hydraulic/door/fan regression check
```

## Notes and limitations

- Desktop only; there is no touch/mobile control scheme yet.
- Crop growth and hydraulic simulation remain scaffolds: the pipe network is fully
  modelled and connected, but flow/plant visuals and crop growth are not yet driven
  by the simulation (Milestones 2 and 3).
- HAF fan rotation is currently a test toggle (`F`); the fan system exposes
  `setFansEnabled()` ready for later climate-controller coupling.
- `SaveSystem` is wired up but the walkthrough does not auto-save a pose; only settings
  are persisted.
- `window.verdeGame` exposes the live `Game` instance for debugging from the console.
