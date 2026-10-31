# Changelog — lunar-field-expedition
## 3.0.0 — unreleased (plan 10 "scene-first revamp"; awaiting reviews and owner approval)
- Scene-first shell from the v3 template: one 56 px top bar with a module stepper, a short Now card (at most 60 words) with one action, a drawer for the planner, notebook, report, rubric and readings, a discovery journal, a controls sheet with a legend.
- Orbit view (true-size Moon, real stars, time-lapse lunar day) for the title and Module 1; the Hadley surface streams after the first click: the whole Apennine Front, Mons Hadley and Hadley Delta from 3D Tiles (NAC 5 m near, SLDEM2015 80 m far, curvature applied), regolith detail at three scales, SunLight cascades, the Ektachrome LUT.
- Airless sky at true scale: BSC5P stars that never twinkle and show only when the view is not dazzled; the Sun disc; Earth at 1.9° with its correct phase, a time-lapse spin and clouds; the field team's orbiter passing (time-compressed).
- Living site: rover driving with ballistic dust and a TV camera panning, two suited geologists (lope with a flight phase, sampling), a sample bag swinging at lunar gravity, bootstep dust, micrometeoroid flashes (frequency illustrative), the Sun sweeping shadows in time-lapse. No twinkle, no meteor streaks, no flag flutter.
- 35 clickable catalog objects (ALSEP instruments, LM, rover, flag, crew, boulders, bootprints, tracks, sample bag, Genesis Rock at Spur, rille, Front, mare, craters, massifs, horizon, Earth, Sun, stars, orbiter, impact area; Moon, Mare Imbrium and terminator in orbit). Labels hidden at rest.
- Typography: Jost (display) + IBM Plex Sans (body), S0 pair A.
- Modules keep the v2 learning content and step ids; four check items reworded shorter; Module 3 has a short intro step.

## 2.0.0 — 2026-10-29 ("Hasselblad at Hadley")
- v2 agent-review revisions (R-11 to R-19 in DECISIONS.md):
  - faceted black-and-amber LM with splayed legs and footpads; orange LRV fenders and wire-mesh wheels
  - reduced-motion ring jumps no longer snap the camera back
  - corrected licence column in attribution.json
  - hover tooltips are off while the crater counter or profile tool owns the pointer; the collapsed drawer is unreachable by Tab
  - dust dims in calm mode and hides under reduced motion
  - honesty labels on the sped-up Earth and the illustrative crew and rover motion
  - dark halo on the orange rings (about 6:1)
  - anisotropic filtering removes the close-range terrain streaks
- Posters and trailer re-recorded from the revised scene. Headed Apple M1: Medium 60 fps, 186 draw calls, 6.7 MB before first interaction.
- Living Hadley site layered on the unchanged LROC terrain: 12 Poly Haven CC0 boulders (moon_rock_01–03) grounded on the rendered mesh; procedural Lunar Module descent stage at the real landing site, Lunar Roving Vehicle with turning wheels, and flag, each merged per material.
- Two suited crew (future-mission field team, fictional): one idles at the LM, one walks a short path to a viewpoint, points at the Apennine Front and walks back.
- Ambient life: Earth turns slowly, the rover drives a loop throwing ballistic dust (lunar gravity, no drift), crew breathe and shift. No star twinkle, no flag flutter, no audio. Calm mode (~30 % speed) during module tasks; reduced motion stops all of it.
- In-world interaction: NASA-orange viewpoint rings at two landing-site close-ups and every station, with camera glide; hover highlight + IBM Plex Mono tooltip on the LM, rover, flag, crew and boulders; WASD pans the view (arrows/drag still orbit). Crater marking, the sun slider, the traverse and the evidence board are unchanged; in-world clicks pause while the crater counter or profile tool own the canvas.
- v2 look: AgX tone mapping with the case exposure; black sky kept (no dome, no fog); sun shadow frustum shrinks near the ground for crisp prop shadows.
- Typography: self-hosted Michroma / IBM Plex Sans / IBM Plex Mono (SIL OFL 1.1), header Plain-font toggle; floating-HUD drawer toggle (Hide panel). Art bible in design/art-bible.md.
- Posters re-rendered from the v2 scene (poster-2.0.0.webp/.jpg) with a blank-frame retry; 1.0.0 posters removed.
- New unit tests for the hero props (scale, merge budget, separate wheels, ballistic dust) and the shared v2 core modules.

## 1.0.0 — 2026-10-27
- Five modules: arrival, reading the landscape, which is older, field traverse, field report.
- Terrain from the LROC NAC DTM of the Apollo 15 site, validated against published relief; global Moon from the NASA SVS CGI Moon Kit.
- Tools: sun angle, elevation profile, crater counter, traverse planner; evidence board and CER builder with rubric and exemplar; comparison with the real Apollo 15 traverse.
- Text mode for all five modules.
- Earth texture switched to NASA Blue Marble; unused decoders removed; poster alt text corrected; attribution regenerated on every build.
