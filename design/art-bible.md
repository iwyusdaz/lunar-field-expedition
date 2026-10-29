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
