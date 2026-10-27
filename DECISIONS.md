# Decisions — lunar-field-expedition

| # | Decision | Alternatives | Rationale | Date |
|---|---|---|---|---|
| 1 | Terrain from the real LROC NAC_DTM_APOLLO15 (2 m/px), three LOD heightmaps (30/10/5 m per px) | Hand-modeled terrain | The landforms are the evidence; relief validated against published values | 2026-10-27 |
| 2 | No vertical exaggeration | Exaggerate for drama | Accuracy (plan 01 §9) | 2026-10-27 |
| 3 | Play area cropped to the landing site, a rille segment and the lower Apennine Front | Include the full escarpment | Keeps the DTM within the web size budget; the play area holds the lower ~1 km of the ~4.6 km Front, stated in the README and realism matrix | 2026-10-27 |
| 4 | LM position 26.13239°N, 3.63330°E | Use one source's value | Published values differ slightly (Wikipedia 26.1322°N 3.6339°E; the-moon.us 26.13222°N 3.658°E); the value used sits within that range and matches the DTM | 2026-10-27 |
| 5 | Some station positions (Dune, Station 6/6a, 9A/10) marked "approximate" in the app | Present them as exact | They were read from the NASA traverse map layout; Elbow, St. George, Spur and Bridge come from Davies & Colvin (2000) via quoted snippets (PDF returned 403) | 2026-10-27 |
| 6 | Crater counts kept even though the Front shows fewer craters than the mare | Choose patches that give the expected answer | The disagreement is real (steep slopes erase craters) and Module 3 teaches it as a method limitation; the Front's age comes from samples | 2026-10-27 |
| 7 | Crater counts labeled "computer count, approximate" | Present as definitive | Automated rim-minus-floor detection, diameters ≥ 20 m; real counters disagree | 2026-10-27 |
| 8 | Rubric self-check with an exemplar; the app checks required evidence *types*, not the text | Keyword auto-scoring | Keyword scoring is unreliable and misleading (plan 01 §9) | 2026-10-27 |
| 9 | Both Hadley Rille formation hypotheses presented as open | Pick one | Both appear in the literature; volcanism (not water) is the accepted part | 2026-10-27 |
| 10 | Mission framing fictional; EVA cost model and sample cards labeled simplified | Unlabeled simulation | Honesty rules; the real crew worked under far tighter rules | 2026-10-27 |
| 11 | No astronaut avatar; first-person view | Third-person avatar | Avoids extraneous detail and uncanny figures | 2026-10-27 |
| 12 | Earth texture: NASA Blue Marble (public domain) | Solar System Scope 2k day map (stated CC BY 4.0) | The Solar System Scope license page returned a CAPTCHA on 2026-10-27, so its license couldn't be verified | 2026-10-27 |
| 13 | No Draco/Basis decoders; glTF loader removed | Ship them per template | Nothing in the project loads compressed models or textures; saves 1.7 MB per visit | 2026-10-27 |
| 14 | Preview/test port 4175 (sub-path test 4185), no server reuse | Template default 4173 | Several repos' preview servers run on this machine; reuse let tests hit the wrong app | 2026-10-27 |
| 15 | README evaluation notice says reviews and performance tests are "in progress" | Standard notice now | The standard notice states agent reviews are complete; switch to it once they have run | 2026-10-27 |
