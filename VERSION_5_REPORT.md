# Version 5 — Implementation Report

**Project:** Verde Block 4 hydroponic glasshouse walkthrough
**Baseline:** `123f2ea` (`Version 4, changes in entrance door, swtiches`)
**Status:** Implementation complete; working tree verified with `npm test`, `npm run build`
and a manual Chrome walkthrough.

Version 5 is a lighting and presentation pass rather than a new gameplay system. The
main change is a single, configurable sun vector that drives the sky shader, the
directional light, the shadow frustum and a visible solar disc. The release also
cleans up two long-standing visual defects (sticky traps floating off their columns,
threshold flashing across the entrance), renames the two buried clean-water stores,
and removes the unlabelled wall-sensor plates.

---

## 1. Physical, configurable sun

### 1.1 Configuration

All sun parameters live in `LAYOUT.sun` (`src/config/layout.js`). Nothing about the
sun is hard-coded in `Environment.js` any more; the class reads the config and falls
back to sensible defaults for every field.

| Field | Value | Meaning |
| --- | --- | --- |
| `elevationDeg` | `36` | Height above the horizon |
| `azimuthDeg` | `135` | Compass bearing (0 = north, 90 = east, 180 = south) |
| `color` | `0xfff1d8` | Warm late-morning sunlight |
| `intensity` | `2.35` | Directional light intensity |
| `distance` | `120` | Light position distance from the target |
| `discDistance` | `190` | Visible disc distance from the site |
| `discRadius` | `2.9` | Base disc radius (before per-layer scaling) |
| `discCoreColor` | `0xffd9a0` | Warm opaque core colour |
| `skylightColor` | `0xd8e8ef` | Hemisphere sky colour |
| `groundColor` | `0x6c675a` | Hemisphere bounce colour |
| `skylightIntensity` | `0.36` | Fill-light intensity |
| `shadowExtent` | `27` | Half-size of the orthographic shadow box |
| `shadowNear` / `shadowFar` | `1` / `220` | Shadow camera depth range |
| `shadowBias` / `shadowNormalBias` | `-0.0004` / `0.03` | Shadow acne / peter-panning control |

With elevation 36° and bearing 135° the unit vector from the site to the sun is
approximately **(0.572, 0.588, 0.572)** — south-east and above the horizon, so the
entrance gable and the west aisle receive directional light while the interior
benches keep a readable skylight fill.

### 1.2 One vector, four consumers

`Environment.directionFromAngles(elevationDeg, azimuthDeg)` converts the two
human-readable angles into a unit `THREE.Vector3` using spherical coordinates:

- polar angle = `90° - elevation`
- azimuth angle = `180° - compass bearing`

That single vector is then used by:

1. **Sky shader** — `Sky` uniforms (`sunPosition`) for the main scene and for the
   PMREM environment scene.
2. **Directional light** — `sun.position = vector * distance`, with the target at
   the centre of the house.
3. **Shadow camera** — the light's orthographic box is built from `shadowExtent`,
   `shadowNear` and `shadowFar`, so shadow direction follows the same vector.
4. **Visible disc** — the `sun-disc` group is placed at `vector * discDistance`.

Because all four read the same vector, it is impossible for the bright spot in the
sky, the light direction and the shadow direction to disagree.

`Environment.setSunPosition(elevationDeg, azimuthDeg)` is provided for runtime
experiments. It updates the sky uniform, the directional light and the disc. A full
environment-map rebuild is deliberately not performed (see Limitations).

### 1.3 Visible solar disc

The disc is a three-layer group (`buildSunDisc`), oriented to face the site:

| Layer | Scale × radius | Opacity | Blending | Purpose |
| --- | --- | --- | --- | --- |
| Outer halo | 3.6 | 0.045 | Additive | Soft atmospheric glow |
| Inner halo | 2.1 | 0.09 | Additive | Brighter bloom near the core |
| Core | 1.45 | 0.97 | **Normal** | Solid, readable sun |

