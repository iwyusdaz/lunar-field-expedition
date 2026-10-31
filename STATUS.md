# Status — lunar-field-expedition

Last updated: 2026-10-31

## v3.0.0 (plan 10) — S5 pass 2 (review fixes) done, reviews pending
Agent work. No human review or learner testing has happened; owner visual approval is still to come (plan §8).
| Item (plan §11) | Status |
|---|---|
| S0 owner direction (font pair, layout, reference board, object list) | done 2026-10-30 — `design/art-bible.md` |
| S4 assets (terrain tiles, textures, models, sky data, LUT, catalog) | done 2026-10-31 — `npm run check:v3-assets` |
| Scene-first shell, type tokens, Now card, drawer, journal, camera rig, onboarding (template v3 synced) | done — `src/v3/` (sync record `src/v3/.sync-record.json`), repo code in `src/lunar/` |
| S5 review pass 1 findings F1-F27 (`.agents/tasks/immersive-v3/s5-lunar-field-expedition/review.md`) | fixed in `37a29a2` and follow-ups (DECISIONS #46-#53): orbit globe geography, card hold, LM and LRV rebuilt, authored inspect views, practice cue, Module 1 action, crater-count visibility and loading state, clocks question, report evidence labels, drawers |
| All §7 gates, pass 2 (19 states incl. six drawer states, F12) | 2026-10-31 at `8d81875` — `evaluation/results/ui-audit-2026-10-31.json` (ui-audit 1.1.3): every gate passes except two cells at 1440×900: alive in `sky-overhead` (2 of 3 regions; 6-7 at the other viewports) and GPU p95 14.08 ms in `drawer-board` (10.98 ms in an earlier run on this branch). Max 289 draw calls, 1.39 M triangles, ≥ 60 fps, 2.96 MB before first interaction. Not yet resolved; recorded for the reviewers |
| All §7 gates at 1440×900, 1280×720, 390×844, 844×390 in every module state (headed GPU, Apple M1), pass 1 | done 2026-10-31 at `87252ee` — `evaluation/results/ui-audit-2026-10-31.json` (ui-audit 1.1.2): PASS, 52 states; max GPU p95 8.61 ms in this run (earlier headed runs on this branch measured up to 11.5 ms: the M1 GPU clock varies between runs), ≥ 59.4 fps, max 241 draw calls, max 1.31 M triangles, 2.95 MB before first interaction at every viewport (12.4–16.1 MB streamed after) |
| ≥ 20 inspectable objects per main scene; catalog complete; journal by mouse, keyboard list and text mode | done — 32 surface objects + 3 orbit objects (35 catalog entries); reach gate passes |
| ≥ 8 motion systems, every motion accurate or labelled; calm mode and reduced motion | done — 13 systems over four layers (12 surface + the orbit day); `motion.checkLabels` passes; reduced-motion test passes |
| No abstract markers without a label and legend; no bare primitives | done — gates pass; legend in the controls sheet |
| Camera rig and onboarding on desktop and touch emulation | done — browser tests (touch tap, keyboard, practice); ui-audit phone viewports |
| Unit, browser, axe, keyboard-only completion, text-mode parity, reduced motion, sub-path, pass 2 | 2026-10-31 on the `37a29a2` tree: vitest 124/124, Playwright 12/12 (adds card hold, practice cue, clocks question in text mode); later commits re-ran vitest 124/124 and the card-hold and reduced-motion browser tests |
| Unit, browser, axe, keyboard-only completion, text-mode parity, reduced motion, sub-path, pass 1 | done 2026-10-31 at `3772f9e` — vitest 120/120; Playwright 11/11 with `npm run build && npm run test:e2e` (keyboard-only completion of all five modules, text-mode parity, reduced motion, touch tap, no-WebGL2, axe 0 critical/serious on 12 states, sub-path `/play/<slug>/` incl. the streamed surface) |
| LM descent stage and LRV detail (DECISIONS #25 handed to S5) | done — own work, `src/scenes/hadley-hardware.js` (DECISIONS #47) |
| Agent reviews (scene, learner) | pass 1 CHANGES_REQUESTED (27 findings); pass 2 pending; evidence in `.agents/tasks/immersive-v3/evidence/lunar-field-expedition/` |
| Owner visual approval, release, posters, trailer, showcase pin | pending (G1, S7) |

### v2 carry-overs
| v2 item | v3 status |
|---|---|
| Full ~4.6 km Apennine Front (v1 crop, DECISIONS #3) | done — streamed 3D Tiles (DECISIONS #23, #31) |
| Keyboard-only completion "partly" (crater marking needs a pointer) | done for the course: a browser test completes all five modules by keyboard alone. Marking individual craters in 3D still needs a pointer; by keyboard the counts are submitted and the text-mode size-frequency tables are the equivalent task. Re-deferred: keyboard crater marking (needs a keyboard cursor on the terrain; not in plan 10) |
| Low preset tested in phone emulation | re-deferred — ui-audit runs the phone viewports on Medium (the gate preset); Low is used by the headless browser tests only. No physical phone is available |
| Guidepup VoiceOver logs | re-deferred — macOS permission dialogs block it in this environment (unchanged since v1); axe and the accessibility tree are checked |
| Learner and real-device testing | not possible in this run (no learners, no phones); `evaluation/human-protocol/` templates unchanged |
| Captioned trailer, posters | to S7 (release) — the v2 trailer and posters show v2 |

## v2.0.0 ("Hasselblad at Hadley") — status

| Item | Status |
|---|---|
| Art bible, palette, three self-hosted fonts, Plain-font toggle | done — `design/art-bible.md`, `src/styles/case-fonts.css` |
| Living site on the unchanged LROC terrain (boulders, LM, rover, flag, two crew) | done — `src/scenes/hadley-site.js`, `src/scenes/hadley-props.js` |
| Ambient life (5 systems), calm mode during tasks, reduced motion stops it | done |
| In-world interaction (viewpoint rings + glide, hover tooltips, WASD pan) with crater marking / sun slider / traverse parity | done |
| Version bump, posters 2.0.0 from the real scene, showcase.json validates 2.0.0 | done |
| Unit + browser + sub-path tests | done 2026-10-29 — 76/76 unit (vitest), 12/12 functional + a11y (Playwright, test build), sub-path 1/1 (release build); gitleaks clean |
| Headed GPU performance (Apple M1, Module 2 site view) | done 2026-10-29 — Medium 60.1 fps, 186 draw calls (budget ≤ 300), 575k triangles; menu interactive 0.35 s; 6.7 MB before first interaction (`evaluation/results/perf-2026-10-29.json`) |
| "Is it alive" capture (two headed frames 5 s apart, LM viewpoint) | done — 3,836 pixels differ (fuzz 2 %) |
| Agent reviews of v2 + ≥ 5 revisions | done — four reports in `evaluation/reviews/agent-review-v2-*.md`; revisions R-11 to R-19 in DECISIONS.md (R-19: terrain streak fixed and checked headed on the GPU) |
| Trailer re-record and posters from the revised scene | done — `docs/trailer.webm` 57.5 s, 11.2 MB, captioned + VTT; `poster-2.0.0.webp/.jpg` re-rendered after R-15 (13.4 KB / 37.6 KB) |
| Tag v2.0.0 + showcase pin | done by the orchestrator (see CHANGELOG) |

## v1.0.0 status (kept for the record)

## Final Quality Checklist (plan 01 §14)

| Item | Status |
|---|---|
| Every objective appears in the alignment matrix, text mode and assessment | done — `design/alignment-matrix.md`; text-mode parity test covers all five modules |
| Terrain accuracy check logged | done — `evaluation/results/terrain-validation.json` (rille depth 284 m vs ~370 m published, within ±25%) |
| Every fact has a verified source | done — `research/apollo15-facts.md`; snippet-only and derived values are flagged and used only as approximate |
| Cinematic total ≤ 90 s, all skippable, captioned, reduced-motion versions exist | done — 60 s total; captions timed per shot (R-09); reduced-motion stills tested |
| Keyboard-only and text-mode completion pass | partly — text-mode completion tested; tools use native controls; marking individual craters in 3D needs a pointer (text-mode crater task is the equivalent) |
| Performance budgets pass on Medium; Low tested in emulation | done (headed, Apple M1, re-measured 2026-10-27 AFTER the revisions): 60 fps every preset; Medium 308k triangles, 2 draw calls; menu interactive 0.17 s; 5.64 MB before first interaction (`evaluation/results/perf-2026-10-27.json`). Low measured on the M1 only, not in phone emulation |
| Release v1.0.0 published with archive, checksum and showcase.json; sub-path test passes | partly — sub-path test passes; showcase.json validates; release not yet tagged |
| ATTRIBUTION.md covers all NASA/LROC/CC0 assets | done |
| README: play link, trailer, realism rationale, evaluation notice | partly — all except the trailer |

## Other required work
| Item | Status |
|---|---|
| Agent reviews (incl. earth-science teacher and planetary geologist personas) + ≥ 5 revisions | done — 7 agent review reports in `evaluation/reviews/`; 10 revisions (R-01 – R-10) logged in `DECISIONS.md` |
| Captioned trailer ≤ 60 s | pending |
| Guidepup VoiceOver logs | not possible in this run (macOS permission dialogs); accessibility-tree fallback used |
| Learner and real-device testing | not possible (no learners, no physical phones); templates in `evaluation/human-protocol/` |
