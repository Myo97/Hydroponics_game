const SAVE_VERSION = 4;

/**
 * Versioned save payload.
 *
 * Version 7 stores the game clock, four-state weather selector with its manual
 * hold flag, both irrigation groups, the panel switches and the water levels in
 * addition to the original session metadata. Version 11 adds per-tray nursery
 * growth and per-plant NFT growth records, including each plant's last processed
 * calendar day so a restored save cannot replay a growth step. Version 12 stores
 * the NFT production ages, stored biomass and harvest readiness of every plant
 * plus the harvest inventory, lifetime totals and harvest log. Version 13 stores
 * each tray's selected Green/Red Coral variety and the bench's loaded seed crop,
 * while the germination plan is recreated from its per-tray seed. Version 13 also
 * uses the 17-day reference Day 4-20 NFT cycle.
 *
 * Version 14 adds the physical harvest layer: the four styrofoam boxes with
 * their packed heads and chilled state, the container harvest house with its
 * door, vent window and glass-fridge door, and the yard gate swing.
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

  save({ player, settings, plants, water, climate, control, nursery, harvest, containerHouse, farm, market, shop } = {}) {
    const payload = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      player: player
        ? { x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch }
        : null,
      settings: settings ?? null,
      plants: plants
        ? {
            elapsedSeconds: plants.elapsedSeconds,
            growth: plants.snapshotGrowth?.() ?? null,
          }
        : null,
      nursery: nursery?.snapshotGrowth?.() ?? null,
      harvest: harvest?.snapshot?.() ?? null,
      containerHouse: containerHouse?.snapshot?.() ?? null,
      farm: farm?.snapshot?.() ?? null,
      shop: shop?.snapshot?.() ?? null,
      market: market ? { cash: Math.max(0, Number(market.cash) || 0) } : null,
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
