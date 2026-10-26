#!/usr/bin/env bash
# Downloads the raw source data for the terrain pipeline into data/raw/
# (gitignored — never committed). Re-run any time; files are kept if present.
#
# Sources (research/sources.md):
#  - LROC NAC_DTM_APOLLO15 (2 m/px DTM of the Apollo 15 landing site), NASA PDS.
#  - NASA SVS CGI Moon Kit global LROC WAC color map (8k 16-bit sRGB TIFF).
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
mkdir -p .

DTM_URL="https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15.TIF"
DTM_LBL="https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15.LBL"
COLOR_URL="https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_8k.tif"

if [ ! -f NAC_DTM_APOLLO15.TIF ]; then
  echo "downloading LROC DTM (~146 MB)..."
  curl -fL --retry 3 -o NAC_DTM_APOLLO15.TIF "$DTM_URL"
else
  echo "NAC_DTM_APOLLO15.TIF already present"
fi
if [ ! -f NAC_DTM_APOLLO15.LBL ]; then
  curl -fL --retry 3 -o NAC_DTM_APOLLO15.LBL "$DTM_LBL"
fi
if [ ! -f lroc_color_16bit_srgb_8k.tif ]; then
  echo "downloading CGI Moon Kit color map (~30 MB)..."
  curl -fL --retry 3 -o lroc_color_16bit_srgb_8k.tif "$COLOR_URL"
else
  echo "lroc_color_16bit_srgb_8k.tif already present"
fi
echo "raw data ready in data/raw/"
