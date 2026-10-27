# Agent review: visual quality

Reviewer: separate AI agent (did not build this repo). Date 2026-10-27. Build: `npm run build` (no test hooks), `vite preview` on port 4191, Playwright Chromium headless with SwiftShader (software GL), viewport 1440×900. I set presets through Settings > Graphics quality > Save, or by seeding `localStorage['lunar-field-expedition:quality']` for the retry runs. Screenshots are in `evaluation/reviews/screenshots/`.

Caveat: software rendering. Medium/High blank frames (V1) may be a SwiftShader limitation and not a product bug. The orchestrator's headed run should confirm them.

## Per-preset results

| Preset | Screenshot | Result |
|---|---|---|
| Menu / M1 globe | `menu-m1-globe.png` | Renders. Globe lit as a crescent, starfield, readable task panel. |
| Low | `site-m2-low.png`, `site-m2-lowsun-low.png` | Terrain renders (76k triangles). Regolith texture and craters are readable. |
| Medium | `site-m2-medium.png`, `site-m2-medium-retry.png` | Canvas black or blank (305k triangles submitted, context not lost). Console: "PCFSoftShadowMap has been removed. Using PCFShadowMap". |
| High | `site-m2-high.png`, `site-m2-lowsun-high.png` | Canvas blank. The page background shows through. |
| Ultra | `site-m2-ultra.png` | Canvas blank (1.21M triangles). |
| Cinematic (Low) | `m1-cinematic-s1.png`, `m1-cinematic-s2.png` | Renders. Captions overlap the task panel (see V2). |

## Findings

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| V1 | major (verify headed) | Medium/High/Ultra, M2 | Nothing draws whenever shadow maps are on (`shadowMapSize > 0`). Low has no shadows and renders fine. Either SwiftShader can't handle it or there is a real shadow-path bug (deprecated PCFSoft fallback, 3500 m light distance with a large frustum). | Re-check headed on each preset. Replace `PCFSoftShadowMap` with `PCFShadowMap`/`VSMShadowMap` explicitly. Add a test that reads canvas pixels per preset. |
| V2 | major | `m1-cinematic-s1.png` | During the cinematic the task panel stays visible: `stepEl.hidden = true` (src/app.js:769) has no effect. The DOM shows `hidden=false`, `display:block` while `player.playing=true`. Captions overprint the "Play the approach / Skip" buttons. | Hide the panel with a class that sets `display:none`, or add `#task-panel[hidden]{display:none}`, and find what resets it. |
| V3 | critical | `m3-mare-patch.png` | Selecting the POI "Mare patch (crater counting)" turns the screen black. `_flyTo(patches[0])` (src/app.js:379, 834) gets a patch object with no top-level `xM`/`lon`, so the camera target becomes NaN. | Pass `{xM: p.center.xM, yM: p.center.yM, radiusM: p.radiusM}`. |
| V4 | critical | M3 3D | The patch rings never appear. `CraterCounter._drawPatches` and `handleCanvasClick` call `fromLonLat(p.center.lon, p.center.lat)` (src/systems/crater-counter.js:76, 94), but `content/craters.json` has `center: {xM, yM}` and a separate `centerLonLat`. Result: NaN positions, and the check `NaN > radiusM` never fires, so a click anywhere counts as inside. | Use `p.centerLonLat`, or `p.center.xM/yM` directly. Add a unit test that patch centres resolve to finite numbers. |
| V5 | major | `m2-feature-tag.png` | The text says "Four landforms are marked with pins", but no pins are visible. The cones are 6 m (src/scenes/hadley-site.js:178, `size = 6`) and the camera radius is 1400 m, so each is under one pixel. | Scale marker size with camera distance, or use HTML labels/sprites with `sizeAttenuation:false`. |
| V6 | major | all site modules | The task panel takes up to 62vh (src/styles/site.css:179) in the bottom-centre. Most of the terrain the learner is asked to read sits behind it (`site-m2-low.png`). | Use a collapsible side panel (≤ 30rem) on desktop, or a "hide panel" toggle. |
| V7 | major | `textmode-m2.png` | In text mode, the 3D task panel and the POI list render on top of the text-mode content (z-index 6 vs `auto`). The orthoimage sits under the panel. | Hide `#task-panel` and `#poi-wrap` while text mode is on (`Shell.toggleTextMode`). |
| V8 | minor | `m1-cinematic-s1.png` | The cropped DTM reads as a floating slab with hard edges in a black void during the approach. That breaks the "landing on a plain" read. | Add a low-res skirt or global-moon backdrop, or keep the camera path inside the AOI. |
| V9 | minor | `m4-planner-panel.png` | Map labels are 9 px `#111` on mid-grey hillshade, and they show raw ids ("rille9a", "lm"). Illegible. | Use 12 px+ with a halo, and use the station names (`mapLabel`) from content. |
| V10 | minor | `m2-feature-tag.png` | The POI box overlaps the status HUD (right end) and the top of the task panel. | Reserve a right column, or place the POI list in the panel. |
| V11 | minor | all | With OS light mode (the headless default), the overlays turn white over a black lunar scene. That's glare, and it contradicts the "dark cinematic default". | Force the dark theme over the canvas, or style overlays independently of `prefers-color-scheme`. |
| V12 | minor | src/core/quality.js:30-49 | High/Ultra advertise AO and bloom (`post: [... 'ao']`, `aoEnabled`), but `postprocessing`/`n8ao` are never imported. High differs from Medium only in label. `vegetationDensity` is a template leftover. | Remove the unused fields and deps, or implement them. Make the labels honest. |
| V13 | minor | src/ui/settings.js:115 | Choosing "Medium" when auto-select already picked Medium isn't saved (`v !== this.quality.name`), and `auto` stays true, so the 20 s auto-benchmark can still override the user's explicit choice. Seen as `stored=null` for medium. | Always call `quality.set(v)` on save. |
| V14 | minor | src/scenes/hadley-site.js:109 | The sun sprite is 700 m at 14 km, about 2.9°, roughly 5× the real 0.53°. | Scale to about 130 m, or document it as a visibility aid. |
