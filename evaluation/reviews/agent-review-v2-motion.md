# Agent review — v2.0.0 motion load (ambient life, calm mode, reduced motion)

Agent review (automated reviewer). Date: 2026-10-29. Build `main @ 0e64a47`, test build, headless Chromium with SwiftShader. I sampled object transforms from `window.__TEST__.app.site` every 100–120 ms over about 3 s per condition. Frame rate under software rendering is low and uneven, so the rates below are per wall-clock second and only approximate.

## Ambient systems actually running (calm off, Module 2 site)

| System | Measured | Live? |
|---|---|---|
| Earth rotation | 0.015 rad/s (about one turn every 7 min) | ✓ |
| Rover on its loop around the LM | 1.3 m/s along the spline, following the mesh height | ✓ |
| Rover wheels turning | 4.2 rad/s | ✓ |
| Ballistic rover dust (1.62 m/s²) | 32–46 live grains | ✓ |
| Crew B walk → point → walk back | 0.5 m/s, phase cycle walk/point/rest | ✓ |
| Crew breathing (spine scale) | range 0.016 | ✓ |
| Crew gaze / head drift (crew A looks at the camera while idle) | head yaw range 0.04–0.05 rad | ✓ |
| Blinking | present in code (eyelids hidden under the helmet visor, so not visible) | n/a |

That makes 7 systems live, well above the brief's "≥ 3" and §8's "≥ 5". "Is it alive" check: three frames 0.7 s apart in a landing-site view (`v2-alive-frame-0..2.png`) differ by 3 658 and 3 899 pixels (ImageMagick AE, fuzz 5 %). Motion outside calm is non-zero.

## Calm mode during module tasks

`_syncWorldForStep` turns calm on for every step except brief / cinematic / debrief / globe. Observed: calm on in `m2-sun` and `m4-traverse-plan`, off in `m3-debrief`. With calm on, `calmFactor` settles at 0.30 within about 0.35 s:

| | full | calm | ratio |
|---|---|---|---|
| Rover speed | 1.31 m/s | 0.56 m/s | 0.43 (slower settle plus frame jitter; target 0.30) |
| Wheel spin | 4.19 rad/s | 1.78 rad/s | 0.42 |
| Earth spin | 0.0149 | 0.0063 | 0.42 |
| Crew B walk | 0.51 m/s | 0.21 m/s | 0.41 |
| Breathing range | 0.016 | 0.001 | slower sine, so a smaller range inside a 3 s window |

Calm slows things down and freezes nothing, which matches locked decision 1. Ring pulses also scale with calm. One gap: **the dust is not dimmed in calm**. Its opacity stays at 0.75, and grains live longer because they fall on `effDt` (46 vs 33 live). The core plan says "dim particles". Minor.

## Reduced motion

I tested it both ways: the OS preference (`reducedMotion: 'reduce'` context) and the Settings toggle at runtime (`motion.setToggle(true)`).

- Runtime toggle: within 1.5 s and over the next 3 s, Earth, rover, wheels, crew B walk, **breathing and gaze are all exactly 0**. That confirms the v2 core patch: `AmbientLifeManager.update` skips characters when `reducedMotion` is set, and `stylized-character.update` freezes at `calmFactor <= 0`. Ring pulses stop, and glides become instant jumps.
- OS preference at load: everything was 0 on a second run, both early (0.5 s) and late. On the first run, rover and crew B shifted 0.1–0.3 m once during the 3 s window. That is consistent with re-grounding after a quality-preset change (`_groundAll`), not with animation, but I could not confirm the cause.
- Bug: **dust grains freeze in mid-air** when reduced motion is switched on while the rover is throwing dust. `update` returns before the custom updaters, so 39 grains stay suspended above the ground. They look like floating specks, which contradicts the "nothing floating" goal. Minor. Fix: in `src/scenes/hadley-site.js` `setReducedMotion(on)`, clear the dust buffer (set every `pos[i*3+1] = -1e6`), or have `createDustBurst` expose `clear()`.
- See interaction report I-3: under reduced motion the instant ring jump is undone by the next orbit input. That is a real usability bug for this audience.

## Does the rover or dust distract during the tasks?

- **Crater count (M3)**: the mare patch centre is about 655 m from the LM, and the counting view frames the patch from about 900 m. In `v2-m3-crater-marked.png` the rover loop is not visible at all. No distraction. The only competing element is the hover tooltip (I-1).
- **Sun angle (M2)**: the default view is 1.4 km out. The rover is 1–2 px and the dust is invisible (`v2-m2-site-default.png`). Shadows sweeping the terrain dominate. No distraction. If the learner glides to the landing site during `m2-sun`, the rover loop at calm speed (about 0.7 m/s) is in frame next to the boulder shadows. That is acceptable, and arguably it reinforces the shadow-length cue (the rover casts a moving shadow).
- **Honesty and plausibility note (planetary-geologist persona)**: the LRV drives an endless loop **with nobody aboard** while both crew are on foot. The real LRV had no remote driving (only the TV camera was ground-controlled). For a fictional future mission a teleoperated rover is plausible, but nothing says so. Minor. Either seat a crew member or add "(teleoperated, fictional mission)" to the rover tooltip at `src/app.js:166`.
- The Earth spin is time-lapsed about 200× (one turn every ~7 min instead of 24 h) and this is not labelled. The scene note covers only "position approximate". Minor. Either slow the spin to near-imperceptible or extend the note ("rotation sped up").

## Findings

| ID | Finding | Severity | Fix |
|---|---|---|---|
| M-1 | Dust not dimmed in calm mode | minor | `src/scenes/hadley-props.js:230` / updater in `hadley-site.js:321` — scale `points.material.opacity` by `calmFactor` (third updater arg) |
| M-2 | Dust frozen in mid-air under reduced motion | minor | `src/scenes/hadley-site.js:423` — clear dust in `setReducedMotion(true)` |
| M-3 | Unmanned LRV driving loop not explained | minor | `src/app.js:166` tooltip wording |
| M-4 | Earth spin time-lapsed, not labelled | minor | `src/scenes/hadley-site.js:311` amplitude, or the scene note at `src/app.js:280` |
| (I-3) | Reduced-motion ring jump undone by orbit (see interaction review) | major | `src/app.js:118-125` |
