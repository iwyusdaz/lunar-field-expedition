# Art Bible — Lunar Field Expedition v2.0.0 ("Hasselblad at Hadley")

## 1. Mood

1971 mission photography: hard, unfiltered sun, a black sky, regolith that glows
at low sun angles, and long knife-edged shadows. The reference is the Apollo 15
Hasselblad 70 mm surface record (Ektachrome: crisp contrast, faintly warm
highlights, cool neutral shadows). The real LROC NAC terrain is the ground truth;
everything added in v2 sits on top of it and never changes its shape.

The crew, LM, rover and flag belong to the project's fictional future mission
(as already labelled in the app). They are built from NASA Apollo-era reference
but are not a reconstruction of the 1971 crew.

## 2. Palette

| Role | Hex | Usage |
|---|---|---|
| Regolith | `#8C8780` | Rock tint, rover tyres, dusty props, neutral UI borders |
| Shadow black | `#07080A` | Sky, HUD surfaces, tooltip background |
| Sunlit highlight | `#F2EDE4` | HUD text, suit white, LM foil highlights |
| Earth blue | `#3E7CB1` | Earth disc rim, informational accents |
| NASA orange | `#E87722` | HUD accent border, hover outline, viewpoint rings, sample tags |

Contrast: `#F2EDE4` on `#07080A` is about 17:1; NASA orange is used for borders
and outlines, not for body text.

## 3. Grade and light

- `applyCaseGrade('lunar-field-expedition', { addSkyDome: false })`: AgX tone
  mapping, no fog, no sky dome. The sky stays black with the existing starfield,
  Earth (NASA Blue Marble) and Sun disc.
- One hard directional Sun (the existing sun-elevation slider drives it, so
  shadows sweep live). Very low ambient fill, as on the real photos.
- No depth of field outside the cinematic. No bloom on the terrain.

## 4. Typography

| Role | Variable | Face | Usage |
|---|---|---|---|
| Display | `--font-display` | Michroma 400 | App title, module headings |
| Body | `--font-body` | IBM Plex Sans 400/600 | Instructions, tasks, controls |
| Accent | `--font-accent` | IBM Plex Mono 400/600 | In-world tooltips, sample tags, telemetry |

All self-hosted WOFF2 (SIL OFL 1.1, `font-display: swap`). The header "Plain font"
button (saved per browser) switches every role to the system sans-serif.

## 5. Models

| Item | Source | Notes |
|---|---|---|
| Boulders (moon_rock_01–03) | Poly Haven, CC0 | 12 instances, grounded on DTM elevation, varied yaw/scale |
| Lunar Module descent stage | Procedural (this project) | At the real Apollo 15 landing site; gold-foil octagon, four legs with pads, descent engine bell; static parts merged |
| Lunar Roving Vehicle | Procedural (this project) | Chassis, seats, high-gain antenna, four mesh-tyre wheels that turn when it drives |
| Flag | Procedural (this project) | Pole with horizontal top rod (no wind on the Moon, so no flutter) |
| Two suited crew | `createAnimatedCharacter` (spacesuit outfit, helmet) | One idles at the LM; one walks a short spline to a station and points |

## 6. Ambient life (calm mode during module tasks; reduced motion freezes all)

1. Earth turns slowly on its axis.
2. Crew idle: breathing and posture shifts.
3. Crew walker: walk along a spline, then point at the station.
4. Rover dust burst when the rover moves (particles fall ballistically, no air).
5. Rover wheels turn while it moves.

No star twinkle (no atmosphere), no flag flutter, no audio.

## 7. In-world interaction

- Glowing NASA-orange floor rings at the station viewpoints; clicking one glides
  the camera there.
- WASD / arrow keys move; drag to look (existing controls kept).
- Hover highlight and an IBM Plex Mono tooltip on the LM, rover, rocks and flag.
- The crater-marking click handler, the sun slider, the traverse planner and the
  evidence board are unchanged; every action keeps its keyboard and text-mode
  equivalent.

## v3 owner direction (S0), recorded 2026-10-30

The owner made these choices for plan 10 (v3.0.0) on 2026-10-30, after reviewing the
S0 direction pack. The choices are the owner's; an agent prepared the pack.

