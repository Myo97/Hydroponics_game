/**
 * Static collision world.
 * The player is modelled as a vertical capsule approximated by a circle in the
 * XZ plane. Walls, benches and tanks register simple volumes here at build time;
 * resolution pushes the circle out of any overlapping volume, which gives smooth
 * sliding along walls without a physics engine.
 */
export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.circles = [];
  }

  addBox({ x, z, width, depth, label = '' }) {
    const box = {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
      label,
      enabled: true,
    };
    this.boxes.push(box);
    return box;
  }

  addCircle({ x, z, radius, label = '' }) {
    const circle = { x, z, radius, label };
    this.circles.push(circle);
    return circle;
  }

  /**
   * Push a circular body out of every overlapping collider.
   * Runs two passes so corners between two boxes settle correctly.
   */
  resolve(position, radius) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const box of this.boxes) {
        if (box.enabled === false) continue;
        const closestX = Math.min(box.maxX, Math.max(box.minX, position.x));
        const closestZ = Math.min(box.maxZ, Math.max(box.minZ, position.z));
        let dx = position.x - closestX;
        let dz = position.z - closestZ;
        const distanceSq = dx * dx + dz * dz;

        if (distanceSq > radius * radius) continue;

        if (distanceSq > 1e-8) {
          const distance = Math.sqrt(distanceSq);
          const push = radius - distance;
          position.x += (dx / distance) * push;
          position.z += (dz / distance) * push;
        } else {
          // Centre is inside the box: escape along the shallowest axis.
          const left = position.x - box.minX;
          const right = box.maxX - position.x;
          const back = position.z - box.minZ;
          const front = box.maxZ - position.z;
          const smallest = Math.min(left, right, back, front);
          if (smallest === left) position.x = box.minX - radius;
          else if (smallest === right) position.x = box.maxX + radius;
          else if (smallest === back) position.z = box.minZ - radius;
          else position.z = box.maxZ + radius;
        }
      }

      for (const circle of this.circles) {
        const dx = position.x - circle.x;
        const dz = position.z - circle.z;
        const minDistance = circle.radius + radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > minDistance * minDistance) continue;

        const distance = Math.sqrt(distanceSq);
        if (distance < 1e-5) {
          position.x = circle.x + minDistance;
          continue;
        }
        const push = minDistance - distance;
        position.x += (dx / distance) * push;
        position.z += (dz / distance) * push;
      }
    }
    return position;
  }

  /** True when a point is inside the greenhouse footprint (used for the HUD). */
  contains(x, z) {
    return Math.abs(x) <= 12 && z >= -18 && z <= 18;
  }

  dispose() {
    this.boxes.length = 0;
    this.circles.length = 0;
  }
}
