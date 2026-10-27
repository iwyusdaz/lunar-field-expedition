# Attribution

All third-party assets used by Lunar Field Expedition, with author, source,
license, date retrieved and the changes made. `public/attribution.json` is
generated from this file by `scripts/build-attribution.mjs` — keep them in sync
by editing this file only.

| # | Asset | Author | Source | License | Date retrieved | Changes made |
|---|---|---|---|---|---|---|
| 1 | LROC NAC DTM "NAC_DTM_APOLLO15" (2 m/px digital terrain model of the Apollo 15 site) | NASA / GSFC / Arizona State University | https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15.TIF (product page: http://wms.lroc.asu.edu/lroc/view_rdr_product/NAC_DTM_APOLLO15) | Public domain (NASA data; credit requested) | 2026-10-27 | Cropped to the play area, resampled and exported as three 16-bit heightmap LODs (30/10/5 m per px) plus derived normal maps by `scripts/process-terrain.sh` + `scripts/build-tiles.mjs`. No vertical exaggeration. Raw DTM not committed. |
| 2 | NASA SVS CGI Moon Kit — LROC WAC Hapke-normalized color mosaic ("lroc_color_2k.jpg") | NASA's Scientific Visualization Studio (LROC WAC data) | https://svs.gsfc.nasa.gov/4720 | Public domain (NASA; credit requested) | 2026-10-27 | Used whole as the global Moon color map (Module 1); cropped to the play area for the local terrain albedo (`albedo-wac.png`). |
| 3 | NASA SVS CGI Moon Kit — LOLA elevation map ("ldem_16_uint.tif") | NASA's Scientific Visualization Studio (LOLA data) | https://svs.gsfc.nasa.gov/4720 | Public domain (NASA; credit requested) | 2026-10-27 | Downsampled to a 1024x512 16-bit PNG displacement map (`public/assets/globe/displacement-1k.png`, half-metres vs 1727400 m, encoded in the sidecar meta). |
| 4 | Apollo 15 photograph AS15-89-12100, "Telephoto view across Hadley Rille photographed during Apollo 15 EVA" (2 Aug. 1971) | NASA (Johnson Space Center) | https://images.nasa.gov/details/as15-89-12100 | Public domain (NASA media usage guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media/; credit requested) | 2026-10-27 | None (displayed as-is in the Apollo 15 comparison view). |
| 5 | Blue Marble: land surface, shallow water and shaded topography ("land_shallow_topo_2048.jpg") | NASA Goddard Space Flight Center (Visible Earth) | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg | Public domain (NASA media usage guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media/; credit requested) | 2026-10-27 | Downscaled from 2048x1024 to 1024x512 (`earth-bluemarble-1k.jpg`) and applied to the Earth disc in the site sky. |
| 6 | three.js 0.186.1 | three.js authors | https://github.com/mrdoob/three.js | MIT | 2026-10-27 | None; bundled by Vite. No Draco/Basis decoders are shipped, because the project loads no compressed models or textures. |
| 7 | Favicon (`public/favicon.svg`) | This project (original work) | — | CC BY 4.0 (with the rest of the content) | — | Original icon: cratered Moon disc. |

Notes:
- NASA imagery and data are generally not copyrighted (public domain) but NASA
  requests credit; this repository credits NASA/GSFC/ASU and NASA SVS in-app
  (Settings > About and the comparison view) and here.
- The Earth texture was switched from a Solar System Scope map to NASA's Blue Marble
  on 2026-10-27: the Solar System Scope license page returned a CAPTCHA, so its
  CC BY 4.0 license could not be verified (see DECISIONS.md).
- NASA usage guidelines (opened 2026-10-27): NASA content "generally [is] not subject
  to copyright in the United States" and may be used for educational purposes,
  including "computer graphical simulations and Internet Web pages".
- The terrain albedo composite combines asset #2 with a procedural tiling
  regolith-noise texture generated in-repo (constructed, labeled as such).
- Everything else in the repository (code, learning content, documents) is MIT /
  CC BY 4.0 as stated in LICENSE and LICENSE-CONTENT.
