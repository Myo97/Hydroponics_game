import { LAYOUT } from '../config/layout.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Shared greenhouse climate model.
 *
 * A single source of truth for the walkthrough HUD, the physical controllers and
 * the environment lighting. The game clock completes one 24 hour day per real
 * hour, and a deterministic weather state machine modulates light, temperature,
 * humidity and rain intensity. Values remain reproducible so a save restores the
 * same conditions.
 *
 * VPD is calculated with the Tetens saturation-vapour-pressure equation rather
 * than being faked from relative humidity, and DLI is integrated from PPFD so it
 * is a genuinely different quantity from the lux/PPFD readout.
 */
export class GreenhouseClimate {
  constructor({
    startHour = LAYOUT.time.startHour,
    minutesPerSecond = 1440 / LAYOUT.time.realSecondsPerGameDay,
    timeConfig = LAYOUT.time,
    weatherConfig = LAYOUT.weather,
    randomSeed = 0x5eed1234,
  } = {}) {
    this.timeConfig = timeConfig;
    this.weatherConfig = weatherConfig;
    this.minutesPerSecond = minutesPerSecond;
    this.elapsedSeconds = 0;
    this.startHour = startHour;
    this.hour = startHour;
    this.dayIndex = 0;
    this.randomSeed = randomSeed;

    this.airTemp = 22.4;
    this.humidity = 66;
    this.vpd = 0;
    this.ppfd = 0;
    this.lux = 0;
    this.dliToday = this.integratePpfd(6, startHour);
    this.ec = 1.84;
    this.ph = 5.88;
    this.co2 = 780;

    this.weather = weatherConfig.initial;
    this.rainOverride = null;
    this.weatherManual = false;
    this.weatherRemainingHours = this.nextWeatherDuration();

    this.setpoints = {
      dayTemp: 21.5,
      nightTemp: 18.5,
      maxHumidity: 78,
      ec: 1.8,
      phLow: 5.8,
      phHigh: 6.0,
    };

    this.tick(0);
  }

  /** Analytical clear-sky PPFD curve, sunrise 06:00, sunset 18:00. */
  static ppfdAt(hour) {
    const daylight = Math.sin((Math.PI * (hour - 6)) / 12);
    if (daylight <= 0) return 0;
    return 60 + 620 * Math.pow(daylight, 1.08);
  }

  /** µmol m⁻² integrated over a clock-hour window, expressed as mol m⁻². */
  integratePpfd(fromHour, toHour) {
    if (toHour <= fromHour) return 0;
    const steps = Math.max(2, Math.ceil((toHour - fromHour) * 6));
    const step = (toHour - fromHour) / steps;
    let integral = 0;
    for (let i = 0; i < steps; i += 1) {
      const hour = fromHour + (i + 0.5) * step;
      integral += GreenhouseClimate.ppfdAt(hour) * step * 3600;
    }
    return integral / 1e6;
  }

  static saturationVapourPressure(tempC) {
    return 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  }

  static vpdFrom(tempC, humidity) {
    const svp = GreenhouseClimate.saturationVapourPressure(tempC);
    const avp = svp * clamp(humidity, 1, 100) / 100;
    return Math.max(0, svp - avp);
  }

  // A simplified game calendar, derived from the saved clock.
  get moonPhase() {
    const age = (this.dayIndex + this.hour / 24) / LAYOUT.moon.cycleDays;
    return age - Math.floor(age);
  }

  get moonIllumination() {
    return (1 - Math.cos(this.moonPhase * Math.PI * 2)) / 2;
  }

  get weatherState() {
    return this.weatherConfig.states[this.weather] ?? this.weatherConfig.states.sunny;
  }

  get weatherLabel() {
    return this.weatherState.label;
  }

  get rainIntensity() {
    if (this.rainOverride !== null) return this.rainOverride;
    return this.weatherState.rainIntensity;
  }

  /**
   * Effective roof-catchment rate for the selected outlook. Light and heavy
   * rain have distinct rates even though both use the same particle system.
   */
  get rainMmPerHour() {
    if (this.rainIntensity <= 0.02) return 0;
    const stateRate = this.weatherState.rainMmPerHour ?? 0;
    const stateIntensity = this.weatherState.rainIntensity || 1;
    const overrideScale =
      this.rainOverride === null ? 1 : this.rainIntensity / stateIntensity;
    return stateRate * overrideScale;
  }

  get weatherOrder() {
    return (
      this.weatherConfig.order ??
      Object.keys(this.weatherConfig.states)
    );
  }

  get daylightFraction() {
    const span = this.timeConfig.sunsetHour - this.timeConfig.sunriseHour;
    return (this.hour - this.timeConfig.sunriseHour) / span;
  }

  get sunElevationDeg() {
    const raw = Math.sin(Math.PI * this.daylightFraction);
    return clamp(raw * this.timeConfig.maxSunElevationDeg, -24, 90);
  }