Key decisions, all covered by smoke checks:

- **Normal blending for the core.** An earlier all-additive disc washed out into
  the sky glare and read as a vague bright patch. A near-opaque warm core is what
  makes the sun legible.
- Core radius is `2.9 × 1.45 = 4.205 m` at 190 m, i.e. an apparent diameter of
  about **2.5°**. This is intentionally larger than the real sun (≈0.53°) so it
  survives the exposure and fog at gameplay distances.
- `depthWrite: false` so the disc never punches a hole in the sky dome.
- `fog: false` and `toneMapped: false` so distance fog and tone mapping do not mute
  the disc.
- `DoubleSide` so the disc remains visible if the camera crosses its plane.
- The disc renders inside the existing fog/camera range (`Fog 62–260`, camera
  far 240) rather than being clipped away.

### 1.4 Light, shadows and exposure

- Directional light: warm `0xfff1d8`, intensity **2.35**.
- Hemisphere fill: sky `0xd8e8ef`, ground `0x6c675a`, intensity **0.36**. This
  keeps shaded aisles readable without flattening direct-sun contrast.
- Shadow camera: 54 × 54 m orthographic box (`±27 m`), near 1, far 220. The box
  covers the 24 × 36 m house plus aprons and equipment, but not the distant lawn.
- Shadow map size comes from the quality preset: 1024 (low), 2048 (medium),
  4096 (high, default). At high quality the footprint is about 13 mm per texel.
- PCF soft shadows are enabled through the existing renderer configuration
  (`PCFSoftShadowMap`); tone mapping is ACES Filmic at exposure 0.58.
- Sky turbidity 4.4, Rayleigh 1.55, Mie coefficient 0.0035, Mie directional
  G 0.84. The environment map is generated once from the same sky and sun vector,
  so glass and metal reflections agree with the visible sky.

### 1.5 Exposure decision

I compared 2.35 / 0.36 against a lower 1.9 / 0.32 option. The lower setting lost
the warm directional modelling on the crop and made the interior rely too heavily
on the hemisphere light; 2.35 / 0.36 was kept. The disc core opacity was raised to
0.97 and its radius increased to 2.9 m specifically so the sun stays readable at
this exposure rather than relying on a darker sky.

---

## 2. Sticky traps flush to the columns

The trap anchors in `LAYOUT.traps.positions` are structural grid coordinates. They
are now treated as anchors, not final positions:

- `columnMount()` snaps each anchor to the nearest `GUTTER_X` / `FRAME_Z` column
  line, warning if the configured anchor was not already on the grid.
- The card is mounted on the **inward face** of the column (towards the centre of
  the house), so it is readable from the aisle.
- The offset uses the real steel section from `LAYOUT.greenhouse`:
  `perimeterColumnSize` 0.18 m for perimeter posts, `columnSize` 0.15 m for
  internal gutter columns, plus a 14 mm card clearance.
- The card no longer floats 0.24 m into the aisle; the old `LAYOUT.traps.offset`
  value was removed.
- Cards remain unlabelled and double-sided; the darker rim, clip and wire hanger
  are retained. Twelve traps are mounted at 1.34 m.

This also removes the risk of a trap intersecting a column when the section size
changes, because the offset is derived from the same config the frame is built from.

---

## 3. Reservoir naming (was RO-01 / RO-02)

The two buried clean-water stores are now presented as **Reservoir 1** and
**Reservoir 2** everywhere the player can see them.

### 3.1 Data model

`LAYOUT.storage.roTanks` entries now carry:

```js
{
  id: 'ro-tank-1',       // stable internal key, unchanged
  code: 'RES-1',         // short code used by simulation/alarms
  name: 'Reservoir 1',   // display name
  label: 'RESERVOIR 1',  // physical plate / floor label
  subtitle: 'PERMEATE · 12,000 L',
  ...
}
```

