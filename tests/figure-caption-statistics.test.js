const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../core/cache-planner.js');
const planner = require('../core/figure-panel-planner.js');
const analysis = require('../core/figure-analysis.js');

// Exact caption fixtures from source article SHA256 0dadeacde018c88cde9cfe1373094f8698682a06bd1720e62c7e466a9ea278ed.
// Standalone literals: tests do not depend on live outputs, provider data or a browser.
const realCaptions = {
  "fig3": "(A) Intravital snapshot of calcium changes (X-Rhod-1 AM, a cell permeant Ca2+-sensing dye; magenta) in wild-type (WT) and Adrb2-HF-cKO hair follicles before and 10 min after norepinephrine (NE) injection. See also Videos S1 and S2. Graph quantifies the fluorescence intensity of X-Rhod-1 AM in hair bulbs (n = 11–14 follicles from 4 to 5 mice).\n(B) Mice pre-injected with an extracellular Ca2+ inhibitor (BAPTA) lose hair following RTX.\n(C) Intracellular Ca2+ inhibitor (BAPTA-AM) blocks RTX-induced hair loss.\n(D) Cell death (aCAS3) in hair follicles (P-cadherin, PCAD) within vehicle or BAPTA injection sites. Graph quantifies damaged hair follicles in vehicle vs. BAPTA-injected mice (n = 3 mice/condition, 25–30 hair follicles/mouse).\n(E) Cell death in hair follicles within vehicle or BAPTA-AM injection sites. Graph quantifies damaged hair follicles in vehicle vs. BAPTA-AM-injected mice (n = 3 mice/condition, 25–30 hair follicles/mouse).\n(F) BAPTA-AM does not alter sympathetic neuron activity (cFOS) after RTX. Graph quantifies % cFOS+ neurons in sympathetic ganglia (n = 9–10 ganglia from 3 mice).\n(G) Cell death at sites co-injected with NE and vehicle, or NE and BAPTA-AM. Graph quantifies hair follicle cell death (n = 90 hair follicles from 3 mice).\n(H) Elevating intracellular Ca²⁺ in K14-Cre;CAG-LSL-Gq-DREADD mice with increasing CNO concentrations causes progressively more hair bulb cell death at injection sites and hair loss at high dose. Graph quantifies aCAS3+ cells in hair bulbs (n = 3 mice/condition, 20–30 hair follicles/mouse).\n(I) Minimal cell death in HFSCs of WT and K14-Cre;CAG-LSL-Gq-DREADD (GqDREADD) mice injected with 1 mg/mL CNO (representative images, n = 3 mice/genotype). Scale bar: 100 μm (A and D–F) and 10 μm (G–I). Statistics: unpaired two-tailed t test assuming Gaussian distribution with 95% confidence interval (D–G), two-way ANOVA with post hoc Tukey test (A and H), ns, not significant, ∗p < 0.05, ∗∗p < 0.01, ∗∗∗p < 0.001, ∗∗∗∗p < 0.0001. All error bars show mean ± SEM.\nSee also Figure S3.",
  "fig6": "(A) Hair follicles in K14-Cre;Rosa-H2BGFP express GFP, allowing tracking of immune cells that engulf hair follicle antigens. Following stress-induced hair follicle necrosis, dendritic cells (DCs) engulf GFP+ debris and migrate to the skin-draining lymph node, where they activate CD8+ T cells recognizing these self-antigens. When transferred into Rag1−/− mice, these CD8+ T cells attack hair bulbs.\n(B) Graph quantifies CD86 median fluorescent intensity (MFI) of migratory immune cells in lymph nodes, including DC type 1 (cDC1; CD45+CD64−CD11c+MHC class IIhighCD103+CD11b−), type 2 (cDC2; CD45+CD64−CD11c+MHC class IIhighCD103−CD207−CD11b+), Langerhans cells (LCs; CD45+CD11c+MHC class IIhighCD103−CD11b+CD207+), and lymph node resident DCs (LN Res.; CD45+CD64−CD11chighMHC class IIintermediate) from mice day 1 or 3 post-saline or RTX (n = 3–6 mice/condition). See Figure S6 for gating.\n(C) Frequency of GFP+ cells in migratory cDC1, cDC2, LCs, and LN Res in lymph nodes at day 3 post-RTX (n = 4 mice).\n(D) Quantification of effector/effector memory-like CD8+ T cells (CD45+TCRβ+CD19−CD8α+CD4−CD44+CD62L−) and central memory-like CD8+ T cells (CD45+TCRβ+CD19−CD8α+CD4−CD44+CD62L+) in the skin-draining lymph nodes from saline or day 14 post-RTX.\n(E) CD8+ T cells from saline- or RTX-treated donors are transplanted into Rag1−/− recipients. Both localize to the epidermis, but only those from RTX-treated donors infiltrate hair bulbs, and bulge localization is rare.\n(F and G) Transplanted T cells in Rag1−/− recipients (CD3 in F; CD8 in G). Graphs quantify T cells contacting hair bulbs (n = 45 hair follicles, 3 mice/condition).\n(H) Cell death (aCAS3) in hair bulbs of Rag1−/− recipients transplanted with CD8+ T cells from saline- or RTX-treated donors (representative images from 3 mice/condition, each mouse an independent transplantation from a unique donor).\n(I) Whole mount of Rag1−/− recipients challenged with lipopolysaccharide (LPS) after transfer of CD8+ T cells from saline- or RTX-treated donors. Bottom: inset magnification. DIC, bright field.\n(J) Cell death (aCAS3) in hair bulbs of Rag1−/− recipients challenged with LPS after transfer of CD8+ T cells from saline- or RTX-treated donors (representative images from 3 to 4 mice/condition).\n(K) Lack of cell death in the bulge of Rag1−/− recipients challenged with LPS after transfer of CD8+ T cells from saline- or RTX-donors. Schematic of hair bulb-specific T cell attacks. Scale bars: 25 μm (E–H, J, and K) and 100 μm (I). Statistics: two-way ANOVA with significance of indicated comparisons assessed using Šídák’s multiple comparison test (B), one-way ANOVA with significance of indicated comparisons assessed using Tukey’s test (C), and unpaired two-tailed t test assuming Gaussian distribution with 95% confidence interval (D, F, and G), ∗∗p < 0.01, ∗∗∗p < 0.001, ∗∗∗∗p < 0.0001. Error bars in (B)–(D) show mean ± SD; (F) and (G) show mean ± SEM.\nSee also Figure S6.",
  "figs2": "(A) Schematic for adrenalectomy (left); concentration of circulating corticosterone in sham-operated (SHAM) and adrenalectomized (ADX) mice (n = 4 mice per condition) (right).\n(B) Hair loss following RTX injection in SHAM and ADX mice.\n(C) Immunostaining of cell death (aCAS3) in SHAM and ADX mice 3 days post-RTX. Hair follicles marked by PCAD. Graph quantifies the percent of hair follicles damaged at 3 days post-RTX injection (n = 4 mice per condition, 25 hair follicles per mouse).\n(D) Whole-mount staining of sympathetic neuron (TH) innervation near hair follicle bulbs (PCAD) in undamaged and damaged regions of skin 5 days following RTX injection. Sympathetic fiber density is measured as the total length of TH⁺ fibers per unit area in matched skin regions from damaged and undamaged sites (n = 5–6 regions per condition).\n(E) NE in blood following restraint or injection with RTX (n = 3).\n(F) Immunostaining for activation of sympathetic neurons (cFOS) in control, after restraint, and after RTX injection. Graph quantifies the percent of cFOS+ neurons in sympathetic ganglia (n = 9–10 ganglia from 3 different mice).\n(G) Hair loss occurs at the site of sympathetic activation in DBH-Cre;CAG-LSL-Gq-DREADD mice.\n(H) Local injection of NE causes hair loss.\n(I) Immunofluorescence staining for cell death (aCAS3) in hair follicles of mice intradermally injected with vehicle or NE. Graph shows quantification of cell death per hair follicle bulb (n = 74–105 hair follicles total from 3 to 4 different mice).\n(J) Immunostaining for cell death (aCAS3) in hair follicles (PCAD) within vehicle or propranolol (10 mg/kg) injection sites. Graph is quantification of damaged hair follicles in vehicle- and propranolol-injected mice (n = 2–3 mice per condition, 20 hair follicles per mouse).\n(K) Doxycycline (DOX) treatment in telogen hair follicles activates expression of Cre to trigger recombination and expression of the H2BGFP reporter to conditionally label the anagen hair follicle.\n(L) Relative Adrb2 mRNA levels in hair follicles FACS isolated from control vs. Adrb2-HF-cKO mice. Scale bar: 100 μm (C, F, and J), 50 μm (D), 25 μm (K), and 10 μm (I). Statistics: unpaired two-tailed t test assuming Gaussian distribution with 95% confidence interval (A, C, D, I, J, and L) and one-way ANOVA with post hoc Tukey test (E and F), ns, not significant, ∗p < 0.05, ∗∗p < 0.01, ∗∗∗p < 0.001, ∗∗∗∗p < 0.0001. Error bars in (A), (I), and (J) show mean ± SEM; (D)–(F) and (L) show mean ± SD."
};

