# Accessibility plan

Features mapped to the [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/), [Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/gaming/accessibility/guidelines) and WCAG 2.1 AA for the HTML layer. "Tested" means covered by automated or scripted checks in `tests/`; nothing has been reviewed by an assistive-technology user.

| Need | Feature | Guideline | Status |
|---|---|---|---|
| Screen reader | All UI is semantic HTML over the canvas; live-region announcements | WCAG 1.3.1, 4.1.2, 4.1.3 | Tested (axe; accessibility tree) |
| Can't use the 3D view | Text mode for all five modules with the same decisions | GAG "provide an alternative" | Tested (text-mode parity test) |
| Keyboard | Sun sliders, profile presets, crater-counter controls, traverse planner and CER builder are native controls; arrow keys orbit the camera; points-of-interest list | WCAG 2.1.1 | Tested (scripted playthrough) |
| Pointer-only task | Marking individual craters in 3D needs a pointer; the text-mode crater data task is the equivalent | WCAG 2.5.1 | Documented gap with equivalent |
| Data in charts | Elevation profiles and meters have numeric text and data tables | WCAG 1.1.1, 1.3.1 | Built |
| Motion | Reduced-motion setting (follows the OS, plus a toggle): cinematic becomes still frames | WCAG 2.3.3 | Tested |
| Time | EVA time is a simulated budget, not a real-time clock; no timers | WCAG 2.2.1 | Built |
| Captions | All cinematic content is captioned | WCAG 1.2.2 | Built |

**Known gaps:** Guidepup/VoiceOver automation was not run (see `../SYSTEM-CHANGES.md`); no review by a daily screen-reader user.
