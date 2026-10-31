/**
 * frame.js — sky and site geometry for the v3 Hadley scene (pure maths, no
 * THREE or DOM, so the unit tests can check it).
 *
 * World frame (same as v2, so the tools, cinematics and crater data keep their
 * coordinates): +x east, +y up (LROC datum metres), +z south. The streamed v3
 * tiles are placed so the LM sits at its v2 world position.
 *
 * Sky model, all from the site's selenographic position (26.13239 N, 3.63330 E):
 *  - Earth: the sub-Earth point is taken at 0 N, 0 E (mean libration), so Earth
 *    stands about 63.5 deg up, azimuth about 188 deg (south, a little west). It
 *    never rises or sets here: libration only moves it a few degrees.
 *  - Sun: on the lunar equator plane (the Sun's selenographic latitude stays
 *    within 1.6 deg), at an hour angle h = subsolar longitude - site longitude.
 *    Morning at Hadley means the subsolar point lies east of the site (h > 0);
 *    h falls by 360 deg per synodic month (29.53 days), about 0.51 deg an hour.
 *  - Stars: J2000 equatorial -> ecliptic (obliquity 23.44 deg) -> lunar frame
 *    (the lunar pole is within 1.6 deg of the ecliptic pole), turned so the Sun
 *    sits at its ecliptic longitude on the Apollo 15 date (about 128 deg on
 *    1971-07-31). Stars turn with the Sun (sidereal and synodic rates differ by
 *    8 %, ignored).
 * @module lunar/frame
 */

export const MOON_RADIUS_M = 1737400;
export const SITE = Object.freeze({ lat: 26.13239, lon: 3.6333 });
export const SYNODIC_DAYS = 29.530589;
export const SUN_DEG_PER_HOUR = 360 / (SYNODIC_DAYS * 24);
export const EARTH_DISTANCE_M = 384_400_000; // mean; 356,000-406,000 km over a month
export const EARTH_DIAMETER_M = 12_742_000;
export const SUN_DISTANCE_M = 149_600_000_000;
export const SUN_DIAMETER_M = 1_391_400_000;
export const OBLIQUITY_DEG = 23.44;
export const SUN_ECLIPTIC_LON_DEG = 128; // 1971-07-31 (Apollo 15 EVAs, 31 Jul - 2 Aug)

const D = Math.PI / 180;

/** Local east/north/up unit vectors at the site, in selenographic Cartesian (X to 0 E, Z north pole). */
export function siteBasis(lat = SITE.lat, lon = SITE.lon) {
  const p = lat * D, l = lon * D;
  return {
    up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
    east: [-Math.sin(l), Math.cos(l), 0],
    north: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Selenographic direction -> world vector {x east, y up, z south}. */
export function selenoToWorld(v, basis = siteBasis()) {
  return { x: dot(v, basis.east), y: dot(v, basis.up), z: -dot(v, basis.north) };
}

/** Elevation and azimuth (0 = north, clockwise) of a world direction. */
export function elevAz(w) {
  const len = Math.hypot(w.x, w.y, w.z);
  const el = Math.asin(w.y / len) / D;
  let az = Math.atan2(w.x, -w.z) / D;
  if (az < 0) az += 360;
  return { elevationDeg: el, azimuthDeg: az };
}

/** Direction to Earth (world). */
export function earthDirection() {
  return selenoToWorld([1, 0, 0]);
}

/** Direction to the Sun (world) for an hour angle h in degrees (subsolar lon - site lon). */
export function sunDirectionForHourAngle(hDeg, lat = SITE.lat, lon = SITE.lon) {
  const ls = (lon + hDeg) * D;
  return selenoToWorld([Math.cos(ls), Math.sin(ls), 0], siteBasis(lat, lon));
}

/**
 * Morning hour angle that puts the Sun at a given elevation (deg). The Sun
 * cannot climb higher than 90 - latitude (about 63.9 deg) at Hadley.
 */
export function hourAngleForElevation(elevationDeg, lat = SITE.lat) {
  const c = Math.sin(elevationDeg * D) / Math.cos(lat * D);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D;
}

export const MAX_SUN_ELEVATION_DEG = 90 - SITE.lat;

/** Curvature drop (m) of the real surface below the LM's tangent plane at horizontal distance d. */
export function curvatureDrop(d) { return (d * d) / (2 * MOON_RADIUS_M); }

/** Distance to the horizon (m) for an eye h metres above a smooth sphere. */
export function horizonDistance(h) { return Math.sqrt(2 * MOON_RADIUS_M * h + h * h); }

/** Angular diameter (rad) of a body. */
export function angularDiameter(diameter, distance) { return 2 * Math.atan(diameter / 2 / distance); }

/**
 * 3x3 matrix (row-major, rows = world x, y, z) taking a J2000 equatorial unit
 * vector to a world direction for a given Sun hour angle.
 */
export function equatorialToWorldMatrix(hDeg, { sunEclLonDeg = SUN_ECLIPTIC_LON_DEG, lat = SITE.lat, lon = SITE.lon } = {}) {
  const e = OBLIQUITY_DEG * D;
  // equatorial -> ecliptic: rotate about x by -obliquity
  const eq2ecl = [[1, 0, 0], [0, Math.cos(e), Math.sin(e)], [0, -Math.sin(e), Math.cos(e)]];
  // ecliptic -> selenographic: about the pole, Sun's ecliptic longitude -> subsolar longitude
  const a = (lon + hDeg - sunEclLonDeg) * D;
  const ecl2sel = [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const b = siteBasis(lat, lon);
  const sel2world = [b.east, b.up, b.north.map((x) => -x)];
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul(sel2world, mul(ecl2sel, eq2ecl));
}

export function applyMatrix3(m, v) {
  return { x: m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], y: m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], z: m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] };
}

/** Earth's spin axis (world) for the Sun hour angle: the north celestial pole through the same chain. */
export function earthAxis(hDeg) {
  return applyMatrix3(equatorialToWorldMatrix(hDeg), [0, 0, 1]);
}

/** Relative brightness of a star of V magnitude m (1 at m = 0). */
export function starFlux(m) { return 10 ** (-0.4 * m); }

/** Approximate RGB (0-1) for a B-V colour index. */
export function bvToRgb(bv) {
  const t = Math.max(-0.4, Math.min(2, bv));
  // Blue-white stars to orange-red stars; a gentle ramp, not a spectral fit.
  const r = t < 0.4 ? 0.75 + 0.6 * (t + 0.4) / 0.8 : 1;
  const g = t < 0.4 ? 0.85 + 0.15 * (t + 0.4) / 0.8 : 1 - 0.38 * (t - 0.4) / 1.6;
  const bl = t < 0 ? 1 : 1 - 0.65 * Math.min(1, t / 1.6);
  return [Math.min(1, r), Math.max(0, g), Math.max(0, bl)];
}

/** Ballistic hop height (m) for a take-off speed (m/s) at lunar gravity. */
export const LUNAR_G = 1.62;
export function hopHeight(v) { return (v * v) / (2 * LUNAR_G); }

/** Pendulum period (s) at lunar gravity. */
export function pendulumPeriod(lengthM) { return 2 * Math.PI * Math.sqrt(lengthM / LUNAR_G); }
