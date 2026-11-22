/** Automatic counter sales. One order owns its reserved stock until collection. */
export class AutoShopController {
  constructor({ house, market, climate, onChange = () => {}, onNotice = () => {}, random = Math.random }) {
    this.house = house;
    this.fridge = house.fridge;
    this.market = market;
    this.climate = climate;
    this.onChange = onChange;
    this.onNotice = onNotice;
    this.random = random;
    this.open = false;
    this.prices = {};
    this.order = null;
    this.wait = 8;
    this.day = climate.dayIndex;
    this.sales = 0;
    this.headsSold = 0;
    this.revenueCents = 0;
    this.lowStockNotified = false;
  }

  priceFor(cropKey, cropName) {
    return this.prices[cropKey] ?? (/red/i.test(cropName) ? 450 : 350);
  }

  stock() {
    const crops = new Map();
    for (const box of this.fridge.boxes) {
      for (const lot of box.cropSummary) {
        const crop = crops.get(lot.cropKey) ?? { cropKey: lot.cropKey, cropName: lot.cropName, heads: 0 };
        crop.heads += lot.heads;
        crops.set(lot.cropKey, crop);
      }
    }
    return [...crops.values()].map(crop => ({
      ...crop,
      available: crop.heads - (this.order?.reserved && this.order.cropKey === crop.cropKey ? this.order.quantity : 0),
      priceCents: this.priceFor(crop.cropKey, crop.cropName),
    }));
  }

  setOpen(open) {
    this.open = Boolean(open);
    this.onChange();
  }

  setPrice(cropKey, dollars) {
    const price = Number(dollars);
    if (!Number.isFinite(price) || price < 0.1 || price > 100) return false;
    this.prices[cropKey] = Math.round(price * 100);
    this.onChange();
    return true;
  }

  refreshFridges() {
    for (const fridge of new Set([this.fridge, this.house.fridge2, ...(this.house.extraFridges ?? [])])) {
      fridge?.refreshInfo();
    }
  }

  reserveOrder() {
    const options = this.stock().filter(crop => crop.available > 0);
    if (!options.length) return;
    const crop = options[Math.floor(this.random() * options.length)];
    const quantity = Math.min(crop.available, 1 + Math.floor(this.random() * 4));
    let remaining = quantity;
    const allocations = [];
    // Storage timestamps also preserve FIFO when a saved game rebuilds the fridge.
    const boxes = [...this.fridge.boxes].sort((a, b) => (a.chilledAt ?? 0) - (b.chilledAt ?? 0));
    for (const box of boxes) {
      const heads = Math.min(remaining, box.lots.get(crop.cropKey)?.heads ?? 0);
      if (!heads) continue;
      allocations.push({ boxId: box.id, heads });
      box.shopReserved = true;
      remaining -= heads;
      if (!remaining) break;
    }
    this.order = {
      cropKey: crop.cropKey, cropName: crop.cropName, quantity,
      totalCents: crop.priceCents * quantity,
      customerVariant: this.day + this.sales,
      allocations, reserved: true, stage: 'arriving', elapsed: 0,
    };
    this.refreshFridges();
    this.onChange();
  }

  collectOrder() {
    const order = this.order;
    const allocations = order.allocations.map(allocation => ({
      ...allocation, box: this.fridge.boxes.find(box => box.id === allocation.boxId),
    }));
    if (allocations.some(entry => (entry.box?.lots.get(order.cropKey)?.heads ?? 0) < entry.heads)) {
      for (const box of this.fridge.boxes) box.shopReserved = false;
      this.order = null;
      this.wait = 8;
      this.refreshFridges();
      this.onNotice('Shop order cancelled because its stock is unavailable.');
      return false;
    }
    for (const { box, heads } of allocations) {
      const lot = box.lots.get(order.cropKey);
      const weightG = lot.weightG * heads / lot.heads;
      lot.heads -= heads;
      lot.weightG = Math.max(0, lot.weightG - weightG);
      box.plantCount -= heads;
      box.weightG = Math.max(0, box.weightG - weightG);
      if (!lot.heads) box.lots.delete(order.cropKey);
      box.shopReserved = false;
      box.cropKey = box.cropSummary[0]?.cropKey ?? null;
      box.cropName = box.cropSummary[0]?.cropName ?? null;
      if (box.isEmpty) {
        this.fridge.removeBox(box);
        box.setStored(false);
        box.setSpawned(false);
      }
      box.refresh();
    }
    order.reserved = false;
    order.allocations = [];
    this.refreshFridges();
    return true;
  }