| Item | Choice |
|---|---|
| Font pair | **Pair A: Jost (display, 600) + IBM Plex Sans (body).** SIL OFL 1.1, self-hosted WOFF2. Specimen: `repos/immersive/_direction/lunar-field-expedition/specimen.html` |
| Layout | Scene-first mock `repos/immersive/_direction/lunar-field-expedition/layout.svg` approved, with the label change below |
| Reference board | Approved as drafted: `repos/immersive/_direction/lunar-field-expedition/index.html#refs` (10 links) |
| Object list | Approved as drafted: `repos/immersive/_direction/lunar-field-expedition/objects.draft.json` (32 objects in the main scene, 3 secondary). S4 turns it into `content/objects.json` and resolves each object's `_check` note |

### Object name labels are hidden by default (owner change, all seven repos)

The mock shows a name label on every object. The owner wants no labels at rest:

- Mouse: hovering an object shows its outline and its name label, with a fade in and out of about 150 ms. With reduced motion on, the label appears and disappears instantly.
- Keyboard: when an object takes focus (Tab or the "Objects in view" list), its label shows the same way.
- Touch (no hover): a tap opens the object's info card directly, and the label shows with it.
- Off by default: a "Show all labels" menu setting, saved in localStorage; holding a key (Alt or L) shows all labels while held, and the controls cheat sheet lists that key.
- Task cues (for example a numbered survey flag or a glint) are not name labels and stay visible. Their text labels follow the same hover rule. The plan §4.2 task/explore distinction still applies.
- Gate: a ui-audit check and a browser test prove that no object labels are visible at rest, that hover, focus and tap each show the correct label, and that "Show all labels" shows them all.

This is built once in the S3 template (`_templates/immersive-core`) and synced into the repo.

### Open question: Endeavour card

Keep the app's fictional framing. The moving light overhead is the field team's own
orbiter, labelled "fictional mission, orbit time-compressed". Its card explains that on
Apollo 15 in 1971 Al Worden flew the command module Endeavour on exactly this job. The
card cites a source from `research/`. No Apollo 15 orbit source is in `research/` yet
(the draft entry cites Wikipedia), so S4 adds one and the card cites it.

## v3 assets staged in S4 (2026-10-31)

Built by the scripts listed; formats from `_templates/spikes/RESULTS.md`; sources and licences in
`ATTRIBUTION.md` rows 15-30 and `evaluation/results/asset-licence-check.json`; tiers in
`public/assets/v3/manifest.json`.

| Asset | Files | Notes |
|---|---|---|
| Streamed terrain | `public/assets/terrain-v3/` (`scripts/build-v3-terrain.mjs`) | Near: NAC DTM 5 m, 1,705 tiles. Far: SLDEM2015 80 m, 341 tiles, whole Apennine Front with Mons Hadley (summit about 4.1 km above the LM, 20 km away) and Hadley Delta (3.5 km, 18 km). Lunar curvature applied. |
| Regional albedo | `public/assets/v3/terrain/albedo-clementine-750nm-1024.ktx2` | Clementine 750 nm, multiplier for the far terrain |
| Regolith detail | `public/assets/v3/regolith/` | Poly Haven CC0 moon_01 (3.1 m tile) and moon_dusted_02 (0.4 m tile); 512 px first, 1024 px streamed |
| Decals | `public/assets/v3/decals/` | Poly Haven CC0 bootprint patch and chevron tyre track (illustrative) |
| ALSEP set | `public/assets/v3/models/alsep-set.glb` | Own work: central station, seismometer (+ skirt), retroreflector, magnetometer, heat flow box, RTG, sample bag |
| Rocks | `public/assets/v3/models/moon-rock-04..07.glb`, `genesis-rock-reconstructed.glb` | Poly Haven CC0 scans; boulders are scaled instances (illustrative) |
| Sky | `public/assets/v3/sky/` | Blue Marble 2048 day map and clouds (time-lapse spin), BSC5P star catalogue (real positions, no twinkle) |
| Grade | `public/assets/v3/grade/hadley-ektachrome-33.png` (source `design/grade/hadley-ektachrome-33.cube`) | Own-work LUT for the S3 tone-mapping pass |

Not staged here: the LM, rover, flag and crew stay the v2 own-work procedural models for S5
(DECISIONS #25); fonts (Jost + IBM Plex Sans) come with the S3 template sync.
