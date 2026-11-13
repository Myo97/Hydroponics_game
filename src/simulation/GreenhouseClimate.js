const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Shared greenhouse climate model.
 *
 * A single source of truth for the walkthrough HUD and the physical controller
 * mounted inside the climate cabinet. Values move slowly enough to feel like real
 * sensors, but they are deterministic and independent of rendering, which keeps
 * the dashboard and the inspect panel consistent.
 *
 * VPD is calculated with the Tetens saturation-vapour-pressure equation rather
 * than being faked from relative humidity, and DLI is integrated from PPFD so it
 * is a genuinely different quantity from the lux/PPFD readout.
 */
export class GreenhouseClimate {
  constructor({ startHour = 10.7, minutesPerSecond = 0.12 } = {}) {
    this.minutesPerSecond = minutesPerSecond;
    this.elapsedSeconds = 0;
    this.startHour = startHour;
    this.hour = startHour;
    this.dayIndex = 0;

    this.airTemp = 22.4;
    this.humidity = 66;
    this.vpd = 0;
    this.ppfd = 0;
    this.lux = 0;
    this.dliToday = this.integratePpfd(6, startHour);
    this.ec = 1.84;
    this.ph = 5.88;
    this.co2 = 780;

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

  update(dt) {
    this.elapsedSeconds += dt;
    this.hour += (dt * this.minutesPerSecond) / 60;

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

    this.ppfd = Math.round(
      clamp(GreenhouseClimate.ppfdAt(this.hour) + slowWave * 18 + fasterWave * 6, 0, 1250),
    );
    this.lux = Math.round(this.ppfd * 54.2);

    // Glasshouse air tracks the sun with a lag; ventilation pulls the peaks down.
    const targetTemp = 18.6 + solar * 4.6 + slowWave * 0.28;
    this.airTemp += (targetTemp - this.airTemp) * Math.min(1, dt * 0.22);
    if (dt === 0) this.airTemp = targetTemp;

    const targetHumidity = 79 - solar * 15 + fasterWave * 1.8;
    this.humidity += (targetHumidity - this.humidity) * Math.min(1, dt * 0.18);
    if (dt === 0) this.humidity = targetHumidity;

    this.humidity = clamp(this.humidity, 42, 92);
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
    const hours = Math.floor(this.hour);
    const minutes = Math.floor((this.hour - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
}
