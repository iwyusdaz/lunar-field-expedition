# Alignment matrix

Objective → activity → feedback → assessment. Every row also exists in text mode (see the text-mode column).

| Objective | Activity (3D) | Text mode equivalent | Feedback | Assessment |
|---|---|---|---|---|
| 1. Landforms and origin | Module 2: tag 4 features in the real terrain | Annotated orthoimages (derived hillshades of the DTM) with feature descriptions | Per tag: correct or not, with the formation explanation | Feature tagging with justification; pre-1, post-1 |
| 2. Sun angle and relief | Module 2: sun-angle sliders and presets; elevation profiles (3 presets) | High-sun vs low-sun orthoimages side by side; profiles as data tables | Captioned reveal (shot s2) plus tool feedback | pre-2, post-2 |
| 3. Relative age | Module 3: crater counting on two 0.071 km² patches; superposition at the plains/Front boundary | Crater size-frequency tables for both patches | Reference count reveal after submit; method note on why the Front shows fewer craters | Density comparison and explanation; pre-3, pre-4, post-3, post-4 |
| 4. Traverse planning | Module 4: route with slope-cost model, up to 4 stations, EVA and consumables meters | Station-graph choice list with costs | Traverse debrief beside the real Apollo 15 traverse | Traverse quality against criteria; pre-5, post-5 |
| 5. CER report | Module 5: CER builder from the evidence board | Same CER builder | Rubric (4 criteria × 4 levels) and an exemplar; structured check that required evidence types are cited | Rubric self-check; no auto-grading of free text |

Required evidence types per hypothesis (from `content/report.json`): the Front-age claim needs front material, mare material, and superposition or a count; the rille claim needs rille structure, mare material, and cross-cutting.

Coverage check: every objective has practice, feedback and an assessed item in both modes. Checked against `content/` on 2026-10-27; content integrity is also covered by `tests/unit/content.test.js`.
