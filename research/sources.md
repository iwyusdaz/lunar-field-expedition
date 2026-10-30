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

## v3 sources (plan 10, stage S4; accessed 2026-10-30/31)

Downloaded by `scripts/fetch-v3-assets.mjs`, which refuses any source whose licence it
cannot confirm (allowed list, forbidden NC/ND/SA terms, allowed hosts, licence evidence
page fetched and matched, Poly Haven md5). Its log is
`evaluation/results/asset-licence-check.json`. Raw files stay in `data/raw/v3/` (not committed).

### Data, textures and models

| Asset | Source URL | Licence (evidence) | Used for |
|---|---|---|---|
| SLDEM2015 (LOLA + Kaguya TC merged DEM, 512 px/deg, ~59 m), window 24.75-27.5 N, 2.1-5.17 E read by HTTP range requests from tile `SLDEM2015_512_00N_30N_000_045_FLOAT.IMG` | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/ (product page https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m) | Public domain (USGS Astropedia access constraints: "public domain"; cite the LOLA and Kaguya teams, Barker et al. 2016) | Far terrain tiles (whole Apennine Front, Mons Hadley, Mons Hadley Delta); fills the NAC strip's no-data edges |
| Clementine UVVIS 750 nm global mosaic v2.1 (118 m) | https://planetarymaps.usgs.gov/mosaic/Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif (product page https://astrogeology.usgs.gov/search/map/moon_clementine_uvvis_global_mosaic_118m) | Public domain (USGS Astropedia product page) | Regional relative albedo of the far terrain |
| Poly Haven textures moon_01, moon_dusted_02, moon_footprints_01, moon_track_04 | https://polyhaven.com/a/moon_01 · https://polyhaven.com/a/moon_dusted_02 · https://polyhaven.com/a/moon_footprints_01 · https://polyhaven.com/a/moon_track_04 | CC0 1.0 (https://polyhaven.com/license) | Regolith detail (meso 3.1 m and macro 0.4 m tiles), bootprint patch, rover-track strip |
| Poly Haven models moon_rock_04 to moon_rock_07 | https://polyhaven.com/a/moon_rock_04 (and _05, _06, _07) | CC0 1.0 | Small rocks and boulder instances; moon_rock_07 recoloured as the reconstructed Genesis Rock |
| NASA Blue Marble 2048 (land, shallow water, shaded topography) | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg | Public domain (NASA media guidelines https://www.nasa.gov/nasa-brand-center/images-and-media/) | Earth day map (2048 px, for the framed close-up) |
| NASA Blue Marble clouds 2048 | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg | Public domain (NASA media guidelines) | Earth's moving cloud layer (time-lapse) |
| Yale Bright Star Catalogue 5th ed. (preliminary), HEASARC table BSC5P | https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz (table page https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html) | Public domain: U.S. Government work (data.nasa.gov dataset page https://data.nasa.gov/dataset/bright-star-catalog lists https://www.usa.gov/government-works) | Real star positions, V magnitudes and B-V colours for the starfield |

Considered and **not used**: NASA 3D Resources "Apollo Lunar Module" GLB
(https://github.com/nasa/NASA-3D-Resources). The repository README says the assets are
"free and without copyright", but its `meta.json` lists the "NASA Open Source Agreement
Version 1.3", which is not on the allowed list, and several contributors are contractors.
The terms are unclear, so plan 09's rule applies (model it ourselves); the v2 own-work LM,
rover, flag and crew stay, and the ALSEP set is new own work.

### Catalog and fact sources (content/objects.json; numbers in apollo15-facts.md)

- NSSDC Moon fact sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html
- NSSDC Apollo LRV page: https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html
- Wikipedia, Lunar Roving Vehicle: https://en.wikipedia.org/wiki/Lunar_Roving_Vehicle
- Wikipedia, Apollo Lunar Module: https://en.wikipedia.org/wiki/Apollo_Lunar_Module
- Wikipedia, Lunar Flag Assembly: https://en.wikipedia.org/wiki/Lunar_Flag_Assembly
- Wikipedia, ALSEP: https://en.wikipedia.org/wiki/Apollo_Lunar_Surface_Experiments_Package
- Wikipedia, Libration: https://en.wikipedia.org/wiki/Libration
- NSSDC experiment pages: passive seismic https://nssdc.gsfc.nasa.gov/nmc/experiment/display.action?id=1971-008C-04 · lunar surface magnetometer https://nssdc.gsfc.nasa.gov/nmc/experiment/display.action?id=1972-031C-03
- Smithsonian NASM, SNAP-27 generator assembly: https://airandspace.si.edu/collection-objects/generator-assembly-rtg-snap-27/nasm_A19731201000
- Apache Point Observatory, Apollo retroreflector arrays: https://www.apo.nmsu.edu/mainpage/apollo/apollolrrr/ · ILRS / NASA presentation (Currie & Torre 2019): https://ilrs.gsfc.nasa.gov/2019_Technical_Workshop/docs/2019/presentations/SLRschool/Session1/SLRschool_session1_Currie_Torre_presentation.pdf
- IAU Gazetteer of Planetary Nomenclature: Mons Hadley https://planetarynames.wr.usgs.gov/Feature/3983 · Mons Hadley Delta https://planetarynames.wr.usgs.gov/Feature/3984 · Rima Hadley https://planetarynames.wr.usgs.gov/Feature/5064 · St. George https://planetarynames.wr.usgs.gov/Feature/5678 · Spur https://planetarynames.wr.usgs.gov/Feature/5673 · Elbow https://planetarynames.wr.usgs.gov/Feature/1759 · Dune https://planetarynames.wr.usgs.gov/Feature/1662
- NASA Lunar Sample Compendium, 15415: https://curator.jsc.nasa.gov/lunar/lsc/15415.pdf
- NASA Earth Observatory, "Where are the stars?": http://earthobservatory.nasa.gov/blogs/earthmatters/2011/09/28/where-are-the-stars/
- NASA Meteoroid Environment Office, Lunar Impact Monitoring: https://www.nasa.gov/meteoroid-environment-office/lunar-impact-monitoring/
- Apollo Lunar Surface Journal, Lunar Gaits: https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.gaits.html
- American Museum of Natural History, meteorite impacts on the Moon: https://www.amnh.org/exhibitions/permanent/meteorites/meteorite-impacts/on-the-moon
- NSSDC Sun fact sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
- Wikipedia, Apollo command and service module: https://en.wikipedia.org/wiki/Apollo_command_and_service_module
- Wikipedia, Mons Hadley and Mons Hadley Delta: https://en.wikipedia.org/wiki/Mons_Hadley · https://en.wikipedia.org/wiki/Mons_Hadley_Delta
- LRV track width (secondary): https://www.thisdayinaviation.com/31-july-1971/
- NASA NTRS, lunar impact flash locations: https://ntrs.nasa.gov/citations/20150021386
