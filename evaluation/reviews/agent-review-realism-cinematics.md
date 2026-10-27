# Agent review: realism matrix and cinematic budget

Reviewer: separate AI agent. Sources: `design/realism-matrix.md`, `design/shot-list.md`, `content/cinematics.json`, `src/cinematics/shot-player.js`, `src/app.js`, and screenshots in `screenshots/`.

## Cinematic budget check

| Rule | Result | Evidence |
|---|---|---|
| Total ≤ 90 s | Pass, 60 s (25 + 15 + 20) | cinematics.json:20, 35, 46 |
| Each shot ≤ 25 s | Pass | same |
| Purpose tags | Pass: orient / reveal / motivate. The progress line shows "purpose: orient" to the learner | shot-player.js:83 |
| Skippable from the first frame | Pass. Skip button plus Esc (shot-player.js:52-61), and a "Skip — go straight to the brief" choice before playing (app.js:316) | `m1-cinematic-s1.png` |
| Captions | Partial, see C2 and C3 | |
| Reduced-motion version | Pass. Stills with their own captions; verified with `reducedMotion: 'reduce'` ("Show the approach (stills)", caption "High over the Apennine Front at low Sun.") | `m1-cinematic-reduced-motion.png` |
| Never during assessment | Concern, see C4 | |

## Findings

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| C1 | major | app.js:769; `m1-cinematic-s1.png` | The task panel isn't hidden during playback (DOM: `hidden=false`, `display:block`). Captions print over the Play/Skip buttons and the bottom third of the shot is covered. | Use a CSS rule `#task-panel[hidden]{display:none}`. |
| C2 | major | shot-player.js:84 | All captions for a shot are joined and shown for the full shot (25 s for s1). The s1 caption names "the winding line is Hadley Rille. The pin is your landing site" while the camera is still over the mountains. Captions aren't synced to the visuals. | Add per-caption `at` times in cinematics.json and swap captions on progress. |
| C3 | major | settings.js:86, 118 | "Captions on" and three volume sliders do nothing. There is no audio and nothing reads `state.captions`. Misleading settings. | Remove the audio controls and the captions toggle (captions are always on), or wire them up. |
| C4 | minor | app.js:747-750 | "Replay the intro cinematic" in the Menu works from any module, including during the pre-check and post-check steps. It also switches the scene to the site in M1 without restoring the globe. | Disable replay while `currentStep.kind === 'check'`, and restore the scene in `onDone`. |
| C5 | minor | shot-player.js:100 | Reduced-motion stills auto-advance every 4.2 s with no pause or next control. That's learner control, and fast for a 2-sentence caption at a grade-9 reading level. | Add "Next still" and "Pause" buttons. Advance on click when reduced motion is on. |
| C6 | minor | shot-player.js (no focus move) | After pressing Play, focus stays on the covered "Play the approach" button. A keyboard user has to discover Esc or Tab to the skip button. | Focus the skip button when playback starts, and restore focus on done. |
| C7 | minor | cinematics.json:39 | s2 says "The Sun sinks toward the horizon", but the sweep goes from noon to "near sunrise" and the caption then cites sunrise. Sinking implies evening, which is confusing for the sun-angle objective. | Say "Watch what happens as the Sun gets lower". |
| C8 | major (honesty) | cinematics.json:52 | "Scott and Irwin drove 27 kilometres in three days" isn't in `research/apollo15-facts.md`. It's an unlogged fact in learner-facing content. | Add it to the log with a source (NASA history article), or remove the number. |
| C9 | minor | cinematics.json:28 | "exactly where Apollo 15 landed": fine. But M1 globe text "still the only landing next to a deep mountain front and a sinuous rille" (modules.json:21) is an unlogged superlative. | Log it or soften it ("the only Apollo landing beside a sinuous rille"). |

## Realism matrix audit

| Element | Serves a cue? | Finding |
|---|---|---|
| Terrain DTM, no exaggeration | Yes | Pass. Shape is the evidence. |
| Sun + hard shadows | Yes, in principle | R1 (major): on Medium and above, shadows are the cue, but the headless capture rendered blank (see visual V1). On Low (`shadowMapSize: 0`, quality.js:11) there are no cast shadows at all, so the "low sun reveals relief" cue depends on normal-map shading only. Phones, which default to Low, lose the core objective-2 cue. Fix: keep a cheap 1024 shadow map on Low, or bake hillshade into the Low albedo. |
| Albedo + "procedural regolith detail" | Partly | R2 (minor): no procedural detail exists. terrain.js:143-160 uses only the WAC albedo and normal maps. Correct the matrix. |
| Stars | No | Pass (dimmed). |
| Earth | No | R3 (minor): research log line 82 says "the app labels this 'approximate'". There is no in-app label; the word only appears in a code comment (hadley-site.js:16). Add a POI/tooltip label or correct the log. |
| Sun disc | No (decorative) | R4 (minor): missing from the matrix, and about 5× too large (700 m sprite at 14 km ≈ 2.9° vs 0.53°). |
| Scale cues | Missing | R5 (major): the crater task asks for "about 80 m or larger", but the 3D scene has no scale bar, grid or reference circle. A high-realism scene without scale fails the task cue. Add an 80 m reference ring at the cursor or a scale bar in the counter. |
| Markers/patch rings | Needed cue | R6 (critical): feature pins are sub-pixel (6 m cones at 1400 m) and the patch rings are drawn at NaN (crater-counter.js:76, using `p.center.lon`, which doesn't exist). The cues that tie text to terrain are missing. |
