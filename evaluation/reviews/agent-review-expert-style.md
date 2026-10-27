# Agent review: simulated persona expert reviews

Agent review, simulated persona. These are not reviews by a real teacher or a real planetary geologist. An AI agent wrote them from those perspectives, using the repo's content and research log (plan 01 §10). Claims marked "verify" are the reviewer's recollection and need a primary source; they are not confirmed facts.

---

## 1. Agent review, simulated persona: high-school earth-science teacher

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| T1 | major | design/learning-objectives.md:13; README standards | HS-ESS1-6 is about reconstructing *Earth's* formation and early history. No module, prompt or post-check item connects the Moon's ages back to Earth. The alignment is asserted, not taught. | Add one M5 discussion or post-check item: "Why do lunar crust ages (about 4.46 Ga) tell us about early Earth when Earth's own crust from that time is mostly gone?" |
| T2 | major | design/teacher-guide.md:22-23 | The answer key points to `content/items.json` and other JSON files. A teacher with no lunar background (the Ms. Ortiz persona) won't read JSON. The feature-tag and superposition answers aren't in the guide at all. | Put a printable answer table in the guide: items, tags, superposition, expected traverse. |
| T3 | major | stations.json:23; features.json | Hypothesis h-rille, "the rille is a *young* volcanic channel", invites the misconception that the rille is geologically recent. It is about as old as the mare lavas (≈3.3 Ga). | Reword: "The rille was carved by lava *after* the plain's first flows, and cuts into them." Add "young = relative" to the misconceptions list. |
| T4 | major | content/report.json:10 | The CER evidence example ("the profile across the rille at Station 9a showing ~370 m depth") cites a number the 9a card never gives. The app's own DTM measures ~284 m. Students will copy the example verbatim. | Use a number the learner actually collects (e.g. "the Front breccia at Station 6, ~3.9 Ga"). |
| T5 | major | app.js:626-634 | Students see raw tags ("superposition-or-count", "age-contrast") in the citation checklist. Teachers will field "what does this mean?" from every group. | Show the evidence card titles. |
| T6 | major | Persona Rafi needs "scaffolded CER" (design/personas.md:5) | Only prompts and minimum lengths exist. No sentence starters or partially worked frame for struggling writers. | Add an optional "sentence starters" toggle per CER section. |
| T7 | minor | items.json:62 | "A sinuous rille and a 40 km impact basin": 40 km is a crater. "Basin" is reserved for very large structures (hundreds of km). | Say "a 40 km impact crater". |
| T8 | minor | modules.json:44 | "80 m … about the length of a football field": a US field is about 91 m between goal lines, a soccer pitch about 100 m. | Use "a bit shorter than a football field". |
| T9 | minor | teacher-guide.md timing | 12 min for M5 (board, 4-section CER, self-check, comparison, post-check) is tight for grade 9 writers. | Suggest 15-18 min, or homework for the CER. |
| T10 | minor | none | Pre/post results are never shown side by side to the student or teacher (only the JSON in My progress). | Show "pre 2/5 → post 4/5" at the end. |

Misconception coverage, per the teacher guide: "craters are volcanoes", "more craters = older", "rille = water" and "shadows are just lighting" are all addressed with why-feedback. That's a strength.

---

## 2. Agent review, simulated persona: planetary geologist