  update(dt) {
    if (this.day !== this.climate.dayIndex) {
      this.day = this.climate.dayIndex;
      this.sales = 0;
      this.headsSold = 0;
      this.revenueCents = 0;
    }
    const stockHeads = this.fridge.totalHeads;
    if (stockHeads > 10) this.lowStockNotified = false;
    if (this.open && stockHeads <= 10 && !this.lowStockNotified) {
      this.lowStockNotified = true;
      this.onNotice(stockHeads ? 'Shop stock is low. Refill the fridge soon.' : 'Shop is waiting for vegetables. Refill the fridge to resume sales.');
    }
    if (!this.order) {
      if (!this.open || !stockHeads) return;
      this.wait -= dt;
      if (this.wait <= 0) this.reserveOrder();
      return;
    }
    const durations = { arriving: 5, collecting: 7, returning: 7, packing: 3, handover: 1, leaving: 5 };
    this.order.elapsed += dt;
    if (this.order.elapsed < durations[this.order.stage]) return;
    const stage = this.order.stage;
    this.order.elapsed = 0;
    if (stage === 'arriving') this.order.stage = 'collecting';
    if (stage === 'collecting') {
      if (this.collectOrder()) this.order.stage = 'returning';
    }
    if (stage === 'returning') this.order.stage = 'packing';
    if (stage === 'packing') this.order.stage = 'handover';
    if (stage === 'handover') {
      this.market.cash = (Math.round(this.market.cash * 100) + this.order.totalCents) / 100;
      this.sales += 1;
      this.headsSold += this.order.quantity;
      this.revenueCents += this.order.totalCents;
      this.order.stage = 'leaving';
      this.onNotice('Sold ' + this.order.quantity + ' ' + this.order.cropName + ' for S$' + (this.order.totalCents / 100).toFixed(2));
    }
    if (stage === 'leaving') {
      this.order = null;
      this.wait = 12 + this.random() * 13;
    }
    this.onChange();
  }

  status() {
    if (this.order) {
      const stages = {
        arriving: 'Customer arriving', collecting: 'Collecting vegetables',
        returning: 'Bringing order to counter', packing: 'Packing order',
        handover: 'Customer paying', leaving: 'Customer leaving',
      };
      return (this.open ? '' : 'Closing - ') + stages[this.order.stage];
    }
    return this.open ? (this.fridge.totalHeads ? 'Open - waiting for customers' : 'Open - waiting for stock') : 'Closed';
  }

  snapshot() {
    return {
      open: this.open, prices: { ...this.prices }, order: this.order ? structuredClone(this.order) : null,
      wait: this.wait, day: this.day, sales: this.sales, headsSold: this.headsSold, revenueCents: this.revenueCents,
    };
  }

  restore(state = {}) {
    state ??= {};
    this.open = state.open === true;
    this.prices = Object.fromEntries(Object.entries(state.prices ?? {}).filter(([, cents]) =>
      Number.isInteger(cents) && cents >= 10 && cents <= 10000));
    this.wait = Number.isFinite(state.wait) ? Math.max(0, state.wait) : 8;
    this.day = Number.isFinite(state.day) ? state.day : this.climate.dayIndex;
    this.sales = Math.max(0, Number(state.sales) || 0);
    this.headsSold = Math.max(0, Number(state.headsSold) || 0);
    this.revenueCents = Math.max(0, Number(state.revenueCents) || 0);
    this.order = state.order ? structuredClone(state.order) : null;
    for (const box of this.fridge.boxes) box.shopReserved = false;
    if (this.order?.reserved) {
      for (const allocation of this.order.allocations) {
        const box = this.fridge.boxes.find(box => box.id === allocation.boxId);
        if (box) box.shopReserved = true;
      }
    }
    this.refreshFridges();
  }
}
