# Agent review — v2.0.0 visual realism, accuracy and cue salience

Agent review (automated reviewer, not a human expert). Date: 2026-10-29. Build: `main @ 0e64a47`, test build (`VITE_TEST_HOOKS=1`), served by `vite preview` on 127.0.0.1:4191.
Rendering caveat: every frame below is from headless Chromium with SwiftShader (software WebGL). Texture filtering, shadow-map precision and anti-aliasing differ from a GPU, so the fidelity verdicts here are cautious, and the terrain streak in particular may look worse than on a GPU.

Screenshots: `evaluation/reviews/screenshots/v2-*.png` (`v2-closeup-lm-crew`, `v2-closeup-rover`, `v2-closeup-flag`, `v2-site-mid`, `v2-terrain-streak-close`, `v2-m2-site-default`, `v2-m3-crater-marked`, `v2-hover-*`).

## 1. Is the Hadley site a living, detailed place?

Yes, at close range. Every claimed item is present: LM descent stage, LRV, flag, two suited crew and 12 Poly Haven boulders (`site.rocks.length === 12`). Measured in the browser:

- The LM is placed at lon 3.6333°, lat 26.13239°. That matches `research/apollo15-facts.md` and the station data.
- Grounding: I compared each prop's lowest vertex with the mesh height (`meshHeightAt`) under it. LM −0.05 m, rover 0.00, crew −0.01, rocks −0.05 to −0.25 m (sunk on purpose by `sink = h*0.18`), flag −0.50 m (the pole runs 0.25 m below the origin, plus a 0.25 m sink, so it reads as planted). Nothing floats.
- Shadows: the sun shadow map is on and every hero prop casts shadows. In `v2-closeup-lm-crew.png` the LM legs and crew cast hard shadows. The 12 rocks have a `v2-contact-shadow` disc. 3 of 12 rocks (0, 3, 5) report `castShadow=false` on all their meshes. Minor: the contact disc still grounds them, but at low sun they cast no long shadow.
- At the default module view (orbit radius 1400 m, `v2-m2-site-default.png`) the whole living layer is sub-pixel or a few pixels. "Living" only shows once you glide in (rings / prop click / POI). This is good for cue salience (see §4), but the learner may never notice the props unless they collapse the panel and use the rings.

## 2. Accuracy check (planetary-geologist persona)

Reference photos opened: AS15-86-11603 (Irwin saluting; LM, flag and LRV in one frame) and AS15-88-11866 (LRV with the high-gain antenna, Hadley Delta behind). Both are NASA PD, fetched from images.nasa.gov. I compared them with `src/scenes/hadley-props.js` and the close-up frames.