| # | Severity | Where | Finding | Fix |
|---|---|---|---|---|
| G1 | major | content/craters.json:22-73; features.json:55 | The detected "craters" have depth/diameter ratios around 0.01-0.03 (190 m wide, 2.3 m deep). Fresh simple craters are about 0.2. These are heavily degraded features or detection noise. The profile preset still calls the 190 m one "a clean bowl with a raised rim". The text contradicts the app's own data. | Pick a fresher crater for the profile/tag example, or describe it as "a degraded, shallow crater". State the d/D in the Ken (undergrad) extension. |
| G2 | major | crater-counter.js reveal text; craters.json | 6 vs 1 craters in 0.071 km² patches is statistically meaningless (Poisson ±√N). At 80-190 m diameters, both 3.3 Ga and 3.9 Ga surfaces are near crater equilibrium/saturation, so the "plain's density is the meaningful clock reading" overstates it. The slope-degradation lesson is valid; the implied precision isn't. | Add one sentence on small-number uncertainty and on equilibrium for small craters on old surfaces. Have the undergrad extension compute ±√N. |
| G3 | major | stations.json:110; crater-counter.js reveal ("roughly 25° slopes") | The Front slope is quoted as about 25°. The app's own data gives a median of 29.9 % (≈17°) for the Front patch (craters.json:103). The ~25° figure in the research log is the *rille wall* slope, not the Front's. | Use the measured value ("about 15-20° in our patch") or log a source for the Front slope. |
| G4 | major (verify) | stations.json:126 (EVA 2 route) | The app orders EVA 2 as LM → Dune → Station 6 → Spur. My recollection is that the crew drove to Station 6 first, then 6a and 7 (Spur), and stopped at Dune (Station 4) on the return. The research log only lists the stations, not their order, yet stations.json:123 says "station order is real". | Verify against the Apollo Lunar Surface Journal and correct the route and debrief text. |
| G5 | major (verify) | app.js:724 | "Spotted a glinting rock partly buried in the regolith and pulled it free": not in the research log. My recollection is that 15415 sat on top of a larger breccia boulder (the "pedestal"). Unlogged narrative detail, possibly wrong. | Remove it or log and source it. |
| G6 | major | stations.json:103 (Dune photograph) | "Sharp rim, bright rays. Fresh craters like this one are the standard surface clocks." Individual fresh craters aren't clocks; crater *populations* are. "Bright rays" at Dune is unlogged. South Cluster craters are often interpreted as secondaries (verify), which complicates any clock use. | Reword: "Crater populations, not single craters, date surfaces." Drop the unlogged descriptors. |
| G7 | minor | features.json:48 (mare-sediment) | "There is no sediment transport on the Moon" is false. Mass wasting and impact gardening move regolith downslope; the app's own Front card mentions "a smooth apron of debris at its base". | Say "no water- or wind-driven sediment transport". |
| G8 | minor | stations.json:108; features.json:54 | "~4,600 m" Front height: the site-facing massif, Hadley Delta, rises roughly 3.5 km above the plain; ~4.5 km is Mons Hadley (verify). The Station 6 card attaches 4,600 m to the slope the learner is on. | Name the massif the figure refers to. |
| G9 | minor | features.json:58 (sun presets) | "High noon (55°)" at azimuth 100°. At 26°N, local-noon Sun is near due south at roughly 60-64° elevation. Labeling a 100° azimuth "noon" is physically inconsistent. | Rename it "High Sun (55°)", or set azimuth ≈180 for noon. |
| G10 | minor | items.json:76 | "Without an atmosphere, shadow is the only depth cue": overstated (stereo, shading, photoclinometry). | Say "the strongest depth cue in a single image". |
| G11 | minor | features.json:47 | "Layered flows seen in Dune's ejecta": not in the research log. | Log it or remove it. |

### Honesty-rule check
| Rule | Status |
|---|---|
| No fabricated facts | Concern. Unlogged learner-facing facts: "27 km" (cinematics.json:52), "first mission with a rover" and "only landing next to a deep mountain front and a sinuous rille" (modules.json:21), Genesis "partly buried" (app.js:724), Dune "bright rays" (stations.json:103), Dune "layered flows" (features.json:47). |
| Fictional labels present | Concern. The README and DECISIONS mark the mission frame fictional. In-app, "Today YOU are part of a future field team" (modules.json:21) never says "fictional". The brief also says "exactly as the Apollo crews did", which blurs the line. Add "(a fictional mission)" in M1. |
| Simplified labels | Pass for sample cards and the planner. Photo/profile cards lack the label except at the LM. |
| UNVERIFIED / snippet markers respected | Concern. The log's header (apollo15-facts.md:4-6) says snippet-only values are "used only for approximate positions". But the two ages the whole lesson rests on (3.3 Ga, 3.85-3.9 Ga; lines 58-59) are VERIFIED-SNIPPET. Fetch Taylor 2012 or cite a second source. |
| "Approximate" labels | Pass for station buttons. Fail for Earth's sky position: log line 82 says the app labels it approximate, but there's no such label in-app. |
| No compliance claims | Pass. Accessibility docs avoid WCAG conformance claims and state their testing limits. |
| Photo metadata | Major. ATTRIBUTION.md:13 titles AS15-89-12100 "Telephoto view across Hadley Rille". The app's alt text (app.js:714) says it shows "the mountain-front station area … during EVA 2", and the caption claims nearby frames show the Genesis Rock find. They contradict each other; at least one is wrong. Use the NASA caption verbatim. |
