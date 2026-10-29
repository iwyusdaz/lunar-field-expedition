# Agent review — v2.0.0 honesty and accessibility

Agent review (automated reviewer). Date: 2026-10-29. Build `main @ 0e64a47`, test build, served on 127.0.0.1:4191. axe-core via `@axe-core/playwright` with tags wcag2a/aa and wcag21a/aa, canvas excluded (the same configuration as `tests/a11y.spec.js`). Automated axe does not replace testing with assistive technology. No screen reader was run.

## axe results (critical / serious)

| State | Critical/serious | Other |
|---|---|---|
| M1 arrival (globe) | 0 | 0 |
| M2 sun tool | 0 | 0 |
| M3 crater counter (before and after submit) | 0 | 0 |
| M4 traverse planner | 0 | 0 |
| M5 evidence board / report | 0 | 0 |
| M5 text mode | 0 | 0 |
| **M2 with the HUD drawer collapsed** | **1 serious: `color-contrast`, 2 nodes (`#task-panel > h2`, `.module-intro`)** | 0 |

The required states pass the gate. The collapsed-drawer state, which is new in v2 and is not in `tests/a11y.spec.js`, fails it. The panel fades to opacity 0.18 but keeps its text and its focusable controls. Tab reaches `#sun-elev`, `#sun-az` and the preset buttons while they are off-screen and faded. This is **major**, tracked as I-2 in the interaction review. Fix: make the collapsed panel `inert` (`src/v2/cinematic-grade.js:426-431`), and add a collapsed-drawer scan to `tests/a11y.spec.js`.

## Contrast of the v2 styles

| Pair | Ratio | Verdict |
|---|---|---|
| Tooltip text `#f8fafc` on `#11161d` (Plex Mono 600, 13.8 px) | 17.4:1 | ✓ |
| Tooltip border NASA orange `#e87722` on `#11161d` | 6.1:1 | ✓ (non-text ≥ 3:1) |
| Orange ring on black sky / shadow `#07080a` | 6.8:1 | ✓ |
| Orange ring on sunlit regolith `#8c8780` | **1.2:1** | ✗ for non-text 3:1 if the ring were the only cue. The ring also has a bright diamond beacon and a tooltip, and it is not needed for any objective. Minor. A dark outline ring would fix it. |
| HUD / panel text `#1a2028` on white 0.88–0.94 | ≈ 16:1 | ✓ (light panels over the black sky, as in v1) |
| `.scene-note` `#4c5666` on 0.88 white over the black sky | ≈ 5.6:1 | ✓ |

Note: the art bible (§2) describes the HUD as shadow-black surfaces with sunlit text. The shipped panels are still the v1 light cards (`#task-panel` background `rgba(255,255,255,0.94)`). The contrast is fine, but the art bible does not match the build. Minor: either restyle or correct the art bible.

## Honesty labels

| Label | Present? | Where |
|---|---|---|
| Fictional mission | ✓ Scene note "The field-team mission is fictional." is in the POI box on every site view. M1 globe text: "That mission is fictional". Crew tooltips: "Crew member A/B (fictional mission)". | `src/app.js:280`, `content/modules.json` m1-globe, `src/app.js:168-169` |
| Earth position approximate | ✓ "Earth's position in the sky is approximate." | `src/app.js:280` |
| Terrain not exaggerated | ✓ | same note |
| Procedural props built from photos, not NASA models | ✓ ATTRIBUTION row 14: "Built procedurally in three.js from public-domain NASA Apollo 15 surface photographs (ALSJ image library) … no third-party model files … Simplified, approximate geometry." Also in DECISIONS #17 and the `hadley-props.js` header. Art bible §5: "Procedural (this project)". **Not stated in-app**: the LM/LRV tooltips carry no "simplified" note. | minor |
| Crew not presented as Scott/Irwin | ✓ No names, the art bible §1 and DECISIONS #18 say so explicitly. | — |
| Unlabelled simplifications in motion | Earth spin about 200× time-lapse; LRV drives with nobody aboard (see motion review M-3/M-4) | minor |

