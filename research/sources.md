# Sources and assets

Access date for all entries: 2026-10-27. Every fact-level claim is also logged in
`apollo15-facts.md` with verification status.

## Terrain data

| Asset | Source URL | License | Retrieved | Changes made |
|---|---|---|---|---|
| LROC NAC_DTM_APOLLO15.TIF (2 m/px DTM, 146 MB) | https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15.TIF (product page http://wms.lroc.asu.edu/lroc/view_rdr_product/NAC_DTM_APOLLO15) | NASA/LRO public domain (credit NASA/GSFC/ASU) | 2026-10-27 | Cropped to the play area, resampled to 16-bit heightmap tiles + normal maps by `scripts/process-terrain.sh` (raw file not committed) |
| NASA SVS CGI Moon Kit color map, `lroc_color_16bit_srgb_8k.tif` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_8k.tif | NASA / Scientific Visualization Studio, public domain (page asks for credit; built from the LROC WAC Hapke-normalized mosaic; "optimized for aesthetics, not science") | 2026-10-27 | Cropped to the play area, upsampled, packed as the terrain albedo texture by `scripts/process-terrain.sh` |

## Imagery used in content pages

| Asset | Source URL | License | Notes |
|---|---|---|---|
| (none yet — photos are referenced by URL in attribution only if embedded) | | | To stay inside the no-third-party-requests rule, no external images are loaded at runtime. Text mode uses the same in-app derived maps. |

## Evidence base cited in design docs

- Frontiers in Education (2026), virtual vs hands-on labs meta-analysis: https://www.frontiersin.org/articles/10.3389/feduc.2026.1869632
- Zhao et al. (2022), immersive vs desktop virtual field trips: https://journals.sagepub.com/doi/10.1177/07356331211062925
- Serious games meta-analysis (d ≈ 0.64): https://pdfs.semanticscholar.org/0c36/16c8cdff978d9bd81af23a773699979db9de.pdf
- Seductive-details meta-analysis (2025): https://link.springer.com/content/pdf/10.1007/s10648-025-10099-z.pdf
- Decorative animation and recall: https://journals.physiology.org/doi/full/10.1152/advan.00102.2019
- NASA history, Apollo 15 at Hadley–Apennine: https://www.nasa.gov/history/50-years-ago-apollo-15-on-the-moon-at-hadley-apennine
- G.J. Taylor (2012), Hadley–Apennine KREEP basalt province: https://spudislunarresources.nss.org/Bibliography/p/105.pdf
- Davies & Colvin (2000), Apollo lander lunar coordinates: https://agupubs.onlinelibrary.wiley.com/doi/pdf/10.1029/1999JE001165 (403 for us; used via search snippets, flagged)
- NGSS HS-ESS1-6: https://www.nextgenscience.org/pe/hs-ess1-6-earths-place-universe

## Procedural / original assets

- Starfield, Earth-in-sky rendering, UI icons (favicon, feature icons): original,
  made for this repo, MIT/CC BY 4.0 as applicable.
- If any asset turns out to be procedural rather than the real dataset, it is labeled
  as such in the app and in ATTRIBUTION.md (honesty rule).