test('statistical footer retains complete method-to-Panel clauses without making references into sections', () => {
  const footer = 'Statistics: unpaired two-tailed t test (A), two-way ANOVA with post hoc Tukey test (B).';
  const caption = '(A) Measurement A. (B) Measurement B. ' + footer;
  for (const panel of ['A', 'B']) {
    const result = planner.extractFigurePanelCaption(caption, panel);
    assert.equal(result.targetText, `(${panel}) Measurement ${panel}.`);
    assert.equal(result.sharedLegend, footer);
    assert.ok(result.combined.includes(footer));
    assert.ok(!result.combined.includes(`Measurement ${panel === 'A' ? 'B' : 'A'}`));
  }
});

for (const id of ['fig3', 'fig6', 'figs2']) {
  test(`${id} actual caption preserves complete statistics and scale-bar tail, without cross-Panel fragments`, () => {
    const caption = realCaptions[id];
    const start = caption.search(/Scale bars?:/);
    assert.ok(start > 0);
    const footer = caption.slice(start).replace(/\s+/gu, ' ').trim();
    const a = planner.extractFigurePanelCaption(caption, 'A');
    assert.equal(a.sharedLegend, footer);
    assert.equal(a.targetText, caption.split('\n(')[0]);
    const context = analysis.buildFigureContext({ caption, figureLabel: id, contextParagraphs: [] }, ['A', 'B', 'C', 'D']);
    assert.equal(context.shared_legend, footer);
    assert.equal(context.panel_caption_slices.A, a.targetText);
    for (const panel of ['A', 'B', 'C', 'D']) {
      assert.doesNotMatch(context.panel_caption_slices[panel], /Statistics:|Scale bars?:|post hoc Tukey|one-way ANOVA/u);
    }
  });
}

