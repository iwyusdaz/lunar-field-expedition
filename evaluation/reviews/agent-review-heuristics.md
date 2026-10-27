# Agent review: heuristic evaluation

Reviewer: separate AI agent. Method: Nielsen's 10 heuristics plus game-playability heuristics, applied to the production build (headless probes) and the source. Ratings: pass / concern / fail, for 3D UI and text mode.

## Ratings

| Heuristic | 3D UI | Text mode | Key evidence |
|---|---|---|---|
| H1 Visibility of system status | concern | concern | Module status HUD and planner meters work well. No step counter inside a module. Crater rings invisible (H-3). |
| H2 Match with the real world | pass | pass | Field-geology vocabulary, real station names, EVA framing. Raw tag ids leak into the CER checklist (H-7). |
| H3 User control and freedom | fail | concern | M4 skip is a dead end (H-1). Restart clears every module's evidence (H-8). No way back to an earlier step. |
| H4 Consistency and standards | concern | concern | `role=tablist`/`radiogroup` misuse. Hypothesis chosen twice (M4 step 1 and again in the planner). "Restart module" restarts everything. |
| H5 Error prevention | fail | concern | Skip button available before planning (H-1). POI patch flight to NaN (H-2). |
| H6 Recognition over recall | concern | pass | Feature pins invisible, so "marked with pins" depends on POI names (H-4). |
| H7 Flexibility and efficiency | pass | pass | POI list, presets, keyboard orbit, text mode. |
| H8 Aesthetic, minimalist design | concern | concern | Task panel up to 62vh covers the evidence (the terrain). Non-functional audio settings. |
| H9 Recognize, diagnose, recover from errors | concern | concern | CER "Evidence types not yet cited: superposition-or-count" lists raw ids with no path to fix them when the board is empty. |
| H10 Help and documentation | concern | concern | No in-app help or glossary (rille, mare, breccia, Ga). |
| P1 Clear goals | pass | pass | The mission brief poses one question, and every module shows its core question. |
| P2 Feedback | pass | concern | "Why" feedback on every option is strong. Text-mode answers append feedback at the end of `body`, far from the item (H-9). |
| P3 Challenge/skill balance | concern | concern | The EVA budget rarely binds (H-6). Feature tagging allows unlimited retries. |
| P4 No unnecessary friction | concern | concern | Two Continue buttons in M4 (H-1). Pre-check items must be answered sequentially before the next renders (fine), but there's no review. |

## Findings

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| H-1 | critical | app.js:427 | The traverse-plan step always renders a "Continue to the field report" button next to the planner. Clicking it before planning marks M4 complete. Reopening M4 shows only "Module complete" (verified), the M5 evidence board has no traverse evidence, and the CER save is blocked by missing tags. The learner can't finish. | Remove the line-427 button (onDebrief already adds one). Let completed modules be replayed ("Redo this module"). |
| H-2 | critical | app.js:379-380, 834 | POI "Mare patch / Front patch" passes a patch object without `xM`/`lon`. The camera target becomes NaN and the screen goes black (`screenshots/m3-mare-patch.png`). | Pass `p.center`. |
| H-3 | critical | crater-counter.js:76, 94 | Patch rings use the nonexistent `center.lon/lat`. No visible patch, and every click is accepted as "inside". The core objective-3 activity has no target. | Use `centerLonLat` or `center.xM/yM`. Add a test. |
| H-4 | major | hadley-site.js:178 | 6 m marker cones are invisible at 1400 m camera distance. | Screen-space labelled markers. |
| H-5 | major | settings.js:85-90 | Captions/mute/volume controls do nothing. | Remove them. |
| H-6 | major | stations.json:7-13 | The 200 min budget fits almost any route: LM→Dune→Front→Spur takes 75 min, and 4 Front-side stations take 193 min (probe). The resource trade-off in objective 4 seldom forces a choice. The default tool is the first listed (usually Photograph, traverse.js:211-215), so a learner may "drive" with no samples and not notice. | Lower the budget (about 120 min), or make sample time realistic. Default to "choose a tool" with no preselection. |
| H-7 | major | app.js:626-634 | The CER citation checklist shows raw tag ids ("superposition-or-count", "mare-profile", "age-contrast"), not the evidence items the learner collected. | List the board items with readable labels, and map tags internally. |
| H-8 | major | app.js:172-177; shell.js:46 | "Restart module" calls `state.reset()` and `board.clear()`: the whole course and all evidence are wiped, with no confirmation. | Rename it to "Restart expedition" with a confirm dialog, or make it module-scoped. |
| H-9 | minor | app.js:886-889 | Text-mode feedback is appended to the bottom of the module body, not under the answered item. After 5 items, the feedback for item 1 appears after item 5. | Append inside the item's fieldset. |
| H-10 | minor | modules.json:55; traverse.js:54-58 | The hypothesis step ("Choose the question") has no choice. The choice is inside the planner, defaulted to h-front. | Merge the two, or put the radios in the hypothesis step with no default. |
| H-11 | minor | app.js:476-506 | Pre-check items render one after another without a "question n of 5". | Add progress. |
| H-12 | minor | none | No glossary for rille, mare, breccia, anorthosite, Ga. | Add an inline `<abbr>`/glossary popover. |
| H-13 | minor | app.js:585 | Duplicate `why` key in superposition option b (object literal), a code smell only. | Remove the duplicate. |