  /** 0 degrees = east, 90 = south, 180 = west. */
  get sunAzimuthDeg() {
    return clamp(this.daylightFraction, 0, 1) * 180;
  }

  get sunDirection() {
    const elevation = (this.sunElevationDeg * Math.PI) / 180;
    const azimuth = (this.sunAzimuthDeg * Math.PI) / 180;
    const horizontal = Math.cos(elevation);
    return {
      x: Math.cos(azimuth) * horizontal,
      y: Math.sin(elevation),
      z: Math.sin(azimuth) * horizontal,
    };
  }

  get isDaylight() {
    return this.sunElevationDeg > 0;
  }

  /** Weighted deterministic weather transition. */
  nextRandom() {
    this.randomSeed = (this.randomSeed * 1664525 + 1013904223) >>> 0;
    return this.randomSeed / 4294967296;
  }

  nextWeatherDuration() {
    const { minDurationHours, maxDurationHours } = this.weatherConfig;
    return minDurationHours + this.nextRandom() * (maxDurationHours - minDurationHours);
  }

  nextWeatherState() {
    const entries = Object.entries(this.weatherConfig.states).filter(
      ([state]) => state !== this.weather,
    );
    const total = entries.reduce((sum, [, state]) => sum + state.weight, 0);
    let target = this.nextRandom() * total;
    for (const [state, entry] of entries) {
      target -= entry.weight;
      if (target <= 0) return state;
    }
    return entries[entries.length - 1]?.[0] ?? 'sunny';
  }

  setWeather(
    state,
    { rainIntensity = null, durationHours = null, manual = true } = {},
  ) {
    if (!this.weatherConfig.states[state]) return this.weather;
    this.weather = state;
    this.rainOverride = rainIntensity === null ? null : clamp(rainIntensity, 0, 1);
    this.weatherManual = Boolean(manual);
    this.weatherRemainingHours = this.weatherManual
      ? 0
      : durationHours ?? this.nextWeatherDuration();
    this.tick(0);
    return this.weather;
  }

  /** Advance the physical four-position selector to the next weather state. */
  cycleWeather() {
    const order = this.weatherOrder.filter(
      (state) => this.weatherConfig.states[state],
    );
    if (order.length === 0) return this.weather;
    const index = Math.max(0, order.indexOf(this.weather));
    return this.setWeather(order[(index + 1) % order.length], { manual: true });
  }

  /** Release the manual override and resume the deterministic four-state schedule. */
  setWeatherAuto() {
    this.weatherManual = false;
    this.rainOverride = null;
    this.weatherRemainingHours = this.nextWeatherDuration();
    this.tick(0);
    return this.weather;
  }

  /**
   * Developer time control: advance the shared clock by a number of game hours
   * without waiting in real time. Running the regular update path in short steps
   * keeps date rollover, DLI, sun position, temperature/humidity and the weather
   * schedule coherent instead of teleporting only the HUD clock.
   */
  skipGameHours(hours = 24) {
    const targetHours = Number.isFinite(Number(hours)) ? Math.max(0, Number(hours)) : 0;
    const secondsPerGameHour = this.minutesPerSecond > 0 ? 60 / this.minutesPerSecond : 0;
    if (targetHours <= 0 || secondsPerGameHour <= 0) return this.snapshot();

    const endAbsoluteHour = this.dayIndex * 24 + this.hour + targetHours;
    let remaining = targetHours;
    while (remaining > 1e-9) {
      const stepHours = Math.min(0.25, remaining);
      this.update(stepHours * secondsPerGameHour);
      remaining -= stepHours;
    }

    // Snap to the requested endpoint so repeated clicks cannot accumulate
    // floating-point drift in the displayed date or minute.
    this.dayIndex = Math.floor(endAbsoluteHour / 24);
    this.hour = endAbsoluteHour - this.dayIndex * 24;
    this.tick(0);
    return this.snapshot();
  }

  update(dt) {
    this.elapsedSeconds += dt;
    this.hour += (dt * this.minutesPerSecond) / 60;

    if (!this.weatherManual) {
      this.weatherRemainingHours -= (dt * this.minutesPerSecond) / 60;
      if (this.weatherRemainingHours <= 0) {
        this.rainOverride = null;
        this.weather = this.nextWeatherState();
        this.weatherRemainingHours = this.nextWeatherDuration();
      }
    }

    while (this.hour >= 24) {
      this.hour -= 24;
      this.dayIndex += 1;
      this.dliToday = 0;
    }

    this.tick(dt);
  }

