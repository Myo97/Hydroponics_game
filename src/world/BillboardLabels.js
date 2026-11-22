import * as THREE from 'three';

/**
 * Version 14 in-world signage.
 *
 * Ready badges and harvest prompts stay unlit, billboard towards the camera and
 * are clickable through the same raycast that drives every other interaction.
 * LabelField draws one shared canvas per state onto an InstancedMesh, so each
 * bay only costs a single draw call.
 */

export const LABEL_VARIANTS = {
  ready: {
    background: 'rgba(22, 78, 62, 0.94)',
    border: '#74d6b4',
    text: '#eafff7',
    dot: '#74d6b4',
  },
  harvest: {
    background: 'rgba(86, 58, 12, 0.94)',
    border: '#e3b568',
    text: '#fff3d8',
    dot: '#e3b568',
  },
  store: {
    background: 'rgba(18, 46, 66, 0.94)',
    border: '#7fb6e0',
    text: '#e6f4ff',
    dot: '#7fb6e0',
  },
  muted: {
    background: 'rgba(18, 22, 23, 0.9)',
    border: 'rgba(255, 255, 255, 0.3)',
    text: '#cfd8d4',
    dot: '#9aa6a2',
  },
  warn: {
    background: 'rgba(74, 32, 24, 0.94)',
    border: '#e07b6a',
    text: '#ffe7e1',
    dot: '#e07b6a',
  },
};

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 192;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Headless-safe canvas so the smoke tests can build the world in Node. */
function createCanvas() {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    return canvas;
  }
  return {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    getContext: () => null,
  };
}

function paintLabel(canvas, text, variant) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const palette = LABEL_VARIANTS[variant] ?? LABEL_VARIANTS.ready;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);


  roundedRect(ctx, 6, 6, width - 12, height - 12, 26);
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = palette.border;
  ctx.stroke();

  const dotX = 46;
  ctx.beginPath();
  ctx.arc(dotX, height / 2, 13, 0, Math.PI * 2);
  ctx.fillStyle = palette.dot;
  ctx.fill();

  let fontSize = Math.round(height * 0.38);
  const maxWidth = width - dotX - 60;
  do {
    ctx.font = `800 ${fontSize}px "Segoe UI", "Inter", system-ui, sans-serif`;
    fontSize -= 2;
  } while (ctx.measureText(text).width > maxWidth && fontSize > 14);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;
  ctx.fillText(text, dotX + 22 + (maxWidth - 22) / 2, height / 2 + 2);
}

function createBillboardMaterial(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  material.name = 'billboard-label';
  return { texture, material };
}

/**
 * Pool of identically sized badges sharing one texture and one draw call.
 * `setEntries([{ position, data }])` reuses the existing instanced geometry as
 * long as the entry count is stable.
 */
export class LabelField {
  constructor({
    parent = null,
    camera = null,
    name = 'label-field',
    text = '',
    variant = 'ready',
    width = 0.9,
    height = 0.32,
    depthOffset = 0,
    capacity = 0,
  } = {}) {
    this.parent = parent;
    this.camera = camera;
    this.width = width;
    this.height = height;
    this.depthOffset = depthOffset;
    this.capacity = Math.max(0, capacity);
    this.name = name;
    this.entries = [];
    this.text = text;
    this.variant = variant;
    this.mesh = null;

    this.canvas = createCanvas();
    const { texture, material } = createBillboardMaterial(this.canvas);
    this.texture = texture;
    this.material = material;
    this.paint(text, variant);
  }

  paint(text = this.text, variant = this.variant) {
    this.text = text;
    this.variant = variant;
    paintLabel(this.canvas, text, variant);
    this.texture.needsUpdate = true;
    return this;
  }