test('statistics-only footer without a heading keeps original grouped references and Unicode methods', () => {
  const footer = 'Unpaired two-tailed t test (A and C–E); two-way ANOVA with Šídák’s test (B, F and G).';
  const caption = '(A–G) Measured fluorescence. ' + footer;
  const result = planner.extractFigurePanelCaption(caption, 'D');
  assert.equal(result.targetText, '(A–G) Measured fluorescence.');
  assert.equal(result.sharedLegend, footer);
});

test('error-bar ranges, including split parentheses, stay as one original shared statement', () => {
  const footer = 'Error bars in (B)–(D) show mean ± SD; (F) and (G) show mean ± SEM.';
  const caption = '(A–G) Assay descriptions. ' + footer;
  const result = planner.extractFigurePanelCaption(caption, 'D');
  assert.equal(result.targetText, '(A–G) Assay descriptions.');
  assert.equal(result.sharedLegend, footer);
});

test('internal cross-references do not create new sections or duplicate another Panel body', () => {
  const caption = 'Figure 1. (A and C) Compare the images in (B). (B) Independent validation.';
  assert.equal(planner.extractFigurePanelCaption(caption, 'A').targetText,
    '(A and C) Compare the images in (B).');
  assert.equal(planner.extractFigurePanelCaption(caption, 'B').targetText, '(B) Independent validation.');
});

