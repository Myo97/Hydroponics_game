/**
 * Camera defaults shared by the renderer, the orbit controls and the settings UI.
 * Keeping the slider range here means the HTML default, the persisted fallback
 * and every projection update can never drift apart again.
 */
export const CAMERA_FOV = Object.freeze({
  min: 55,
  max: 90,
  default: 68,
});

/**
 * Normalise a field-of-view value before it reaches a camera or localStorage.
 * Values below the slider minimum can only come from the old 45 degree orbit
 * default, so they migrate to the designed 68 degree view. Values above the
 * maximum are clamped, and malformed saves fall back to the default.
 */
export function clampFov(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CAMERA_FOV.default;
  if (numeric < CAMERA_FOV.min) return CAMERA_FOV.default;
  return Math.round(Math.min(CAMERA_FOV.max, numeric));
}
