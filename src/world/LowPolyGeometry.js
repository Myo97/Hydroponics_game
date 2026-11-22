import * as THREE from 'three';

// Keep the original dimensions, transforms and animation pivots, but use
// deliberately visible facets rather than smooth high-resolution primitives.
export class LowPolyCylinderGeometry extends THREE.CylinderGeometry {
  constructor(top, bottom, height, radial = 8, vertical = 1, ...rest) {
    super(top, bottom, height, Math.min(radial, 8), Math.min(vertical, 2), ...rest);
  }
}
export class LowPolySphereGeometry extends THREE.SphereGeometry {
  constructor(radius, width = 8, height = 5, ...rest) {
    super(radius, Math.min(width, 8), Math.min(height, 5), ...rest);
  }
}
export class LowPolyTorusGeometry extends THREE.TorusGeometry {
  constructor(radius, tube, radial = 4, tubular = 12, ...rest) {
    super(radius, tube, Math.min(radial, 4), Math.min(tubular, 12), ...rest);
  }
}
