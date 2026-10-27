# Realism matrix

Rule: high realism only where noticing the detail is part of the learning.

| Element | Level | Learning cue? | Rationale | Evidence |
|---|---|---|---|---|
| Terrain shape (LROC NAC DTM, 2 m/px, no vertical exaggeration) | High | Yes | The landforms are the content (objectives 1, 3) | Relief validated: `evaluation/results/terrain-validation.json` |
| Sun direction and hard shadows | High | Yes | Sun angle reveals relief (objective 2) | Realistic detail helps when task-relevant ([PMC11269326](https://pmc.ncbi.nlm.nih.gov/articles/PMC11269326/)) |
| Albedo (NASA LROC WAC color crop) plus procedural regolith detail | Medium | Partly | Gives scale and real tone; detail kept low so landform reading stays clear | Same |
| Black sky with dimmed stars | Medium | Partly | No atmosphere; stars dimmed as daylight cameras would record them | — |
| Earth in the sky (NASA Blue Marble) | Medium | No | Orientation only; placed at its approximate elevation for the site, labeled approximate | `research/apollo15-facts.md` (derived) |
| Global Moon (Module 1, LROC WAC color + LOLA elevation) | Medium | Partly | Locates the site on the Moon | — |
| Astronaut avatar, Lunar Module model | None | No | First-person view; avoids uncanny figures and extraneous detail | Plan 01 §6.1 |
| Dust particles, lens flares | None | No | Seductive details | [2025 meta-analysis](https://link.springer.com/content/pdf/10.1007/s10648-025-10099-z.pdf) |

The play area is cropped: it includes the lower ~1 km of the Apennine Front, not the full ~4.6 km escarpment (documented in DECISIONS.md and the README).
