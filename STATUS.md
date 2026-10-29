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
| Unit + browser + sub-path tests | see the latest commit message / CHANGELOG |
| Draw calls (Module 2 site view, Medium, headless software WebGL) | 196 (budget ≤ 300) |
| Headed GPU fps on Medium | pending |
| Agent reviews of v2 + ≥ 5 revisions, trailer re-record | pending |
| Tag v2.0.0 + showcase pin | pending (not tagged in this run) |

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
