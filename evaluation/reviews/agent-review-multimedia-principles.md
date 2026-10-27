# Agent review: Mayer's multimedia principles

Reviewer: separate AI agent. Evidence: content/*.json, src/app.js and the tools, plus screenshots in `screenshots/`.

| Principle | Rating | Evidence | Violations / fixes |
|---|---|---|---|
| Coherence | Mostly pass | No avatar, dust or lens flare (realism matrix). Stars dimmed. | M-1 (minor): oversized sun disc (hadley-site.js:109, about 2.9°) is decorative glare. M-2 (minor): Settings has 3 volume sliders and a captions toggle for audio that doesn't exist (settings.js:85-90). That's extraneous, and it confuses. M-3 (minor): the "Himalayas" comparison (stations.json:108) is a seductive aside; fine, but keep it out of the evidence text that feeds the board. |
| Signaling | Fail | Text references "pins", "marked patches", "the winding line", "the boundary". | M-4 (critical): pins are sub-pixel (hadley-site.js:178), patch rings are drawn at NaN (crater-counter.js:76), and there's no highlight of the mare/Front contact in M3 superposition. The text signals cues that aren't on screen. Fix: screen-space labelled markers, working rings, and a POI plus a highlighted line for the contact. |
| Redundancy | Pass | No narration audio, so captions plus visuals is not redundant. On-screen text isn't duplicated by speech. | Note: the visually-hidden audio-description `<p>` (shot-player.js:49) isn't in a live region, so SR users don't hear it. That isn't a redundancy issue, but it is unused. Put it in the caption region for SR users only. |
| Spatial contiguity | Fail | The task panel (bottom, 62vh) holds the questions about terrain features that sit behind it. The POI list is at the top right. In M4 the map canvas and the route list are side by side (good). | M-5 (major): feature-tag questions are far from, or occlude, their 3D referents (`m2-feature-tag.png`). Fix: anchor HTML labels to the 3D positions, and move the panel to a side column. M-6 (minor): text-mode feedback is appended at the end of the module body, far from the answered item (app.js:886-889). |
| Temporal contiguity | Concern | The s2 sun sweep is synced with its caption (good). | M-7 (major): s1 shows both captions for 25 s at once (shot-player.js:84). "The winding line is Hadley Rille. The pin is your landing site" appears while the camera is still over the Front. Fix: timed captions per shot segment. |
| Segmenting | Pass | 5 modules, 3-5 steps each, Continue between steps. Learner-paced. | M-8 (minor): the reduced-motion stills auto-advance every 4.2 s (shot-player.js:100). Learner pacing is lost there. |
| Pre-training | Concern | The pre-check introduces the key concepts with why-feedback. The M1 brief defines the question. | M-9 (major): terms used before they're defined: "mare", "sinuous rille", "breccia", "anorthosite", "Ga" (features.json:35 "about 3.9 Ga"; stations.json:100). There's no glossary. Fix: a 4-term pre-training card in M1 (mare, rille, crater, massif) and inline definitions of Ga and breccia. |
| Modality | N/A, concern | No audio at all. All explanation is on-screen text competing with a visual scene. | M-10 (minor): the cinematic would benefit from narration (modality principle). Optional. If added, keep captions. |
| Learner control | Mixed | Skip from frame 1, POI jumps, sun presets, camera buttons. | M-11 (critical): M4 can be "completed" by an always-visible Continue before planning (app.js:427), and completed modules can't be redone. Control is lost in the wrong direction. M-12 (minor): no pause in the cinematic, only skip. |

## Violation list (by severity)
- Critical: M-4 (signaling cues missing), M-11 (M4 skip dead end).
- Major: M-5, M-7, M-9.
- Minor: M-1, M-2, M-3, M-6, M-8, M-10, M-12.