| Item | What is right | Problems vs. the photos | Severity |
|---|---|---|---|
| LM descent stage | True-scale footprint (~9.4 m across the pads), 4 diagonal legs with pads, engine bell, ladder on one leg, gold foil | The model is a regular gold **octagonal cylinder**. The real descent stage is a cruciform box (an octagon with long and short sides). It is mostly **black/amber Kapton** in quadrant panels with gold only in places, and it has silver-white legs with **struts that meet at the deck rim**. The engine bell is too exposed: on the real stage it sits deep in the central bay. The ladder is on the "+x,+z" diagonal, but on the real LM it is on the forward (+Z) leg, which faces the porch/hatch. The silhouette reads as a "gold drum on legs" (`v2-closeup-lm-crew.png`) more than as the faceted gold/black stage in AS15-86-11603. | minor (it is labelled simplified/approximate) |
| LM ascent stage absent | Correct for a site *after* lift-off, and the art bible says so ("what stays on the surface") | Coherent with a future-mission revisit. No issue. | — |
| LRV | 3.1 m long, ~2.06 m track, 0.82 m wheels, two seats, console, high-gain "umbrella", TV camera; wheels turn | The wheels are **solid grey discs** with a chevron texture. The real wire-mesh tyres with titanium chevrons read as open and dark. The **fenders are grey**, but on Apollo 15 they were orange/salmon in the photos (AS15-88-11866 shows the red-brown fenders clearly). The HGA reads as a white dish, while on 15 it was gold-mesh. Seats are blue boxes, but the real seats were tubular frames with nylon webbing. The overall proportions read right in `v2-closeup-rover.png`. | minor |
| Flag | Horizontal top rod, fixed creases, no flutter (DECISIONS #19), 13 stripes, canton | Flag size 0.92 × 0.60 m is a bit small (the Apollo flags were ~1.5 × 0.9 m with the crossbar). The pole is 2.2 m tall, which is plausible. At close range it is so thin that in `v2-closeup-flag.png` the cloth is almost edge-on or culled from this angle. | minor |
| Boulders | Poly Haven moon_rock_01–03, 0.3–1.6 m, varied yaw | Fine. Rock albedo sits well against the regolith. | — |
| Crew | White suits, helmets, chest pack, one with a red accent stripe | The figures are slim stylised humanoids with no visible PLSS backpack bulk. The real A7LB suits are much bulkier. They do **not** read as Scott/Irwin: no names, flag patch or commander stripes. Labels say "Crew member A/B (fictional mission)". One red accent stripe echoes the real commander stripe (Scott wore red stripes), but it is generic enough. | — (honesty OK) |

Is anything presented as more accurate than it is? Mostly no. ATTRIBUTION row 14 and DECISIONS #17 say "Simplified, approximate geometry", and the code header says the same. Two wording nits:
- The poster alt (`public/showcase.json`) says "...at the Apollo 15 Hadley site, rebuilt from NASA terrain data". That is accurate for the terrain but could be read as the LM being a reconstruction. Optional fix: "...procedural Lunar Module descent stage...".
- The LM tooltip says just "Lunar Module descent stage". It could add "(simplified model)" as the crew tooltips do with "(fictional mission)". Minor.

Overall: no glaring proportion errors, and scale is right. Colour errors (LRV fenders, LM foil distribution) are minor because the props are explicitly simplified. They are worth one pass if time permits.

## 3. Typography (computed styles)

| Element | Computed font-family | Expected |
|---|---|---|
| `.app-title`, `#task-panel h2`, Sun-tool h3 | `Michroma, sans-serif` | Michroma ✓ |
| `#task-panel p`, header buttons, `.scene-note` | `"IBM Plex Sans", system-ui, sans-serif` | Plex Sans ✓ |
| `.v2-world-tooltip` | `"IBM Plex Mono", ui-monospace, monospace` | Plex Mono ✓ |

`document.fonts` shows Michroma 400 and Plex Sans 400/600 loaded on M1, and Plex Mono loads on first tooltip. The sun-tool readouts ("12°", "A 1 m rock casts a shadow 4.7 m long") are in Plex Sans, not Plex Mono. The art bible assigns Plex Mono to "telemetry", so this is minor polish. Michroma at 20 px+ is legible. It is only used for headings, which follows the readability rule.

## 4. Cue salience during the learning tasks

- **Sun-angle task (M2, `m2-sun`)**: the default camera is 1.4 km out. Shadows sweeping the terrain are the dominant element, and the props are a few pixels wide. ✓ Rings at stations are ×45 scale, so they are visible as small orange rings/diamonds at mid range (`v2-site-mid.png`). They are distinct from the yellow feature pins. Not competing. ✓
- **Crater count (M3)**: the patch circles (cyan for mare) and the cyan crater marks dominate (`v2-m3-crater-marked.png`). The rover and crew are ~1 km away and not visible. **However**, the in-world hover tooltip still fires during the crater task. In `v2-m3-crater-marked.png` a "Lunar Module descent stage — Click to glide closer" pill pops up mid-screen while the learner is marking craters. The click is correctly ignored, which makes the hint misleading. See interaction report I-1: **major** (it competes with the cue and contradicts the disabled state).
- **Traverse (M4)**: in-world stays enabled and the station rings sit on the stations, which reinforces the route cue. ✓ The rover loop is at the LM only, so it is not on the traverse map scale.
- **Orange diamond beacons** (BEACON_Y 0.9 m × ring scale 6 = 5.4 m above ground at the landing-site rings) are big and bright up close. In `v2-closeup-lm-crew.png` the beacon of the 'vp-front' ring is larger on screen than the crew. With the panel open, the ring's diamond also sits right behind the task card (`v2-closeup-*` early frame). Minor: shrink the diamond or don't scale it with the ring.

## 5. Close-range terrain streak artefact

Confirmed. Below ~30 m eye distance the regolith shows vertical/columnar streaking and blocky texels (`v2-terrain-streak-close.png`, `v2-closeup-rover.png` lower half). It is the most visible quality problem in close-ups, and it undercuts the "Hasselblad" mood where the props are. It is partly software-render aliasing (SwiftShader has no anisotropic filtering) but likely also the albedo/detail texture at grazing angles. This needs a headed GPU check before the tag. If it persists: add anisotropic filtering on the terrain maps, or a fine tiling regolith detail normal that fades in below ~50 m. Severity **major** for the §8 "no backdrops within ~30 m / grounded" spirit, pending the GPU check. If GPU frames are clean, downgrade to minor.

## 6. Poster

`public/poster-2.0.0.jpg` (1200×630) is a real render of the v2 scene: LM, walking crew member, flag, rover with a dust trail, boulders and a black starfield. It matches the in-app close-up (same materials and geometry). The alt text is accurate, except the "long morning shadows" are not very visible in that frame (shadows are short at that sun height). Minor.

## Findings

| ID | Finding | Severity | Where |
|---|---|---|---|
| V-1 | Hover tooltip appears over props during the crater-counter task (misleading "Click to glide" while clicks are disabled) | major | `src/v2/in-world-interaction.js:404` `_onHoverMove` has no `this.enabled` check |
| V-2 | Close-range terrain streak/blocky texels under ~30 m; needs a GPU confirmation, then filtering/detail-normal fix | major (pending GPU) | `src/scenes/terrain.js` material maps |
| V-3 | LM silhouette too drum-like and too gold; LRV fenders grey, not orange; solid wheels | minor | `src/scenes/hadley-props.js:44-63, 129, 159-160` |
| V-4 | Ring diamond beacons ×6 scaled are larger than the crew at close range | minor | `src/app.js:177` (`r.scale.setScalar(scale)` also scales the diamond) |
| V-5 | 3 of 12 rocks do not cast shadows | minor | `src/v2/model-placer.js` (unmerged nodes keep the GLB castShadow) |
| V-6 | Sun-tool telemetry readouts are not in Plex Mono | minor | sun-tool CSS |
| V-7 | Flag a bit small; LM tooltip lacks "(simplified model)" | minor | `hadley-props.js:209`, `app.js:165` |
