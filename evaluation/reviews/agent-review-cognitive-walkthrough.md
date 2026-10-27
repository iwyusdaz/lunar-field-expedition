# Agent review: cognitive walkthrough

Reviewer: separate AI agent. Persona: **Rafi, 15** (design/personas.md). Likes space, struggles to write explanations, uses a school laptop with a mouse, default settings (auto Medium; probes run on Low because of headless GL). Path: the 3D flow, Modules 1-5. At each step: does Rafi know what to do (Q1), does he see progress (Q2), and does he get usable feedback (Q3)? Only "no" answers are logged in detail.

| Step | Q1 | Q2 | Q3 | Notes |
|---|---|---|---|---|
| M1 globe | yes | yes | n/a | "The pin marks the Hadley–Apennine region": the pin is a tiny yellow dot (`menu-m1-globe.png`, centre-right) that's hard to spot. **CW-1 minor.** |
| M1 cinematic choice | yes | yes | yes | |
| M1 cinematic playing | yes | no | n/a | **CW-2 major:** captions overlap the task panel buttons (`m1-cinematic-s1.png`). The s1 caption describes the rille and pin before they're on screen. |
| M1 brief | yes | yes | n/a | The question is clear. |
| M1 pre-check | yes | no | yes | No "n of 5". The why-feedback is strong. |
| M2 sun tool | partly | no | partly | **CW-3 major:** the task panel covers most of the terrain, so "watch the slopes" is hard to follow. "Continue" is available without touching the slider, so Rafi can skip objective 2's core experience. |
| M2 feature tag | no | partly | yes | **CW-4 critical:** "Four landforms are marked with pins" but the pins are invisible (6 m cones at 1400 m). Rafi has to find the POI list on the right, and its labels give away the answer ("Winding channel", "Bowl depression with raised rim"). The task becomes reading, not looking. |
| M2 profile | yes | yes | yes | Presets work. Line chart plus numbers. |
| M3 crater count | no | no | no | **CW-5 critical:** no patch rings appear (crater-counter.js:76 NaN). The POI to the patch blacks out the screen (`m3-mare-patch.png`). There's no scale reference for "80 m". Every click counts as "inside". Rafi can't do a meaningful count. "Continue" stays disabled until Submit, so he submits 0/0, and the result line says the Front "carries more craters" (crater-counter.js:155, the tie case falls to the else branch). That's misleading feedback. |
| M3 reveal | yes | yes | yes | The method note is good. It's behind an optional button; Rafi may skip it, since Continue doesn't require it. **CW-6 major.** |
| M3 superposition | partly | yes | yes | "Look at the boundary" gives no POI or camera move to the contact. **CW-7 minor.** |
| M3 debrief | yes | yes | n/a | |
| M4 hypothesis | no | n/a | n/a | **CW-8 minor:** "Choose the question" but there's nothing to choose on this step. |
| M4 planner | partly | yes | partly | **CW-9 critical:** a "Continue to the field report" button sits under the planner from the start (app.js:427). If Rafi clicks it, M4 is locked as complete and the evidence board has no traverse data (verified by probe). The tool preselects the first listed option, often "Photograph", so he can drive a route with no samples. The budget almost never binds (H-6). |
| M4 run/debrief | yes | yes | yes | The station cards and the side-by-side with Apollo 15 are strong. Traverse quality "n/3 criteria" is usable. |
| M5 evidence board | yes | yes | n/a | |
| M5 CER builder | partly | partly | no | **CW-10 major:** checkboxes show raw tags ("superposition-or-count", "age-contrast"). Rafi can't map them to his board items. If a tag is missing, the error repeats the raw id and says "collect them in the traverse", but M4 can't be reopened (CW-9). The minimum lengths are a guide, which is good for Rafi. There are no sentence starters for a weak writer, though the plan's persona need is "scaffolded CER". **CW-11 major.** |
| M5 self-check | yes | yes | partly | The exemplar is behind a `<details>`. Self-rating with no prompt to revise. **CW-12 minor:** add "revise your report" after the self-check. |
| M5 comparison | yes | yes | n/a | The photo caption names a mountain-front area, but ATTRIBUTION describes AS15-89-12100 as a "Telephoto view across Hadley Rille". The alt text is likely wrong (see expert review). |
| M5 post-check | yes | no | yes | No pre-vs-post comparison is shown to Rafi at the end. **CW-13 minor.** |

## Summary of "no" points
- Critical: CW-4 (invisible pins, answers leaked by POI names), CW-5 (crater task unusable), CW-9 (M4 dead end).
- Major: CW-2, CW-3, CW-6, CW-10, CW-11.
- Minor: CW-1, CW-7, CW-8, CW-12, CW-13.

Recommended fixes: (1) remove app.js:427 and allow module replay; (2) fix the patch centres and POI flights, and add an 80 m scale ring; (3) screen-space labelled pins with neutral labels ("Feature A–D"); (4) readable evidence labels and sentence starters in the CER builder; (5) make Continue in M3 require the reveal, or render the method note inline after Submit.
