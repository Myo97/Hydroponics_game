const SAVE_VERSION = 2;

/**
 * Versioned save payload.
 *
 * Version 7 stores the game clock, four-state weather selector with its manual
 * hold flag, both irrigation groups, the panel switches and the water levels in
 * addition to the original session metadata. The payload version stays at 2 so
 * saves written before the selector existed still load; the climate restore
 * maps the legacy single rain state onto heavy rain.
 */
export class SaveSystem {
  constructor({ key = 'verde-block4:save', storage = window.localStorage } = {}) {
    this.key = key;
    this.storage = storage;
  }

  hasSave() {
    try {
      return Boolean(this.storage.getItem(this.key));
    } catch (error) {
      return false;
    }
  }

  save({ player, settings, plants, water, climate, control } = {}) {
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: player
        ? { x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch }
        : null,
      settings: settings ?? null,
      plants: plants ? { elapsedSeconds: plants.elapsedSeconds } : null,
      water: water
        ? {
            elapsedSeconds: water.elapsedSeconds,
            tanks: Array.isArray(water.tanks)
              ? water.tanks.map((tank) => ({ id: tank.id, level: tank.level }))
              : [],
            returnLevel: water.returnTank?.level ?? null,
            harvesterLevel: water.harvester?.level ?? null,
            rainAccumulator: water.rainAccumulator ?? 0,
          }
        : null,
      climate: climate
        ? {
            hour: climate.hour,
            dayIndex: climate.dayIndex,
            randomSeed: climate.randomSeed,
            weather: climate.weather,
            weatherManual: Boolean(climate.weatherManual),
            rainIntensity: climate.rainIntensity,
            rainMmPerHour: climate.rainMmPerHour,
            weatherRemainingHours: climate.weatherRemainingHours,
          }
        : null,
      control: control?.snapshot?.() ?? null,
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(payload));
      return payload;
    } catch (error) {
      return null;
    }
  }

  load() {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SAVE_VERSION) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  clear() {
    try {
      this.storage.removeItem(this.key);
    } catch (error) {
      // Nothing to do — storage unavailable.
    }
  }
}
