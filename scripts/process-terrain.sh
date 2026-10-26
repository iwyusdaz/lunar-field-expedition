#!/usr/bin/env bash
# GDAL pipeline: crop the play area from the LROC Apollo 15 DTM and the CGI Moon
# Kit WAC color map, resample to the three LOD heightmaps (16-bit PNG) that
# scripts/build-tiles.mjs turns into engine-ready tiles + normal maps.
#
# Play area (planetocentric): 25.93–26.32°N, 3.5026–3.6901°E — the Apollo 15
# landing site, the Hadley Rille segment with the Elbow bend, St. George and the
# Apennine Front (Hadley Delta). Fully inside the DTM strip.
#
# 1 unit = 1 metre, no vertical exaggeration anywhere in this pipeline.
set -euo pipefail
cd "$(dirname "$0")/.."

RAW=data/raw
WORK=data/work
mkdir -p "$WORK"

DTM="$RAW/NAC_DTM_APOLLO15.TIF"
COLOR="$RAW/lroc_color_16bit_srgb_8k.tif"

# Equirectangular Moon, sphere radius 1737400 m, standard parallel 26°N
# (matches the DTM's embedded CRS, with lon_0=0 so -te is plain lon*27260.9 m).
SRS="+proj=eqc +lat_ts=26 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m"

LON_W=3.5026368   # DTM westernmost longitude
LON_E=3.6901291   # DTM easternmost longitude
LAT_S=25.93
LAT_N=26.32

MPD_LON=27260.9   # metres per degree of longitude at lat_ts=26 on R=1737400
MPD_LAT=30331.5   # metres per degree of latitude

XMIN=$(python3 -c "print($LON_W * $MPD_LON)")
XMAX=$(python3 -c "print($LON_E * $MPD_LON)")
YMIN=$(python3 -c "print($LAT_S * $MPD_LAT)")
YMAX=$(python3 -c "print($LAT_N * $MPD_LAT)")

echo "AOI (metres): x $XMIN..$XMAX  y $YMIN..$YMAX"

# --- Heightmaps: crop + resample the DTM to the three LOD scales -------------
for LEVEL in "0 30" "1 10" "2 5"; do
  set -- $LEVEL
  IDX=$1; MPP=$2
  W=$(python3 -c "print(round(($XMAX-$XMIN)/$MPP))")
  H=$(python3 -c "print(round(($YMAX-$YMIN)/$MPP))")
  echo "LOD$IDX: ${MPP} m/px -> ${W}x${H}"
  gdalwarp -q -overwrite -t_srs "$SRS" -te "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
    -ts "$W" "$H" -r bilinear -ot Float32 -dstnodata -32767 \
    "$DTM" "$WORK/dtm-l$IDX-f32.tif"
  # min/max over valid pixels
  STATS=$(gdalinfo -stats -norat -noct "$WORK/dtm-l$IDX-f32.tif" 2>/dev/null \
    | grep -oE 'Minimum=[-0-9.e+]+, Maximum=[-0-9.e+]+' | head -1)
  VMIN=$(echo "$STATS" | sed -E 's/Minimum=([-0-9.e+]+),.*/\1/')
  VMAX=$(echo "$STATS" | sed -E 's/.*, Maximum=([-0-9.e+]+)/\1/')
  LO=$(python3 -c "import math; print(math.floor(float('$VMIN'))-1)")
  HI=$(python3 -c "import math; print(math.ceil(float('$VMAX'))+1)")
  echo "  elev range: $VMIN .. $VMAX -> encoding [$LO, $HI]"
  gdal_translate -q -ot UInt16 -scale "$LO" "$HI" 0 65535 \
    -of PNG -co ZLEVEL=9 "$WORK/dtm-l$IDX-f32.tif" "$WORK/height-l$IDX.png"
  printf '{"width": %s, "height": %s, "mPerPx": %s, "elevMin": %s, "elevMax": %s}\n' \
    "$W" "$H" "$MPP" "$LO" "$HI" > "$WORK/height-l$IDX.meta.json"
done

# --- Albedo: crop the CGI Moon Kit global WAC color map to the AOI -----------
# The global 8k map is 8192x4096 for 360x180 deg (22.76 px/deg): over our AOI
# that is only ~44x31 px. This IS the real LROC WAC color at global resolution;
# the app labels it as such (see ATTRIBUTION.md + in-app credit).
COLOR_SRS="+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m"
# The CGI Moon Kit map is a plain equirectangular image: lon -180..180, lat 90..-90.
gdal_translate -q -a_ullr -180 90 180 -90 -a_srs "+proj=longlat +R=1737400 +no_defs" \
  "$COLOR" "$WORK/wac-color-geo.tif"
CXMIN=$(python3 -c "print($LON_W * 30331.53)")
CXMAX=$(python3 -c "print($LON_E * 30331.53)")
CYMIN=$(python3 -c "print($LAT_S * 30331.53)")
CYMAX=$(python3 -c "print($LAT_N * 30331.53)")
gdalwarp -q -overwrite -t_srs "$COLOR_SRS" -te "$CXMIN" "$CYMIN" "$CXMAX" "$CYMAX" \
  -ts 512 1024 -r cubic -ot UInt16 -dstnodata 0 \
  "$WORK/wac-color-geo.tif" "$WORK/wac-color-crop.tif"
gdal_translate -q -ot Byte -scale 0 65535 0 255 -of PNG -co ZLEVEL=9 \
  "$WORK/wac-color-crop.tif" "$WORK/albedo-wac.png"
echo "  albedo: $(gdalinfo "$WORK/albedo-wac.png" | grep 'Size is')"

# --- Shaded-relief preview: used to verify the rille position and to place /
#     cross-check traverse-station coordinates against the real terrain ------
gdaldem hillshade -z 3 -q "$WORK/dtm-l0-f32.tif" "$WORK/hillshade-preview.png" -of PNG
gdaldem hillshade -z 3 -q "$WORK/dtm-l2-f32.tif" "$WORK/hillshade-l2.png" -of PNG

echo "done: intermediates in $WORK (gitignored)"
