# Publisher extraction r5 verification

Date: 2026-07-17  
Runtime: `2.0.1-navigator-r5`  
Extractor: `2.0.1-extractor-r10`

## User-reported regressions reproduced

1. ScienceDirect fragmented `.Body` roots
   - URL family: `www.sciencedirect.com`
   - Failure mode: repeated `.Body` elements were treated as trusted complete roots, reducing the outline to the largest single fragment.
   - Browser regression result: selected `MAIN#main-content`; 6 headings, 6 paragraphs; strategy `root-scoring`.

2. Cell Press classed `DIV` prose
   - URL family: `www.cell.com`
   - Failure mode: section headings were found, but classed leaf `DIV` prose was not counted as paragraphs.
   - Browser regression result: selected `ARTICLE#cell-fulltext.article-content`; 11 headings, 11 paragraphs; 0 unrecognized long-text blocks.

## Browser diagnostics

The extension was loaded unpacked in headed Microsoft Edge through Playwright. Both fixtures were fulfilled on their real publisher hostnames so the production publisher adapter and content-script registration were exercised. The extension service worker requested `getLlmDiagnostics`, `showArticleNavigator`, and `exportPublisherDiagnostic` from the real content script.

The diagnostic download completed as:

`sci-publisher-diagnostic-www.sciencedirect.com-2026-07-17T06-37-25-030Z.json`

The exported report contains structural selector counts, candidate shapes, heading samples, and aggregate character counts. It does not contain the full synthetic paragraph strings.

## Live-network limitation

Automated navigation to the two production Elsevier pages returned publisher anti-bot responses (`403`/browser challenge). The affected OA ScienceDirect article was independently resolved as `PMC13068659` through Europe PMC, while the DOM regressions were tested in Edge on the exact publisher host families using deterministic intercepted fixtures derived from the user-visible structures. This separates network bot protection from the extension extraction logic.