test('adjacent legitimate Panel headings need not be separated by a sentence stop', () => {
  const caption = '(A) Representative images (B–C) Quantification of treated cohorts (D) Controls';
  assert.equal(planner.extractFigurePanelCaption(caption, 'B').targetText,
    '(B–C) Quantification of treated cohorts');
  assert.equal(planner.extractFigurePanelCaption(caption, 'D').targetText, '(D) Controls');
});

test('a statistical footer may put its Panel references before the named tests', () => {
  const footer = 'Statistics: (A) unpaired two-tailed t test; (B–C) one-way ANOVA with Tukey’s test.';
  const caption = '(A) Measurement. (B–C) Validation. ' + footer;
  assert.equal(planner.extractFigurePanelCaption(caption, 'B').targetText, '(B–C) Validation.');
  assert.equal(planner.extractFigurePanelCaption(caption, 'A').sharedLegend, footer);
});

test('full-width grouped section labels preserve every scientific character and original footer', () => {
  const footer = 'Scale bars: 10 μm （Ａ，Ｃ–Ｄ）, 25 μm （Ｂ）. Statistics: Šídák’s test （Ａ，Ｃ–Ｄ）; t test （Ｂ）.';
  const result = planner.extractFigurePanelCaption('Figure 1. （Ａ，Ｃ–Ｄ） Ca²⁺ > 10², p < 0.05. （Ｂ） Control. ' + footer, 'C');
  assert.equal(result.targetText, '（Ａ，Ｃ–Ｄ） Ca²⁺ > 10², p < 0.05.');
  assert.equal(result.sharedLegend, 'Figure 1. ' + footer);
});

test('legitimate Nature inline section labels remain separate from footer references', () => {
  const footer = 'Scale bars: 10 μm (a), 25 μm (b–d). Statistics: t test (a); ANOVA (b–d).';
  const result = planner.extractFigurePanelCaption('Figure 1. a, Overview. b–d, Validation. ' + footer, 'C');
  assert.equal(result.targetText, 'b–d, Validation.');
  assert.equal(result.sharedLegend, 'Figure 1. ' + footer);
});

test('Panel-local methods before a later Panel stay local and unspecified statistics are not invented', () => {
  const caption = '(A) Comparison. Statistics: unpaired t test. (B) Another measurement.';
  assert.equal(planner.extractFigurePanelCaption(caption, 'A').targetText,
    '(A) Comparison. Statistics: unpaired t test.');
  const b = planner.extractFigurePanelCaption(caption, 'B');
  assert.equal(b.targetText, '(B) Another measurement.');
  assert.equal(b.sharedLegend, '');
});

test('an absent requested Panel never falls back to a different Panel in a labelled caption', () => {
  const result = planner.extractFigurePanelCaption('Figure 1. (A) Treatment. (B) Control.', 'Z');
  assert.equal(result.targetText, '');
  assert.equal(result.combined, 'Figure 1.');
});

