// Real Edge DOM geometry for incremental SEARCH-024, no live model or user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(output), 'Use a new output directory'); fs.mkdirSync(output, { recursive: true });
const report = { cases: [], sourceHashes: {}, realModelCalls: 0 };
for (const name of ['core/article-extractor.js', 'core/semantic-find-dom.js', 'semantic-find-content.js']) {
  const bytes = fs.readFileSync(path.join(root, name)); fs.writeFileSync(path.join(output, path.basename(name)), bytes);
  report.sourceHashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 780 } });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('https://pubmed.ncbi.nlm.nih.gov/?term=local-replay');
  await page.setContent(fs.readFileSync(path.join(root, 'output/search024-pubmed-source-02/pubmed-replay.html'), 'utf8'));
  await page.addScriptTag({ path: path.join(output, 'article-extractor.js') });
  await page.addScriptTag({ path: path.join(output, 'semantic-find-dom.js') });
  report.cases = await page.evaluate(() => {
    const rows = []; const row = (name, passed, detail) => rows.push({ name, passed, detail });
    const take = options => SciLLM.createSemanticFindDomSnapshot(document,
      { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets, ...options });
    const original = document.querySelector('article.full-docsum');
    const snapshot = take(); const before = JSON.stringify(snapshot.paragraphs); let batches = 0;
    snapshot.watch(() => {}, () => {}, () => batches++);
    const added = original.cloneNode(true);
    added.querySelector('.docsum-title').textContent = 'An incrementally loaded PubMed result title';
    added.querySelector('.full-view-snippet').textContent = 'Incremental loaded abstract. Unique folded tail evidence belongs to this card.';
    added.querySelector('.short-view-snippet').textContent = 'Incremental loaded abstract. …';
    original.parentElement.append(added);
    const first = snapshot.drainAdditionalParagraphs();
    row('new_card_admitted_without_invalidating_original', snapshot.isCurrent() && JSON.stringify(snapshot.paragraphs) === before && batches === 1);
    row('new_card_uses_complete_loaded_long_snippet_once', first.some(p => p.text.includes('Unique folded tail evidence')) &&
      first.filter(p => p.text.includes('Incremental loaded abstract')).length === 1 && !first.some(p => p.text === 'Incremental loaded abstract. …'), first);
    const source = first.find(p => p.text.includes('Unique folded tail evidence'));
    const hit = source && { ...source, start: 0, end: source.text.length };
    row('incremental_hidden_summary_has_exact_range', hit && snapshot.ranges(hit).map(r => r.toString()).join('') === hit.text);
    row('incremental_hidden_summary_reveals_without_stale', hit && snapshot.reveal(hit) && snapshot.isVisible(hit) && snapshot.isCurrent());
    if (hit) { CSS.highlights.set('addition-proof', new Highlight(...snapshot.ranges(hit))); }
    row('repeated_drain_does_not_resend', snapshot.drainAdditionalParagraphs().length === 0);
    added.setAttribute('data-unrelated-noise', 'one');
    row('attribute_noise_does_not_readmit_nodes', snapshot.isCurrent() && snapshot.drainAdditionalParagraphs().length === 0 && batches === 1);
    const duplicates = [];
    for (let index = 0; index < 2; index++) {
      const p = document.createElement('p'); p.textContent = 'Same new text at a distinct location.'; document.body.append(p);
      duplicates.push(snapshot.drainAdditionalParagraphs());
    }
    row('same_text_new_locations_get_distinct_ids', duplicates.every(batch => batch.length === 1) &&
      duplicates[0][0].paragraphId !== duplicates[1][0].paragraphId && batches === 3);
    const allIds = [...first, ...duplicates.flat()].map(p => p.paragraphId);
    row('new_ids_never_collide_with_old', new Set(allIds).size === allIds.length &&
      allIds.every(id => !snapshot.paragraphs.some(p => p.paragraphId === id)));
    added.querySelector('.full-view-snippet').firstChild.nodeValue += ' Changed source.';
    row('admitted_incremental_source_change_retires_only_its_hit', snapshot.isCurrent() &&
      snapshot.isHitCurrent(hit) === false && snapshot.ranges(hit).length === 0);
    const replacement = snapshot.drainAdditionalParagraphs();
    row('changed_incremental_source_uses_new_id_and_delta', replacement.some(p => p.text.endsWith('Changed source.') && p.paragraphId !== source.paragraphId));
    snapshot.disconnect();
    const closed = take(); let afterClose = 0; closed.watch(() => {}, () => {}, () => afterClose++); closed.disconnect();
    document.body.append(document.createTextNode('Added after close.'));
    let error; try { closed.drainAdditionalParagraphs(); } catch (value) { error = value.code; }
    row('close_stops_observer_and_drain', afterClose === 0 && error === 'SEMANTIC_FIND_SOURCE_STALE');
    return rows;
  });
  await page.screenshot({ path: path.join(output, 'incremental-pubmed.png'), fullPage: false });
  report.passed = report.cases.filter(row => row.passed).length; report.failed = report.cases.length - report.passed;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output }));
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter(row => !row.passed)));
} finally { await browser.close(); }
