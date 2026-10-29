# Changelog — lunar-field-expedition

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