  tick(dt) {
    const solar = Math.max(0, Math.sin((Math.PI * (this.hour - 6)) / 12));
    const slowWave = Math.sin(this.elapsedSeconds * 0.045);
    const fasterWave = Math.sin(this.elapsedSeconds * 0.19 + 1.7);
    const weather = this.weatherState;

    this.ppfd = Math.round(
      clamp(
        (GreenhouseClimate.ppfdAt(this.hour) + slowWave * 18 + fasterWave * 6) *
          weather.ppfdFactor,
        0,
        1250,
      ),
    );
    this.lux = Math.round(this.ppfd * 54.2);

    // Glasshouse air tracks the sun with a lag; ventilation pulls peaks down.
    const targetTemp = 18.6 + solar * 4.6 + slowWave * 0.28 + weather.tempBias;
    this.airTemp += (targetTemp - this.airTemp) * Math.min(1, dt * 0.22);
    if (dt === 0) this.airTemp = targetTemp;

    const targetHumidity =
      79 - solar * 15 + fasterWave * 1.8 + weather.humidityBias;
    this.humidity += (targetHumidity - this.humidity) * Math.min(1, dt * 0.18);
    if (dt === 0) this.humidity = targetHumidity;

    this.humidity = clamp(this.humidity, 42, 100);
    this.vpd = GreenhouseClimate.vpdFrom(this.airTemp, this.humidity);

    // Add the current interval to the daily light integral.
    if (dt > 0) {
      this.dliToday += (this.ppfd * dt * this.minutesPerSecond * 60) / 1e6;
      this.dliToday = clamp(this.dliToday, 0, 24);
    }

    const ecWave = Math.sin(this.elapsedSeconds * 0.11);
    const phWave = Math.sin(this.elapsedSeconds * 0.083 + 1.2);
    this.ec = 1.84 + ecWave * 0.035;
    this.ph = 5.88 + phWave * 0.045;
    this.co2 = Math.round(760 + Math.sin(this.elapsedSeconds * 0.06) * 55);
  }

  get clockLabel() {
    const totalMinutes = Math.floor(this.hour * 60 + 1e-6) % 1440;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  get dayLabel() {
    return `Day ${this.dayIndex + 1}`;
  }

  get status() {
    const deviations = [];
    if (this.airTemp > this.setpoints.dayTemp + 2.5) deviations.push('TEMP HIGH');
    if (this.humidity > this.setpoints.maxHumidity) deviations.push('RH HIGH');
    if (this.ec > this.setpoints.ec + 0.25) deviations.push('EC HIGH');
    if (this.ec < this.setpoints.ec - 0.25) deviations.push('EC LOW');
    if (this.ph < this.setpoints.phLow - 0.15) deviations.push('pH LOW');
    if (this.ph > this.setpoints.phHigh + 0.15) deviations.push('pH HIGH');
    return deviations.length ? deviations : ['ALL ZONES NOMINAL'];
  }

  get isAlarm() {
    return this.status[0] !== 'ALL ZONES NOMINAL';
  }

  snapshot() {
    return {
      clock: this.clockLabel,
      dayIndex: this.dayIndex,
      dayLabel: this.dayLabel,
      hour: this.hour,
      weather: this.weather,
      weatherLabel: this.weatherLabel,
      weatherManual: this.weatherManual,
      weatherOrder: this.weatherOrder,
      rainIntensity: this.rainIntensity,
      rainMmPerHour: this.rainMmPerHour,
      isDaylight: this.isDaylight,
      sunElevationDeg: this.sunElevationDeg,
      sunAzimuthDeg: this.sunAzimuthDeg,
      weatherRemainingHours: this.weatherRemainingHours,
      airTemp: this.airTemp,
      humidity: this.humidity,
      vpd: this.vpd,
      ppfd: this.ppfd,
      lux: this.lux,
      dliToday: this.dliToday,
      ec: this.ec,
      ph: this.ph,
      co2: this.co2,
      status: this.status,
      isAlarm: this.isAlarm,
    };
  }

  /** Restore clock and weather state from a save payload. */
  restore(state = {}) {
    if (Number.isFinite(state.hour)) this.hour = clamp(state.hour, 0, 24);
    if (Number.isFinite(state.dayIndex)) this.dayIndex = Math.max(0, state.dayIndex);
    if (Number.isFinite(state.randomSeed)) this.randomSeed = state.randomSeed >>> 0;
    // Version 2 used a single "rain" state. It maps to the new heavy-rain state.
    const weather = state.weather === 'rain' ? 'heavyRain' : state.weather;
    if (this.weatherConfig.states[weather]) this.weather = weather;
    this.rainOverride = Number.isFinite(state.rainIntensity)
      ? clamp(state.rainIntensity, 0, 1)
      : null;
    this.weatherManual = Boolean(state.weatherManual);
    if (Number.isFinite(state.weatherRemainingHours)) {
      this.weatherRemainingHours = Math.max(0, state.weatherRemainingHours);
    }
    if (this.weatherManual) this.weatherRemainingHours = 0;
    this.tick(0);
  }
}