test('unlabelled captions retain the original fallback text', () => {
  const caption = 'Unlabelled plot of Ca²⁺ with p < 0.05; statistical test not supplied.';
  assert.equal(planner.extractFigurePanelCaption(caption, 'A').targetText, caption);
});

test('long shared legend does not truncate a newly appended footer in batch or single-Panel compilers', () => {
  const prefix = 'Figure 1. ' + 'Shared non-Panel source context. '.repeat(95);
  const footer = 'Statistics: unpaired t test (A); two-way ANOVA with Šídák’s test (B).';
  const caption = prefix + '(A) Ca²⁺ measurement. (B) Validation. ' + footer;
  const evidence = planner.extractFigurePanelCaption(caption, 'A');
  assert.ok(evidence.sharedLegend.length > 2400);
  assert.equal(evidence.sharedLegend, prefix.trim() + ' ' + footer);
  assert.ok(evidence.combined.includes(footer));
  const input = { caption, figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'],
    panelId: 'A', contextParagraphs: [], captionEvidence: evidence };
  for (const prompt of [analysis.compileFigurePanelBatchPrompt(input),
    analysis.compileFigurePanelInterpretationPrompt(input), analysis.compilePanelFollowupPrompt(input)]) {
    const payload = JSON.parse(prompt.userPrompt);
    assert.equal(payload.figure_context?.shared_legend || payload.shared_legend, evidence.sharedLegend);
  }
});

test('oversized retained context is rejected by the existing Panel input budget instead of cutting its footer', () => {
  const caption = 'Figure 1. ' + '共有统计说明。'.repeat(1100) +
    '(A) Measurement. (B) Control. Statistics: t test (A); ANOVA (B).';
  const evidence = planner.extractFigurePanelCaption(caption, 'A');
  assert.ok(evidence.sharedLegend.endsWith('Statistics: t test (A); ANOVA (B).'));
  const plans = planner.buildFigurePanelPlans({ caption, figureId: 'figure-1', panelId: 'A',
    contextParagraphs: [], contextWindowTokens: 8192, outputTokens: 2048, imageVariants: [] });
  assert.deepEqual(plans, []);
});

test('new prompt versions distinguish subsequent Panel cache keys and whole-Figure route bindings', () => {
  assert.equal(planner.FIGURE_PANEL_PROMPT_VERSION, '5-caption-footer-boundaries');
  assert.equal(analysis.FIGURE_ANALYSIS_PROMPT_VERSION, '14-bounded-evidence-titles');
  const input = { figureId: 'figure-1', panelId: 'A', figureHash: 'same-original-caption' };
  assert.notEqual(planner.buildFigurePanelCacheKey(input),
    planner.buildFigurePanelCacheKey({ ...input, promptVersion: '4-verbatim-scientific-source' }));
  const routerSource = fs.readFileSync(path.join(__dirname, '../core/background-router.js'), 'utf8');
  const start = routerSource.indexOf('function figureRouteRequestBehavior(');
  const end = routerSource.indexOf('\n    async function strongFigureRouteDigest', start);
  assert.ok(start > 0 && end > start);
  const instantiate = shared => Function('shared', 'isPlainObject',
    `return (${routerSource.slice(start, end).trim()});`)(shared, v => Boolean(v && typeof v === 'object'));
  const fresh = { ...analysis, ...planner };
  const old = { ...fresh, FIGURE_ANALYSIS_PROMPT_VERSION: '11-panel-scientific-fidelity',
    FIGURE_PANEL_PROMPT_VERSION: '4-verbatim-scientific-source' };
  const route = { providerId: 'deepseek', model: 'synthetic-model', config: {} };
  assert.notDeepEqual(instantiate(fresh)({}, route, 'figure_walkthrough'),
    instantiate(old)({}, route, 'figure_walkthrough'));
  assert.equal(instantiate(fresh)({}, route, 'figure_walkthrough').implementationVersion,
    instantiate(old)({}, route, 'figure_walkthrough').implementationVersion);
});