## Attribution

- ATTRIBUTION.md rows 8–13 cover the three Poly Haven moon rocks (CC0, authors, URLs, retrieval date 2026-10-28, conversion changes) and Michroma, IBM Plex Sans and IBM Plex Mono (SIL OFL 1.1). Row 14 covers the procedural props. ✓
- `public/attribution.json` is byte-identical to the one in the build (`tmp/review-build/attribution.json`, 14 entries). ✓
- **Field misalignment in attribution.json** (pre-existing since v1, carried into v2): `scripts/build-attribution.mjs:16` destructures `[asset, author, source, license, date, changes] = cells`. The first cell is the row number, so every key is shifted one place. `asset` holds "1", `author` holds the asset name, `source` holds the author, `license` holds the URL, `retrieved` holds the licence and `changes` holds the date. For example, the Michroma entry reads `"license": "https://fonts.google.com/specimen/Michroma", "retrieved": "SIL OFL 1.1"`. Every value is present, but a machine reader (showcase) gets the wrong licence field. **Major** for a release artefact. Fix: `const [num, asset, author, source, license, date, changes] = cells;` and emit `{ id: num, asset, author, source, license, retrieved: date, changes }`. Then rerun the script.
- The fonts' licence text (OFL requires the licence to accompany the font when redistributed) does not ship. The `@fontsource` packages contain it, but `dist/` only has the WOFF2 files. Minor: add `public/fonts/OFL.txt` or link it in ATTRIBUTION.

## New facts in content

`git diff b4b30f8..HEAD -- content research` is empty, so no learning content changed in v2. The new in-app text is only the tooltips ("No air: it never flutters", which is correct, plus boulder heights computed from the placed model) and the prop dimensions in code comments (LRV 3.1 m, 2.06 m track, 0.82 m wheels; LM about 9.4 m across the pads). These match the published LRV/LM figures I know of, but they are not listed in `research/apollo15-facts.md`. They are not shown to learners, so minor/none.

## Poster alt

`public/showcase.json` alt: "A suited crew member and a gold-foil Lunar Module descent stage on the grey plain at the Apollo 15 Hadley site, rebuilt from NASA terrain data, with a lunar rover nearby, boulders casting long morning shadows and a black, star-dotted sky." Compared with `poster-2.0.0.jpg`: crew member ✓, gold LM ✓, rover (with dust) ✓, boulders ✓, black starry sky ✓, plus a flag that is not mentioned. "Long morning shadows" overstates it, because the shadows in the frame are short. "Rebuilt from NASA terrain data" sits next to the LM and could suggest that the LM is reconstructed. Suggested alt: "A suited crew member walks past a simplified gold-foil Lunar Module descent stage on the real NASA terrain of the Apollo 15 Hadley site, with a flag, a lunar rover kicking up dust, boulders and a black, star-dotted sky." Minor.

## Findings

| ID | Finding | Severity | Fix |
|---|---|---|---|
| H-1 | Collapsed drawer: serious axe contrast plus invisible focusable controls | major | `src/v2/cinematic-grade.js:426-431` (`inert`); add a scan to `tests/a11y.spec.js` |
| H-2 | `attribution.json` keys shifted by one (licence under `retrieved`, etc.) | major | `scripts/build-attribution.mjs:16-24` |
| H-3 | No in-app "simplified model" note on LM/LRV tooltips | minor | `src/app.js:165-166` |
| H-4 | Orange ring 1.2:1 on sunlit regolith | minor | `src/app.js:175-180` (add a dark outer ring) |
| H-5 | Art bible says dark HUD surfaces; the build ships light cards | minor | `design/art-bible.md` §2 or `src/v2/hud-shell.css` |
| H-6 | OFL licence text not shipped with the fonts | minor | `public/fonts/OFL.txt` |
| H-7 | Poster alt overstates shadows; LM could read as a reconstruction | minor | `public/showcase.json:22` |
