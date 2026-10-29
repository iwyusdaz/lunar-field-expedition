# Status — lunar-field-expedition

Last updated: 2026-10-29

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
