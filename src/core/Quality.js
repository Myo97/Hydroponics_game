/**
 * Scalable graphics presets.
 * Applied at runtime by Game.applyQuality(). Renderer context itself is not
 * recreated (antialias is fixed), but resolution, shadows, anisotropy and
 * detail geometry all scale.
 */
export const QUALITY_PRESETS = {
  low: {
    id: 'low',
    label: 'Low',
    maxPixelRatio: 1,
    shadowMapSize: 1024,
    shadows: true,
    anisotropy: 2,
    environmentIntensity: 0.45,
    showDetail: false,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    shadows: true,
    anisotropy: 4,
    environmentIntensity: 0.6,
    showDetail: true,
  },
  high: {
    id: 'high',
    label: 'High',
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    shadows: true,
    anisotropy: 8,
    environmentIntensity: 0.6,
    showDetail: true,
  },
};

export const DEFAULT_QUALITY = 'high';

export function getPreset(id) {
  return QUALITY_PRESETS[id] ?? QUALITY_PRESETS[DEFAULT_QUALITY];
}
