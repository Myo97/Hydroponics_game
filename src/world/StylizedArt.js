const PALETTE = {
  'concrete-floor': 0xb9b8a2, 'concrete-plinth': 0x98a794,
  'concrete-apron': 0xa8ad96, 'galvanised-steel': 0x4d7f78,
  'steel-dark': 0x2d434a, aluminium: 0x92aaa4, stainless: 0xa7beb8,
  'pvc-supply': 0xd8d3b8, 'pvc-grey': 0x7d9189, 'pvc-return': 0x39585e,
  'pipe-dark': 0x304a53, 'return-tank': 0x3f806b, grass: 0x6f9853,
  'shade-cloth': 0x6a9579,
  'energy-screen': 0xc2cba8, 'greenhouse-glass': 0xa4cec8, 'door-glass': 0xa4cec8,
};

/** Preserve labels, dashboards and effects; simplify only physical surfaces. */
export function stylizeMaterial(material) {
  if (!material || material.userData.stylized || !(material.isMeshStandardMaterial || material.isMeshPhongMaterial)) return;
  if (material.userData.isLabel || material.userData.isDashboard || /label|screen|display|sign|warning/.test(material.name)) return;
  material.userData.stylized = true;
  material.flatShading = true;
  if ('metalness' in material) material.metalness = Math.min(material.metalness, 0.08);
  if ('roughness' in material) material.roughness = 0.86;
  if ('envMapIntensity' in material) material.envMapIntensity = 0.12;
  if ('clearcoat' in material) material.clearcoat = 0;
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap']) material[key] = null;
  if (PALETTE[material.name] !== undefined) material.color.setHex(PALETTE[material.name]);
  // Canvas labels on unnamed props remain legible. Only known surface maps go.
  if (PALETTE[material.name] !== undefined || /plastic|steel|pump|tank/.test(material.name)) material.map = null;
  material.needsUpdate = true;
}

export function applyStylizedArt(scene) {
  scene.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) stylizeMaterial(material);
  });
}
