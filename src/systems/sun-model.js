/**
 * Pure sun-geometry helpers (no THREE, no DOM) so unit tests can verify the
 * light direction math that drives the sun-angle tool.
 * @module systems/sun-model
 */

/**
 * Direction TO the sun for an elevation/azimuth pair.
 * @param {number} elevationDeg deg above horizon
 * @param {number} azimuthDeg 0 = north, 90 = east (clockwise)
 * @returns {{x:number,y:number,z:number}} unit vector; +x east, +y up, +z south
 */
export function sunDirection(elevationDeg, azimuthDeg) {
  const elev = clamp(elevationDeg, 0.01, 89.9) * Math.PI / 180;
  const az = azimuthDeg * Math.PI / 180;
  return {
    x: Math.cos(elev) * Math.sin(az),
    y: Math.sin(elev),
    z: -Math.cos(elev) * Math.cos(az), // az 0 -> -z (north), az 180 -> +z (south)
  };
}

/**
 * Shadow length multiplier for an object of height 1: 1 / tan(elevation).
 * @param {number} elevationDeg
 */
export function shadowLengthFactor(elevationDeg) {
  const e = clamp(elevationDeg, 0.5, 89.9) * Math.PI / 180;
  return 1 / Math.tan(e);
}

/**
 * Sun-angle presets from content/features.json. Validates shape so a broken
 * content file fails loudly in tests.
 * @param {Array<{id:string,elevationDeg:number,azimuthDeg:number}>} presets
 */
export function validatePresets(presets) {
  if (!Array.isArray(presets) || presets.length < 3) throw new Error('sun presets: need >= 3 presets');
  for (const p of presets) {
    if (typeof p.elevationDeg !== 'number' || p.elevationDeg <= 0 || p.elevationDeg >= 90) {
      throw new Error(`sun preset ${p.id}: elevationDeg must be 0-90 exclusive`);
    }
    if (typeof p.azimuthDeg !== 'number' || p.azimuthDeg < 0 || p.azimuthDeg >= 360) {
      throw new Error(`sun preset ${p.id}: azimuthDeg must be 0-360`);
    }
  }
  return true;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
