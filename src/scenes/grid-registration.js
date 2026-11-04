/**
 * Registration of the committed v2 heightmaps (public/assets/terrain/height-l*.png,
 * data/work/height-l*.png) to true lon/lat. Pure: used by TerrainField, by
 * scripts/analyze-craters.mjs and by the unit tests.
 *
 * G1 (DECISIONS #60): scripts/process-terrain.sh cropped the heightmaps with -te
 * bounds of lon x 27260.9 and lat x 30331.5 metres, but in that projection (eqc,
 * R = 1,737,400 m, lat_ts 26) a degree is 27254.66 m of longitude and 30323.59 m
 * of latitude. So the grid's rows lie about 207 m north, and its columns about
 * 21 m east, of the AOI they are labelled with. The scene frame (fromLonLat) and
 * the v3 streamed tiles are registered to true lon/lat, so every grid query goes
 * through these functions.
 * @module scenes/grid-registration
 */
export const GRID_CROP = { mPerDegLon: 27260.9, mPerDegLat: 30331.5 };
export const GRID_TRUE = { mPerDegLon: 1737400 * Math.PI / 180 * Math.cos(26 * Math.PI / 180), mPerDegLat: 1737400 * Math.PI / 180 };

function bounds(aoi, width, height) {
  const x0 = aoi.lonWest * GRID_CROP.mPerDegLon, x1 = aoi.lonEast * GRID_CROP.mPerDegLon;
  const y0 = aoi.latSouth * GRID_CROP.mPerDegLat, y1 = aoi.latNorth * GRID_CROP.mPerDegLat;
  return { x0, y1, px: (x1 - x0) / width, py: (y1 - y0) / height };
}

/**
 * Fractional pixel (x right, y down, pixel centres at integers) of the grid
 * sample at true lon/lat.
 * @param {{lonWest:number,lonEast:number,latSouth:number,latNorth:number}} aoi
 */
export function gridPixelOfLonLat(aoi, width, height, lon, lat) {
  const b = bounds(aoi, width, height);
  return { x: (lon * GRID_TRUE.mPerDegLon - b.x0) / b.px - 0.5, y: (b.y1 - lat * GRID_TRUE.mPerDegLat) / b.py - 0.5 };
}

/** True lon/lat of a (fractional) grid pixel; inverse of gridPixelOfLonLat. */
export function lonLatOfGridPixel(aoi, width, height, x, y) {
  const b = bounds(aoi, width, height);
  return { lon: (b.x0 + (x + 0.5) * b.px) / GRID_TRUE.mPerDegLon, lat: (b.y1 - (y + 0.5) * b.py) / GRID_TRUE.mPerDegLat };
}