  #allocate(count) {
    const needed = Math.max(1, count, this.capacity);
    // Keep a pooled mesh so a field whose entry count changes (nursery trays
    // reaching day 14) never swaps the InstancedMesh out from under the
    // interaction candidate list.
    if (this.mesh && this.capacity >= needed) return;
    if (this.mesh) {
      this.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this.capacity = needed;
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(this.width, this.height),
      this.material,
      this.capacity,
    );
    mesh.name = this.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.userData.interactable = null;
    mesh.userData.resolveInteractable = (index) =>
      index >= 0 && index < this.entries.length ? this.entries[index].data ?? null : null;
    mesh.userData.labelField = this;
    this.mesh = mesh;
    this.parent?.add(mesh);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let index = 0; index < count; index += 1) mesh.setMatrixAt(index, hidden);
    mesh.instanceMatrix.needsUpdate = true;
  }

  setEntries(entries = []) {
    this.entries = entries;
    const needed = Math.max(1, entries.length);
    if (!this.mesh || this.capacity < needed) this.#allocate(needed);
    if (!this.mesh) return this;
    this.mesh.count = needed;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);
    const hidden = new THREE.Vector3(0, 0, 0);
    for (let index = 0; index < needed; index += 1) {
      const point = entries[index]?.position;
      if (!point) {
        matrix.compose(position, quaternion, hidden);
      } else {
        position.set(point.x ?? 0, (point.y ?? 0) + this.depthOffset, point.z ?? 0);
        matrix.compose(position, quaternion, unit);
      }
      this.mesh.setMatrixAt(index, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return this.update();
  }

  update(camera = this.camera) {
    if (!this.mesh || !camera) return this;
    // Each instance matrix contains a world-space position. Rotating the parent
    // InstancedMesh to face the camera would rotate those translations around
    // the scene origin, making labels drift away from their equipment. Keep the
    // field transform fixed and billboard each plane inside its own matrix.
    this.mesh.position.set(0, 0, 0);
    this.mesh.quaternion.identity();
    this.mesh.scale.set(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const cameraRotation = camera.quaternion;
    for (let index = 0; index < this.entries.length; index += 1) {
      const point = this.entries[index]?.position;
      if (!point) {
        scale.set(0, 0, 0);
        matrix.compose(position.set(0, 0, 0), cameraRotation, scale);
      } else {
        position.set(point.x ?? 0, (point.y ?? 0) + this.depthOffset, point.z ?? 0);
        scale.set(1, 1, 1);
        matrix.compose(position, cameraRotation, scale);
      }
      this.mesh.setMatrixAt(index, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return this;
  }

  getInteractable(index) {
    return this.entries[index]?.data ?? null;
  }

  setVisible(visible) {
    if (this.mesh) this.mesh.visible = visible;
    return this;
  }

  dispose() {
    if (this.mesh) {
      this.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this.texture?.dispose();
    this.material?.dispose();
    this.texture = null;
    this.material = null;
    this.entries = [];
  }
}

/** Single billboard badge used for doors, fridges, gates and carried boxes. */
export class BillboardLabel {
  constructor({
    parent = null,
    camera = null,
    text = '',
    variant = 'ready',
    width = 0.9,
    height = 0.26,
    position = { x: 0, y: 0, z: 0 },
    renderOrder = 14,
  } = {}) {
    this.parent = parent;
    this.camera = camera;
    this.variant = variant;
    this.canvas = createCanvas();
    const { texture, material } = createBillboardMaterial(this.canvas);
    this.texture = texture;
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.interactable = null;
    this.parent?.add(this.mesh);
    this.text = '';
    this.setText(text, variant);
  }

  setText(text, variant = this.variant) {
    if (text === this.text && variant === this.variant) return this;
    this.text = text;
    this.variant = variant;
    paintLabel(this.canvas, text, variant);
    this.texture.needsUpdate = true;
    this.mesh.visible = Boolean(text);
    return this;
  }

  setInteractable(data) {
    this.mesh.userData.interactable = data ?? null;
    return this;
  }

  setVisible(visible) {
    this.mesh.visible = Boolean(visible) && Boolean(this.text);
    return this;
  }

  update(camera = this.camera) {
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
    return this;
  }

  dispose() {
    this.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.mesh = null;
  }
}

