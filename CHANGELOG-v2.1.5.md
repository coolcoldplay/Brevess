# SCI Paper Logic Highlighter 2.1.5

- Extracts Cell / Elsevier `Figure S1-S9` as distinct supplemental Figures in article order.
- Separates `Figure 5` citations from `Figure S5` citations so supporting evidence is not attached to the wrong main Figure.
- Shows the full Figure directory before analysis; each Figure can jump to its source or be analyzed independently.
- Makes batch Figure walkthroughs deep by default and renders collapsible Figure, Panel, evidence-group, and domino-chain detail.
- Adds Panel-coverage feedback, control analysis, evidence levels, and explicit argument-chain handoffs.
- Adds a one-click, cached cross-main-Figure domino summary: every main Figure is ordered as a node with its established evidence, reason to advance, and evidence boundary; supplemental Figures are shown as explicit support links.
- Switches full-text LLM highlighting to coverage-first prompting and rechecks paragraphs that were not marked reviewed.
- Adds one targeted grounding-repair pass when a model proposes a required evidence slot that is not verbatim in its own quote, preserving accepted highlights while recovering valid evidence.
- Tightens broad regex discourse cues to reduce false-positive sentence highlights.
