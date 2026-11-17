/**
 * Couples a carried, transplant-ready nursery tray to the existing NFT crop
 * simulation. A tray is only accepted when the whole 304-plug batch fits the
 * selected table; each gully's 40-hole capacity is respected.
 */
export class SeedlingTransplantController {
  constructor({ simulation, equipment, nursery, pickup }) {
    this.simulation = simulation;
    this.equipment = equipment;
    this.nursery = nursery;
    this.pickup = pickup;
  }

  canTransplant(tableId) {
    const tray = this.pickup?.carried;
    if (!tray) return { ok: false, reason: 'Not carrying a tray' };
    if (!tray.ready) return { ok: false, reason: 'Tray is not transplant-ready' };
    const free = this.simulation?.availablePositions(tableId) ?? 0;
    return {
      ok: free >= tray.germinated,
      free,
      needed: tray.germinated,
      reason:
        free >= tray.germinated
          ? ''
          : `Table only has ${free} free planting holes for ${tray.germinated} seedlings`,
    };
  }

  transplant(tableId) {
    const tray = this.pickup?.carried;
    const table = this.equipment?.tables?.find((entry) => entry.id === tableId);
    if (!tray) return { ok: false, reason: 'Pick up a transplant-ready tray first' };
    if (!tray.ready) return { ok: false, reason: 'Only Day-14 trays can be transplanted' };
    if (!table) return { ok: false, reason: 'NFT table not found' };

    const result = this.simulation.transplantTray({
      tableId,
      cropName: tray.cropName,
      sourceTrayId: tray.id,
      germinated: tray.germinated,
      startDay: tray.growthDay,
      plantedCalendarDay: this.simulation.calendarDay,
    });
    if (!result.ok) return result;

    const returned = this.pickup.completeTransplant();
    this.equipment.updateCrops(0, null);
    return {
      ...result,
      ok: true,
      tableTitle: `Row ${table.row}, bay ${table.bay}`,
      trayId: returned?.id ?? tray.id,
      cropName: tray.cropName,
    };
  }
}
