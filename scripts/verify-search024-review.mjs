// Independent-review regressions: real geometry, no extension/user data/network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(output), 'Use a new output directory');
fs.mkdirSync(output, { recursive: true });
const report = { sourceHashes: {}, cases: [], realModelCalls: 0, simulatedModelCalls: 0 };
for (const name of ['core/article-extractor.js', 'core/semantic-find-dom.js']) {
  const bytes = fs.readFileSync(path.join(root, name));
  fs.writeFileSync(path.join(output, path.basename(name)), bytes);
  report.sourceHashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><style>[aria-hidden="true"], [data-state="closed"] { display:none }
  .clipped { width:120px;height:20px;overflow:hidden;font:16px/20px monospace }
  .clipped.scroll {overflow:auto}.clipped.scrollbar {overflow:scroll}
  #middle{white-space:pre;width:70px;text-indent:-40px}
  </style><p>Existing source.</p><p id="empty"></p><p id="blank">   </p>
  <p id="hidden-empty" hidden></p><div id="plugin" data-sci-plugin-ui></div><div contenteditable id="editor"></div>
  <p id="aria" aria-hidden="false">ARIA source.</p><p id="data" data-state="open">Data source.</p>
  <div id="clip" class="clipped">VISIBLE-FIRST HIDDEN-SECOND HIDDEN-THIRD HIDDEN-FOURTH</div>
  <div id="scroll" class="clipped scroll">SCROLL-FIRST SCROLL-SECOND SCROLL-THIRD SCROLL-FOURTH</div>
  <div id="scrollbar" class="clipped scrollbar">BAR-FIRST BAR-SECOND BAR-THIRD BAR-FOURTH</div>
  <div id="middle" class="clipped">0123456789ABCDEFGHIJK</div>
  <p>Inline <span id="inline" style="overflow:hidden">INLINE-VISIBLE</span> tail.</p>
  <p>Contents <span id="contents" style="display:contents;overflow:hidden">CONTENTS-VISIBLE</span> tail.</p>
  <span id="inline-block" class="clipped" style="display:inline-block">VISIBLE-FIRST HIDDEN-SECOND</span>
  <div id="zero-width" style="width:0;overflow:hidden">ZERO-WIDTH-HIDDEN</div>
  <p id="offscreen" style="margin-top:1500px">Offscreen source stays.</p>`);
  await page.addScriptTag({ path: path.join(output, 'article-extractor.js') });
  await page.addScriptTag({ path: path.join(output, 'semantic-find-dom.js') });
  report.cases = await page.evaluate(async () => {
    const cases = [];
    const take = () => SciLLM.createSemanticFindDomSnapshot(document, { normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets });
    const row = (name, passed, detail) => cases.push({ name, passed, detail });
    const normalize = text => text.replace(/\s+/gu, ' ').trim();
    // Separate deliberately slow oracle for these tiny fixtures: inspect each
    // character directly rather than copying the production bisection strategy.
    const oracle = element => {
      const node = element.firstChild; const box = element.getBoundingClientRect();
      let expected = ''; const indices = [];
      for (let index = 0; index < node.length; index++) {
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
        if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 &&
            rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom)) {
          expected += node.data[index]; indices.push(index);
        }
      }
      return { expected: normalize(expected), indices };
    };
    for (const id of ['empty', 'blank', 'hidden-empty', 'plugin', 'editor']) {
      const element = document.getElementById(id);
      if (!element.firstChild) element.append(document.createTextNode(''));
      const snapshot = take(); let invalidations = 0; snapshot.watch(() => invalidations++);
      element.firstChild.nodeValue = `Dynamic ${id} source.`;
      const current = snapshot.isCurrent();
      const shouldInvalidate = ['empty', 'blank'].includes(id);
      row(`characterData_${id}`, current === !shouldInvalidate && invalidations === Number(shouldInvalidate),
        { current, invalidations }); snapshot.disconnect();
    }
    for (const [id, attr, hidden, shown] of [['aria', 'aria-hidden', 'true', 'false'], ['data', 'data-state', 'closed', 'open']]) {
      for (const [direction, value] of [['hide', hidden], ['show', shown]]) {
        const snapshot = take(); document.getElementById(id).setAttribute(attr, value);
        row(`${attr}_${direction}`, snapshot.isCurrent() === false); snapshot.disconnect();
      }
    }
    const noise = take(); let noiseInvalidations = 0; let noiseRemaps = 0;
    noise.watch(() => noiseInvalidations++, () => noiseRemaps++);
    for (let index = 0; index < 30; index++) document.getElementById('aria').setAttribute('data-pulse', String(index));
    row('irrelevant_attribute_noise', noise.isCurrent() && noiseInvalidations === 0 && noiseRemaps === 0,
      { invalidations: noiseInvalidations, remaps: noiseRemaps, counters: { ...noise.counters } }); noise.disconnect();
    const snapshot = take();
    for (const id of ['clip', 'middle', 'inline-block']) {
      const element = document.getElementById(id); const expected = oracle(element);
      const paragraphs = snapshot.paragraphs.filter(p => snapshot.bindings.get(p.paragraphId).element === element);
      const captured = paragraphs.map(p => p.text).join(' ');
      const ranges = paragraphs.flatMap(p => snapshot.ranges({ ...p, start: 0, end: p.text.length }));
      row(`${id}_visible_text`, captured === expected.expected, { captured, ...expected });
      row(`${id}_exact_ranges`, normalize(ranges.map(range => range.toString()).join('')) === expected.expected &&
        ranges.every(range => range.startContainer === element.firstChild && range.endContainer === element.firstChild),
        ranges.map(range => ({ start: range.startOffset, end: range.endOffset, text: range.toString() })));
    }
    for (const id of ['inline', 'contents']) {
      const source = document.getElementById(id).textContent;
      row(`${id}_not_a_clip_box`, snapshot.paragraphs.some(p => p.text.includes(source)));
    }
    row('zero_width_block_still_clips', !snapshot.paragraphs.some(p => p.text.includes('ZERO-WIDTH-HIDDEN')));
    for (const id of ['scroll', 'scrollbar', 'offscreen']) {
      const element = document.getElementById(id);
      row(`${id}_retained`, snapshot.paragraphs.some(p => p.text === normalize(element.textContent)));
    }
    const before = snapshot.paragraphs.find(p => p.text.includes('VISIBLE-FIRST'))?.text;
    document.getElementById('clip').style.height = '100px';
    row('clip_expansion_invalidates', snapshot.isCurrent() === false, { before });
    snapshot.disconnect();
    const expanded = take();
    row('clip_expansion_searchable', expanded.paragraphs.some(p => p.text === 'VISIBLE-FIRST HIDDEN-SECOND HIDDEN-THIRD HIDDEN-FOURTH'));
    expanded.disconnect();
    return cases;
  });
  await page.screenshot({ path: path.join(output, 'review-fixture.png'), fullPage: true });
  report.passed = report.cases.filter(item => item.passed).length;
  report.failed = report.cases.filter(item => !item.passed).length;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, output }));
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter(item => !item.passed)));
} finally { await browser.close(); }
