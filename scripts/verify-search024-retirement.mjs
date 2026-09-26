// Same controlled HTML and mutation as frontend scenario 05, using real Edge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..'); const output = path.resolve(process.argv[2]);
const source = process.argv[3] ? path.resolve(process.argv[3]) : root;
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const report = { cases: [], sourceHashes: {}, realModelCalls: 0, source };
for (const file of ['core/article-extractor.js', 'core/semantic-find-dom.js', 'semantic-find-content.js']) {
  const from = fs.existsSync(path.join(source, file)) ? path.join(source, file) :
    fs.existsSync(path.join(source, path.basename(file))) ? path.join(source, path.basename(file)) : path.join(root, file);
  const bytes = fs.readFileSync(from); fs.writeFileSync(path.join(output, path.basename(file)), bytes);
  report.sourceHashes[file] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const genericHTML = `<!doctype html><meta charset="utf-8"><title>Controlled dynamic feed — not live Bilibili</title>
<style>body{font:16px/1.6 system-ui;margin:30px}article{min-height:180px;border-bottom:1px solid #ddd;padding:16px}header{position:sticky;top:0;background:white}h2{font-size:20px}.decoration{position:fixed;bottom:10px;right:10px}::highlight(retirement-proof){background:gold}</style>
<header>Controlled feed <span id="views">0</span></header><main>${Array.from({ length: 8 }, (_, i) => `<article class="feed-card"><h2 class="feed-title">Loaded feed entry ${i + 1} has stable source text.</h2><p>Previously loaded content ${i + 1} remains searchable.</p></article>`).join('')}</main>
<div hidden>PRIVATE_HIDDEN_EXCLUDED</div><input type="password" value="PASSWORD_EXCLUDED"><div contenteditable>EDITABLE_EXCLUDED</div>`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await page.route('**/*', route => route.abort()); await page.setContent(genericHTML);
  await page.addScriptTag({ path: path.join(output, 'article-extractor.js') });
  await page.addScriptTag({ path: path.join(output, 'semantic-find-dom.js') });
  report.cases = await page.evaluate(() => {
    const rows = []; const row = (name, passed, detail) => rows.push({ name, passed, detail });
    const snapshot = SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    let invalidations = 0; let refreshes = 0; snapshot.watch(() => invalidations++, () => refreshes++);
    const hits = snapshot.paragraphs.map(p => ({ ...p, start: 0, end: p.text.length }));
    const counter = hits.find(hit => hit.text === 'Controlled feed 0');
    const stable = hits.find(hit => hit.text.includes('Loaded feed entry 2'));
    row('initial_hidden_and_editable_exclusions', !hits.some(hit => /PRIVATE_HIDDEN_EXCLUDED|PASSWORD_EXCLUDED|EDITABLE_EXCLUDED/.test(hit.text)));
    document.getElementById('views').textContent = '23';
    const card = document.createElement('article'); card.className = 'feed-card'; card.innerHTML = '<h2 class="feed-title">Newly loaded entry awaits a new search.</h2><p>New content was not in the old model request.</p>'; document.querySelector('main').append(card);
    const current = snapshot.isCurrent();
    row('scenario05_counter_plus_append_keeps_document', current && invalidations === 0);
    row('scenario05_unchanged_source_still_current', snapshot.isHitCurrent?.(stable) === true && snapshot.ranges(stable).map(r => r.toString()).join('') === stable.text);
    row('scenario05_retired_counter_cannot_highlight_new_words', snapshot.isHitCurrent?.(counter) === false && snapshot.ranges(counter).length === 0);
    let delta = []; try { delta = snapshot.drainAdditionalParagraphs(); } catch (_) {}
    row('scenario05_new_counter_and_card_only_in_delta', delta.length === 3 && delta.some(p => p.text === 'Controlled feed 23') &&
      delta.some(p => p.text === 'Newly loaded entry awaits a new search.') && !delta.some(p => p.text.includes('Loaded feed entry 2')), delta);
    const deltaHits = delta.map(p => ({ ...p, start: 0, end: p.text.length }));
    const visible = [...hits, ...deltaHits].filter(hit => snapshot.isHitCurrent?.(hit));
    CSS.highlights.set('retirement-proof', new Highlight(...visible.flatMap(hit => snapshot.ranges(hit))));
    row('late_original_result_is_filtered_while_new_results_can_paint', visible.some(hit => hit.paragraphId === stable.paragraphId) &&
      visible.every(hit => hit.paragraphId !== counter.paragraphId) && visible.some(hit => hit.text === 'Controlled feed 23'));
    const transient = document.createElement('p'); transient.textContent = 'Temporary queued source.'; document.body.append(transient); snapshot.isCurrent(); transient.remove();
    let remaining = []; try { remaining = snapshot.drainAdditionalParagraphs(); } catch (_) {}
    row('disappeared_pending_text_does_not_clear_existing_results', snapshot.isCurrent() && snapshot.isHitCurrent?.(stable) && remaining.length === 0);
    document.querySelector('article').remove();
    row('deleted_other_card_keeps_remaining_results', snapshot.isCurrent() && snapshot.isHitCurrent?.(stable));
    row('retirement_refresh_callback_delivered', refreshes >= 2);
    snapshot.disconnect(); return rows;
  });
  await page.screenshot({ path: path.join(output, 'scenario05-retirement.png'), fullPage: false });
  report.passed = report.cases.filter(row => row.passed).length; report.failed = report.cases.length - report.passed;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output }));
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter(row => !row.passed)));
} finally { await browser.close(); }