The internal `id` values were deliberately left as `ro-tank-1` / `ro-tank-2`.
They are stable keys used by the control system, isolation valves, interaction
payloads and tests; renaming them would add churn without changing anything the
player sees. `code` changed to `RES-1` / `RES-2` because it is displayed in alarm
text and status summaries.

### 3.2 Display surfaces updated

| Surface | Before | After |
| --- | --- | --- |
| Floor/cover plates | `RO STORAGE 01/02` | `RESERVOIR 1/2` |
| Bluelab HMI title | RO code/name | `Reservoir 1/2` |
| Bluelab interaction hint | RO wording | reservoir wording |
| Dashboard header | `MONITORED TANK` | `MONITORED RESERVOIR` |
| Dashboard warning | `CHECK TANK…` | `CHECK RESERVOIR…` |
| Dashboard sub-label | tank code | `Reservoir 1/2` |
| `Tab` toast | RO names | `Reservoir 1/2` |
| `E` cycle toast | RO names | `Reservoir 1/2` |
| HUD `Tab` hint | storage tank / RO | `Reservoir` |
| Boot footer | Version 4 | `Version 5 · Physical sun & reservoirs` |
| Valve plate | `RO-01 FILL ISOLATION` | `Reservoir 1 FILL ISOLATION` |
| Valve inspect panel | `Tank` / `RO-01` | `Reservoir` / `Reservoir 1` |
| Distribution manifold | `two RO tanks`, `per tank` | `two clean-water reservoirs`, `per reservoir` |
| Clean-water board | `RO-01 · RO-02 · PERMEATE ONLY` | `RESERVOIR 1 · RESERVOIR 2 · PERMEATE ONLY` |
| Manifold sign | `ROOF HARVEST → RO` | `ROOF HARVEST → RESERVOIRS` |
| Hydraulic sign | `RO-02 → PUMP → TABLE VALVES` | `RESERVOIR 2 → PUMP → TABLE VALVES` |
| Simulation alarms | `RO-01/02` | `Reservoir 1/2` (falling back to `RES-1/2`) |
| README | RO tank language | reservoir language |

The return tank remains a **tank** (DR-01) throughout. It is a different vessel with
a different hydraulic role, and calling it a reservoir would be misleading.

### 3.3 Wording rules applied

- User-facing copy uses `tank.name` where available, with `tank.code` as a fallback
  in simulation alarms and `'Reservoir 1'` as a last-resort toast fallback.
- Internal identifiers (`ro-tank-*`, `ro-isolation-*`, `ro-distribution-manifold`)
  are unchanged.
- No user-facing `RO-01`, `RO-02`, `RO STORAGE` or `RO` abbreviation remains. The
  only `ro-` strings left in the tree are internal IDs and mesh names.

---

## 4. Entrance threshold and wall sensors

Two small visual defects were fixed alongside the lighting work:

1. **Threshold flashing.** The south plinth was being flashed across its full
   width, leaving a horizontal bar through the sliding-door opening. The south run
   is now split into the two segments either side of the 3.2 m entrance; the north
   run stays continuous.
2. **Wall sensor plates.** The two unlabelled white plates and dials clipped to
   columns at `(-4, -10)` and `(4, 8)` were removed from
   `Greenhouse.buildInteriorDetails()`. They had no interaction, no simulation
   link, and read as unfinished props.

Collision geometry is unchanged by either fix.

---

## 5. Verification

### 5.1 Automated checks

```
npm test        → 99/99 checks passed
npm run build   → 36 modules transformed, built in ~310 ms
git diff --check → clean
```

New/extended smoke checks in `scripts/smoke-equipment.mjs`:

- `configured sun sits south-east and above the horizon` — asserts the configured
  vector has positive X, Y and Z.
- `sun exposes intensity and shadow tuning` — asserts intensity, shadow extent and
  shadow far are present and positive.
- `sun disc sits on the configured sun vector` — asserts the disc length equals
  `LAYOUT.sun.discDistance` within `1e-6` and its normalized position matches the
  light vector.
