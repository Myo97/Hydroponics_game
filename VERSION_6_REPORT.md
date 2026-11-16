# Version 6 report — two-group irrigation, weather and 360° drone

## Scope delivered

### Irrigation

- **Two independent groups.** Group 1 draws from Reservoir 1 and serves the west
  rows at x = −10, −6 and −2. Group 2 draws from Reservoir 2 and serves the east
  rows at x = 2, 6 and 10. The supply header is split at x = 0 with a physical gap
  and an isolation valve on each side, so the two sources cannot cross-mix.
- **Dedicated pumps.** Pump 1 and Pump 2 each have their own suction run from the
  matching reservoir and discharge into their own header. Pump badges and lamp
  states follow the panel.
- **Flow gating.** A table receives solution only when its group pump is on *and*
  its local quarter-turn valve is open. Closing all valves deadheads the pump at
  1.62 bar; switching the pump off removes flow even with every valve open.
- **Animated flow.** Emissive markers travel along both supply headers, all 18
  table branches and all 18 return branches. Marker visibility follows the same
  pump + valve rule. A panel/HMI action toggles the display between clean water
  (pale blue) and nutrient solution (red).
- **Main Irrigation Controller Panel.** A wall-mounted panel at
  `[3.8, -16.85]` carries three illuminated selector switches (Pump 1, Pump 2,
  Rain Transfer) and a live canvas HMI showing pump state, open/flowing valves,
  branch flow, reservoir levels, harvester level, rain capture, total flow and
  display colour. Interacting with a switch calls the shared
  `GreenhouseControlSystem`, so the 3D lever, HMI and simulation agree.

### Rainwater harvester and transfer

- The harvester is relocated into a **concrete vault below the headhouse slab**.
  The 5,000 L HDPE tank, reinforcing hoops, access ladder, buried fill pipe and
  water surface are visible in the drone cutaway. At grade only the sealed hatch,
  vent standpipe and first-flush chamber remain.
- **Rain only fills the harvester when the weather state is rain.** Inflow uses
  `rainIntensity × rainMmPerHour × roofArea × runoff / 3600`, multiplied by the
  24× game-time factor, giving a physically scaled litres-per-second value that is
  exposed to the HMI (≈30 L/s in the design storm).
- The transfer pump moved to a grade pad west of the hatch at `[-4.25, -15.8]`.
  Its suction leaves the vault wall; its discharge tees into the clean manifold.
  Each reservoir retains an independent isolation valve, and a full tank stops
  accepting water without spilling the harvester.
- Reservoir draw is per group: each flowing table removes water from its group's
  reservoir. Drainage returns to DR-01 in proportion to total flow.

### Time, weather, day/night

- `GreenhouseClimate.minutesPerSecond = 0.4`, so **one real hour = one game day**.
  The clock rolls over at midnight and increments the day counter.
- The sun orbits from east through south to west with sunrise at 06:00 and sunset
  at 18:00. Directional light, sky shader, solar disc, hemisphere fill, moon fill,
  stars and fog all derive from the same clock and sun vector.
- A deterministic weather state machine cycles sunny → cloudy → rain (weighted,
  2–5 game hours per state). Weather modulates PPFD, air temperature and humidity.
  Clouds, exterior rain particles and a darker fog palette make each state visible.
- The HUD shows `Day N · HH:MM`, the weather label and rain percentage alongside
  the existing temperature, humidity, EC/pH and status.

### Drone

- Arrow keys now orbit continuously through 360° yaw and tilt through ±85°;
  `WASD` still flies relative to the current heading, `Q/E` changes altitude and
  `Shift` boosts. Pointer lock and click-drag both update the bounded camera.
- Yaw is normalised to [−π, π] so long orbits cannot accumulate floating-point
  drift.

### Persistence and regression coverage

- `SaveSystem` is bumped to version 2 and now records clock/weather state,
  pump/table/storage valve state, flow-colour mode, and reservoir/return/harvester
  levels. Version 1 payloads are rejected because the pump keys changed.
- `scripts/smoke-equipment.mjs` now verifies the split headers, dedicated pump
  assignments, three-switch panel, flow-marker gating and colour toggle, rain-fed
  harvester, underground placement, relocated pump, 0.4 min/s clock, weather
  factors and 360° drone yaw/pitch clamping.

## Validation

- `npm run build` — production bundle succeeds.
- `npm run smoke` — **123 / 123 checks passed**.

## Notes

- The 24-switch climate cabinet, Bluelab dosing station, 18 table valves, 12
  sticky traps, bay screens/vents, entrance and HAF fans remain functional.
- Crop growth is still a placeholder. The water model is deterministic and
  lightweight rather than a calibrated process model.
- The weather sequence is deterministic from the persisted random seed, so a
  reload restores the same outlook rather than re-rolling it.
