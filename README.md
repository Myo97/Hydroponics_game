# Verde Block 4 — Hydroponic Glasshouse

A first-person, real-scale walkthrough of a 24 x 36 m Venlo glasshouse running NFT
lettuce benches. Milestone 1 (environment + walkthrough) is playable: you can walk the
aisles, look around, and inspect every piece of equipment under the crosshair.

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
```

The boot screen bakes the procedural textures and builds the world in stages
(sky -> structure -> benches -> equipment), then the **Enter greenhouse** button starts
the walkthrough and captures the mouse.

## Controls

| Input            | Action                                              |
| ---------------- | --------------------------------------------------- |
| `W` `A` `S` `D`  | Walk (collision-aware, slides along walls and beds)  |
| `Shift`          | Sprint                                              |
| Mouse            | Look (pointer lock)                                 |
| `E`              | Inspect the unit under the crosshair / close panel  |
| `Esc`            | Pause menu (also releases the mouse when capture is active) |

If a browser or embed refuses pointer lock, the game warns once and falls back to
**click-drag look** — hold the left mouse button and drag to turn — so the walkthrough
still works; `Esc` then opens the pause menu directly.

## What Milestone 1 contains

**World**

- Galvanised steel Venlo structure: gutters, trusses, ridge ties, glazing bars,
  concrete slab and plinths, gable infill, roof/wall glazing, downpipes, sliding
  entrance door and interior details, plus a concrete apron and yard props outside.
- Procedural sky/environment lighting (the sun drives shadows and the pre-filtered
  environment map for glass and metal), distance fog, a sun shadow frustum sized to
  the glasshouse, grass, concrete apron, drainage, bollards and hedge windbreaks.
- Six NFT bench rows (3 channels each, 0.7° fall), crop line, reservoirs, nutrient
  station, pump skid, climate cabinet, circulation fans and the full PVC pipework
  (supply main, row risers, return collector, suction main, inline filter and gauge).

**Gameplay**

- Collision world (boxes + circles) so benches, tanks, cabinet and walls block movement.
- Centre-screen raycast interaction with a highlight box, HUD hint (name + distance)
  and an inspect panel with category, description and spec sheet per unit.
- 19 inspectable units: 6 NFT rows, 2 reservoirs, 3 nutrient drums + dosing station,
  2 pumps + pump skid, climate cabinet and 3 circulation fans.
- HUD with live zone, position, speed and FPS readouts alongside the fixed
  environment/solution figures for the unit.
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
src/world/Greenhouse.js    structure, glazing, plinth, entrance
src/world/Equipment.js     benches, tanks, pumps, cabinet, fans, pipework + interactables
src/world/MaterialLibrary.js / ProceduralTextures.js / Batches.js
src/player/FirstPersonController.js  movement, look, bob, pointer-lock fallback
src/player/CollisionWorld.js         circle-vs-box/circle resolution
src/interaction/InteractionSystem.js centre-screen raycast, highlight box
src/ui/GameUI.js           HUD, hints, inspect panel, modals, toasts
src/simulation/            crop + water/nutrient state (Milestone 2/3 scaffolds)
src/save/SaveSystem.js     versioned localStorage save scaffold
src/styles/main.css        boot, HUD, panels and modal styling
```

## Notes and limitations

- Desktop only; there is no touch/mobile control scheme yet.
- Crop growth and hydraulics are scaffolds: they advance clocks and drift readouts but
  do not drive visuals or gameplay yet (Milestones 2 and 3).
- `SaveSystem` is wired up but the walkthrough does not auto-save a pose; only settings
  are persisted.
- `window.verdeGame` exposes the live `Game` instance for debugging from the console.