- `sun disc has a warm opaque core` — asserts exactly three layers, normal blending
  on the core, and core opacity > 0.9. The test disposes the disc geometry and
  materials afterwards.
- `sticky traps carry no numbered labels` — retained.
- Water tests continue to assert both reservoirs, the return tank and the rain
  harvester are reported, and that cycling reaches `RES-2`.
- `tank selection cycles to Reservoir 2` — asserts `control.cycleTank() === 1` and
  `water.selectedTank.code === 'RES-2'`.

### 5.2 Manual QA

- Loaded the built page in Chrome at desktop resolution and walked the full
  interior and the south approach.
- Confirmed the sun disc is visible as a warm, solid core with a soft halo, and
  that it sits in the same direction as the shadows cast by the frame and benches.
- Confirmed the disc remains visible through the glazing and is not fogged out at
  the far end of the house.
- Confirmed no threshold bar across the sliding entrance.
- Confirmed sticky cards sit flat on the inward column faces in all six rows.
- Confirmed HUD `Tab` hint, boot footer, Bluelab display, dashboard, valve panels
  and floor plates all show reservoir naming.
- QA screenshots were captured to a temporary folder and that folder, the dev
  server on port 5181 and the QA Chrome instance on port 9333 were all removed or
  stopped after the review. No QA artifacts are part of the change set.

---

## 6. Files changed

| File | Change |
| --- | --- |
| `src/config/layout.js` | `LAYOUT.sun`; column section sizes; reservoir names/codes; trap anchors; removed trap offset |
| `src/world/Environment.js` | Sun vector, sky/environment, light, shadow frustum, three-layer disc, `setSunPosition` |
| `src/world/Greenhouse.js` | Split south threshold flashing; removed wall sensor plates; section sizes from config |
| `src/world/StickyTraps.js` | Column-grid snapping, inward face mounting, config-driven section offset |
| `src/world/WaterStorage.js` | Reservoir plates, valve/manifold copy and specs |
| `src/world/HydraulicNetwork.js` | Supply/return signage wording |
| `src/world/MaterialLibrary.js` | Label comment/terminology |
| `src/world/BluelabController.js` | HMI title, hint and description |
| `src/world/DashboardDisplay.js` | Reservoir header, warning and label |
| `src/simulation/WaterNutrientSimulation.js` | Reservoir roles and alarm text |
| `src/systems/GreenhouseControlSystem.js` | Valve comment terminology |
| `src/core/Game.js` | Reservoir toasts |
| `src/ui/GameUI.js` | HUD `Tab` label and Version 5 footer |
| `index.html` | Boot/footer version text |
| `scripts/smoke-equipment.mjs` | Sun vector, disc layer/core checks |
| `README.md` | Version 5 overview and reservoir language |

---

## 7. Limitations and follow-ups

- **Static sun at load.** `LAYOUT.sun` is read once during environment construction.
  Change the config and reload, or call `setSunPosition()` from the console. The
  latter moves the sky uniform, light and disc but does **not** regenerate the
  PMREM environment map, so reflections on glass and metal keep the original sun
  until the page is reloaded. If a time-of-day slider is added later, the
  environment map should be rebuilt (throttled) inside `setSunPosition`.
- **Single shadow cascade.** One 54 m orthographic shadow box covers the house and
  immediate apron. Objects outside it will not cast shadows. That is intentional
  for this scene size; a larger site would need cascaded shadow maps.
- **Disc is deliberately oversized.** At ~2.5° apparent diameter it is a visual
  affordance, not an astronomical simulation. Reducing `discRadius` makes it more
  physically accurate but much harder to see at gameplay distances.
- **Legacy internal IDs.** `ro-tank-*` keys remain in code and save-facing
  interaction payloads. They are not shown to the player, but a future cleanup
  should migrate them together with any persisted storage-valve state.
- **Performance.** Headless Chrome screenshots use SwiftShader and are not a valid
  FPS measurement. On hardware, the added cost is one 4096 shadow map (high
  preset) and three small transparent discs; no per-frame geometry is rebuilt.



