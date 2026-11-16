# Design QA — Native Side Panel Preview

- target viewport: 2048 × 1160, Edge
- reference: `reference-current-overlap.png`
- implementation: `prototype-active-2048x1160.png`
- combined comparison: `qa-comparison.png`

## Fidelity surfaces

- typography: passed — Segoe UI / Microsoft YaHei for product chrome, serif article typography for the publisher simulation, with clear size and weight hierarchy.
- layout rhythm: passed — 8–16 px control spacing, consistent card padding, fixed bottom navigation, independent sidebar scroll, and no floating panel overlap.
- colors and tokens: passed — existing deep navy primary action, pearl/blue-gray surfaces, restrained semantic category colors, and accessible selected states.
- image and asset fidelity: passed — the prototype does not require generated image assets; interface icons use the project’s existing Phosphor icon font. The publisher area is explicitly a lightweight simulation rather than a copied production page.
- copy and content: passed — realistic paper metadata, single-choice review type, four highlight categories, evidence ledger, HTML outline tree, click-to-jump behavior, annotation editor, and figure-analysis states are represented.

## Interaction checks

- activation is explicit; no scan is triggered on initial page load.
- sidebar opens, closes, and reopens from the simulated Edge extension action.
- width drag changes the sidebar from 480 px to 593 px within the 360–720 px contract.
- analysis, navigation, highlight, and figure views switch within one sidebar container.
- outline summaries expand and a heading click focuses the corresponding article section.
- manual highlight editing and save confirmation remain inside the sidebar.
- console errors: 0; page errors: 0.

## Visual findings

- P0: none.
- P1: none.
- P2: none blocking handoff.
- intentional difference: the overlapping evidence-ledger and navigation overlays in the reference are replaced by mutually exclusive in-sidebar subviews. This is the requested product behavior, not a fidelity defect.

final result: passed
