# Agent review: accessibility

Reviewer: separate AI agent. Method: code reading plus headless Playwright probes on the production build (port 4191). No screen reader was used; nothing here substitutes for testing with assistive-technology users. Frameworks: Game Accessibility Guidelines (GAG), Xbox Accessibility Guidelines (XAG) categories, WCAG 2.1 AA for the HTML overlay.

## Text-mode parity spot-check (3 objectives, end to end)

| Objective | Text-mode path | Result |
|---|---|---|
| 2: sun angle | M2 text: two hillshade orthoimages (12° / 55°) with alt text and an annotation list | Pass. Equivalent content. Annotation markers (◈) are `title`-only, but the list below repeats them. |
| 3: relative age | M3 text: crater tables + superposition item + method note | Pass on content. The method note is always visible, so the "discover the disagreement" beat from the 3D flow is lost (minor). |
| 5: CER report | M5 text: evidence board + `_renderCerBuilder` + post-check | Fail (A1, A2). |

## Findings

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| A1 | critical | app.js:619 (with text-mode M4, app.js:1017-1022) | The text-mode planner has no `onPlanned`/`onDebrief`, so `this.plan` is never set. The text-mode CER builder always uses `h-front` and its required tags, even if the learner chose the rille hypothesis in text mode. They can't complete the report for their own question. | Pass `onPlanned: p => this.plan = p` in `_textM4`, and share hypothesis state through `AppState`. |
| A2 | critical | app.js:1046 → 690 | Saving the text-mode report calls `this._stepDone({id:'m5-cer-text'})`. That increments `stepPtr` and re-renders the hidden 3D task panel to the next step, and logs a phantom step. The text-mode pre-check/post-check (app.js:878) never stores `state.preCheck`/`postCheck`, so text-mode completion isn't recorded the way the 3D flow records it. | Give text mode its own completion handler that writes the same state keys as the 3D steps. |
| A3 | major | `textmode-m2.png`; shell.js:103-110 | Turning on text mode hides only the canvas. The 3D `#task-panel` and POI list stay on top of the text-mode content (z-index 6 vs auto), cover the orthoimage, and stay in the Tab order. Two copies of the same questions are reachable. | Hide `#task-panel`, `#poi-wrap` and `#cinematic-host` (or make them `inert`) while text mode is on. |
| A4 | major | text-mode.js:37-38 | The text-mode `<h2 class="textmode-title">` is always empty: no module calls `setTitle`. Probe: `h2 = ""`. An empty heading breaks heading navigation (WCAG 1.3.1, 2.4.6). | Set the title to the module title in `show()`. |
| A5 | major | app.js:232-247 | After "Continue", the clicked button is removed and focus drops to `<body>`. The new step isn't focused or announced, so keyboard and SR users lose their place on every step (WCAG 2.4.3). | Focus the new step's first heading or paragraph (`tabindex=-1`) in `_nextStep`, and announce the step. |
| A6 | major | assess.js:20-22 | `role="radiogroup"` wraps plain `<button>`s (not `role=radio`): invalid ARIA semantics for every pre/post item (WCAG 4.1.2). | Remove the role (buttons in a labelled group are fine) or use real radios as in `choiceItem`. |
| A7 | critical | crater-counter.js:76, 94 | Patch rings and in-patch hit tests use `p.center.lon/lat`, which don't exist (craters.json has `center.xM/yM`). The rings don't render, and every click counts. Low-vision users get no visible target area at all. | See visual V4. |
| A8 | major | app.js:379-380 | POI "Mare patch / Front patch" sends the camera to NaN (black screen, `m3-mare-patch.png`). The keyboard alternative for finding the patches is broken. | Pass `center.xM/yM` to `_flyTo`. |
| A9 | major | hadley-site.js:178 | Feature pins are 6 m cones, invisible at the default 1400 m camera distance. The task text "marked with pins" can't be followed visually (GAG: "ensure interactive elements are large/clear"). | Use screen-size markers with text labels. |
| A10 | major | settings.js:85-90 | The settings expose captions, mute and three volume sliders that do nothing (no audio, `captions` is never read). This misinforms users who rely on captions. | Remove them or implement them. |
| A11 | minor | shot-player.js:71-77 | Starting the cinematic doesn't move focus to "Skip cinematic (Esc)". Focus stays on the covered Play button. | Focus the skip button on play, and restore on done. |
| A12 | minor | crater-counter.js:41-43 | `role=tab` buttons with no `tabpanel`, `aria-controls` or arrow-key handling (ARIA APG). | Use `aria-pressed` toggle buttons instead. |
| A13 | minor | traverse.js:51, 166-167 | The map canvas has an aria-label, but its station labels are 9 px #111 text on grey hillshade (contrast well below 4.5:1, WCAG 1.4.3). The real-route vs learner-route distinction relies on dashed white vs solid yellow; the legend is only in the debrief text. | Larger haloed labels, and a legend next to the map that names the line styles. |
| A14 | minor | sun-tool.js:42-43 | The azimuth slider has no help text and no compass words ("90° = east"). | Add a direction name to the output. |
| A15 | minor | shot-player.js:100 | Reduced-motion stills auto-advance at 4.2 s with no pause (GAG "allow the player to control the pace"; WCAG 2.2.2 for auto-updating content). | Manual "Next" in reduced-motion mode. |
| A16 | minor | style; `menu-m1-globe.png` | Under OS light mode, the overlays are white panels over a black 3D scene: high glare, a photosensitivity/comfort concern for low-vision users. | Use a dark overlay theme over the canvas. |

## Checklist summary

| Item | Status |
|---|---|
| Keyboard-only operation of every tool | Sun, profile presets, crater controls, planner, CER: native controls (pass). Crater marking: pointer only, documented, with a text-mode equivalent (pass with gap). Focus management after steps: fail (A5). |
| Points-of-interest list | Present. Patch entries broken (A8). |
| Pointer alternatives | Camera buttons and arrow keys (pass). |
| Live announcements | `announce()` used for tools and module status (pass). |
| Reduced motion | Follows the OS plus a toggle; stills verified (pass). No pace control (A15). |
| No color-only cues | Feedback has a text prefix (pass). Map lines: concern (A13). |
| Pause | No real-time timers (pass). Cinematic has no pause, only skip (minor). |
| Captions | Present. Not synced, and the toggle is fake (A10). |
