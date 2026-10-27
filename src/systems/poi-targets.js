/**
 * Camera targets for the points-of-interest list. Content mixes two coordinate
 * forms: stations and features store lon/lat, crater patches store their centre
 * in site metres (`center.xM/yM`). These helpers turn either into a finite
 * metric point, or null, so the camera is never sent to NaN.
 * @module systems/poi-targets
 */

/** Camera target for a crater patch (centre in site metres, radius for framing). */
export function patchTarget(patch) {
  return { xM: patch.center.xM, yM: patch.center.yM, radiusM: patch.radiusM };
}

/**
 * Resolve a target to {xM, yM}. Accepts {xM, yM} or {lon, lat}.
 * @param {object} pos
 * @param {(lon:number, lat:number) => {xM:number, yM:number}} fromLonLat
 * @returns {{xM:number, yM:number} | null}
 */
export function resolveTarget(pos, fromLonLat) {
  if (!pos) return null;
  let P = null;
  if (Number.isFinite(pos.xM) && Number.isFinite(pos.yM)) P = { xM: pos.xM, yM: pos.yM };
  else if (Number.isFinite(pos.lon) && Number.isFinite(pos.lat)) P = fromLonLat(pos.lon, pos.lat);
  if (!P || !Number.isFinite(P.xM) || !Number.isFinite(P.yM)) return null;
  return P;
}
