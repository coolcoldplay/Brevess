// SEARCH-024: isolated real-layout regressions, public source replay, zero API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(output), 'Use a fresh output directory');
fs.mkdirSync(output, { recursive: true });
const report = { sourceHashes: {}, cases: [], realModelCalls: 0 };
for (const name of ['core/article-extractor.js', 'core/semantic-find-dom.js', 'semantic-find-content.js']) {
  const bytes = fs.readFileSync(path.join(root, name));
  fs.writeFileSync(path.join(output, path.basename(name)), bytes);
  report.sourceHashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 780 } });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('https://pubmed.ncbi.nlm.nih.gov/?term=fixture');
  const fixture = `<!doctype html><style>
    .full-view-snippet{display:none}.short-view-snippet{display:block}
    .docsum-snippet{max-height:40px;overflow:hidden}.expanded .docsum-snippet{max-height:none}
    .expanded .full-view-snippet{display:block}.expanded .short-view-snippet{display:none}
    #return-top{display:none;position:fixed;bottom:0}body.scrolled #return-top{display:block}
  </style><p id="source">Existing stable source.</p><article class="full-docsum" data-rel-pos="1">
  <a class="docsum-title" href="/123/">Loaded result title</a>
  <div class="docsum-snippet"><div class="full-view-snippet">Loaded abstract prefix. Folded tail evidence is present in the DOM. <span hidden>HIDDEN-NON-ABSTRACT</span><span style="display:inline-block;width:0;overflow:hidden">CLIPPED-NON-ABSTRACT</span><input value="INPUT-SECRET"><span data-sci-plugin-ui>PLUGIN-SECRET</span><span contenteditable>EDITOR-SECRET</span></div><div class="short-view-snippet">Loaded abstract prefix. …</div></div></article>
  <aside hidden>OTHER-HIDDEN</aside><p style="margin-top:2000px">Offscreen stable source.</p><button id="return-top">Back to top</button>`;
  const load = async html => {
    await page.setContent(html);
    await page.addScriptTag({ path: path.join(output, 'article-extractor.js') });
    await page.addScriptTag({ path: path.join(output, 'semantic-find-dom.js') });
  };
  await load(fixture);
  report.cases.push(...await page.evaluate(async () => {
    const rows = []; const row = (name, passed, detail) => rows.push({ name, passed, detail });
    const take = () => SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    const snapshot = take(); let stale = 0; let added = 0;
    snapshot.watch(() => stale++, () => {}, () => added++);
    const text = snapshot.paragraphs.map(p => p.text).join('\n');
    row('folded_loaded_tail_in_corpus', text.includes('Folded tail evidence is present in the DOM.'), text);
    row('short_long_summary_deduplicated', (text.match(/Loaded abstract prefix/gu) || []).length === 1, text);
    row('excluded_contents_not_in_corpus', !/HIDDEN-NON-ABSTRACT|INPUT-SECRET|PLUGIN-SECRET|EDITOR-SECRET|OTHER-HIDDEN/u.test(text));
    row('clipped_descendant_stays_excluded_inside_collapsed_summary', !text.includes('CLIPPED-NON-ABSTRACT'), text);
    const paragraph = snapshot.paragraphs.find(p => p.text.includes('Folded tail evidence'));
    if (paragraph) {
      const quote = 'Folded tail evidence is present in the DOM.';
      const hit = { ...paragraph, text: quote, start: paragraph.text.indexOf(quote), end: paragraph.text.indexOf(quote) + quote.length };
      const exactBefore = snapshot.ranges(hit).map(range => range.toString()).join('');
      const revealed = snapshot.reveal?.(hit);
      const visible = snapshot.ranges(hit).some(range => [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0));
      row('folded_hit_revealed_exactly_and_stays_current', exactBefore === quote && revealed && visible && snapshot.isCurrent(), { exactBefore, revealed, visible });
    } else row('folded_hit_revealed_exactly_and_stays_current', false, 'tail absent');
    document.body.classList.add('scrolled'); window.scrollTo(0, 1700);
    row('scroll_reveals_backtop_keeps_existing_results', snapshot.isCurrent() && stale === 0, { stale });
    for (const expanded of [true, false, true, false]) {
      document.querySelector('article').classList.toggle('expanded', expanded);
      row(`summary_toggle_${expanded}_${rows.length}_stable`, snapshot.isCurrent());
    }
    const midScroll = take();
    const buttonParagraph = midScroll.paragraphs.find(p => p.text === 'Back to top');
    const buttonHit = buttonParagraph && { ...buttonParagraph, start: 0, end: buttonParagraph.text.length };
    document.body.classList.remove('scrolled'); window.scrollTo(0, 0);
    row('already_indexed_backtop_hiding_preserves_snapshot', midScroll.isCurrent());
    row('hidden_original_hit_is_not_focusable', buttonHit && midScroll.isVisible?.(buttonHit) === false);
    document.body.classList.add('scrolled'); window.scrollTo(0, 1700);
    row('already_indexed_backtop_showing_again_preserves_snapshot', midScroll.isCurrent());
    row('shown_original_hit_is_focusable_again', buttonHit && midScroll.isVisible?.(buttonHit) === true);
    midScroll.disconnect();
    const fresh = take(); let freshAdded = 0; fresh.watch(() => {}, () => {}, () => freshAdded++);
    const card = document.createElement('article'); card.textContent = 'New lazy-loaded card.'; document.body.append(card);
    row('added_card_keeps_old_snapshot_and_notifies', fresh.isCurrent() && freshAdded === 1 && !fresh.paragraphs.some(p => p.text.includes('New lazy')), { freshAdded });
    card.remove(); row('unsearched_card_removal_keeps_results', fresh.isCurrent()); fresh.disconnect(); snapshot.disconnect();
    const changed = take(); document.getElementById('source').firstChild.nodeValue = 'Changed real source.';
    row('indexed_source_change_is_stale', !changed.isCurrent()); changed.disconnect();
    const deleted = take(); document.getElementById('source').remove();
    row('indexed_source_deletion_is_stale', !deleted.isCurrent()); deleted.disconnect();
    const hidden = take(); document.querySelector('article.full-docsum').hidden = true;
    row('hidden_whole_card_keeps_unchanged_original_source', hidden.isCurrent());
    document.querySelector('.full-view-snippet').firstChild.nodeValue += ' Hidden edit.';
    row('editing_hidden_indexed_source_still_stales', !hidden.isCurrent()); hidden.disconnect();
    document.querySelector('article.full-docsum').hidden = false;
    const edited = take(); document.querySelector('.full-view-snippet').firstChild.nodeValue += ' Modified abstract.';
    row('indexed_folded_summary_change_still_stales', !edited.isCurrent()); edited.disconnect();
    const source = document.createElement('p'); source.append('The effect ', 'increases.'); document.body.append(source);
    const structured = take(); const insert = document.createElement('div'); insert.textContent = 'never'; source.insertBefore(insert, source.lastChild);
    row('nested_new_word_between_original_nodes_is_stale', !structured.isCurrent()); structured.disconnect();
    return rows;
  }));
  await page.goto('https://example.org/generic');
  await load(fixture);
  report.cases.push(await page.evaluate(() => {
    const snapshot = SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    const passed = !snapshot.paragraphs.some(p => p.text.includes('Folded tail evidence'));
    snapshot.disconnect(); return { name: 'generic_hidden_content_has_no_pubmed_exception', passed };
  }));
  await page.goto('https://pubmed.ncbi.nlm.nih.gov/?term=replay');
  // This public sample contains two abbreviated snippets per card, not full remote abstracts.
  await load(fs.readFileSync(path.join(root, 'output/search024-pubmed-source-02/pubmed-replay.html'), 'utf8'));
  report.cases.push(...await page.evaluate(() => {
    const snapshot = SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    const normalize = text => text.replace(/\s+/gu, ' ').trim();
    const cards = [...document.querySelectorAll('article.full-docsum')];
    const entries = cards.map(card => {
      const long = normalize(card.querySelector('.full-view-snippet')?.textContent || '');
      const short = normalize(card.querySelector('.short-view-snippet')?.textContent || '');
      return { long, short, foundLong: snapshot.paragraphs.some(p => p.text === long), foundShort: snapshot.paragraphs.some(p => p.text === short) };
    });
    const rows = [{ name: 'actual_pubmed_longest_loaded_snippet_once_per_card', passed: entries.length === 10 && entries.every(e => e.foundLong && (e.long === e.short || !e.foundShort)), detail: entries }];
    document.body.setAttribute('data-scroll-decoration', '1'); window.scrollTo(0, 1800);
    rows.push({ name: 'actual_pubmed_irrelevant_attribute_and_scroll_stable', passed: snapshot.isCurrent() });
    snapshot.disconnect(); return rows;
  }));
  await page.screenshot({ path: path.join(output, 'pubmed-followup.png'), fullPage: false });
  report.passed = report.cases.filter(row => row.passed).length;
  report.failed = report.cases.length - report.passed;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output }));
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter(row => !row.passed)));
} finally { await browser.close(); }
