// Real captured Nature DOM, isolated Edge; no model calls or personal profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const baseline = process.argv.includes('--baseline');
const base = path.join(root, 'output/note016-nature-caption-batch');
fs.mkdirSync(base, { recursive: true });
const html = fs.readFileSync(path.join(root, 'output/note016-nature-source-20260925/nature-live.html'));
const url = 'https://www.nature.com/articles/s41586-025-09984-y';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ bypassCSP: true });
await context.route('**/*', route => route.request().url() === url
  ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
const page = await context.newPage();
const report = { baseline, htmlSha256: crypto.createHash('sha256').update(html).digest('hex'), checks: [], realApiCalls: 0 };
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); };
try {
  await page.goto(url);
  for (const file of ['core/publisher-adapters.js', 'core/article-structure.js', baseline
    ? 'output/note016-nature-caption-batch/article-extractor.before.js' : 'core/article-extractor.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  }
  report.extraction = await page.evaluate(() => {
    const norm = text => String(text).normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const structure = SciLLM.extractArticleStructure(document);
    window.captionSnapshot = { ...structure, documentHash: 'note016-real-document', revision: 7 };
    const records = structure.typedRecords.filter(r => r.recordType === 'figure-caption');
    const expected = [...document.querySelectorAll('.c-article-section__figure')].map(container => ({
      id: container.querySelector('figcaption [id]')?.id,
      title: norm(container.querySelector('figcaption')?.textContent),
      description: norm(container.querySelector('[data-test="bottom-caption"]')?.textContent).replace(/Source data$/u, '').trim()
    })).concat([...document.querySelectorAll('.c-article-supplementary__item')].filter(c =>
      /^Extended Data Fig\./u.test(c.querySelector('h3')?.textContent || '')).map(container => ({
      id: container.id, title: norm(container.querySelector('h3').textContent),
      description: norm(container.querySelector('.c-article-supplementary__description').textContent).replace(/Source data$/u, '').trim()
    })));
    return { bodyCount: structure.paragraphs.length, body: structure.paragraphs.map(p => ({
      paragraphId: p.paragraphId, text: p.text, textHash: p.textHash, sourceKey: p.sourceKey, sourceIdentity: p.sourceIdentity
    })), records, expected,
      fullMatches: expected.map(e => records.filter(r => norm(r.text) === norm(`${e.title} ${e.description}`)).length),
      directTyped: SciLLM.extractArticle(document, { includeTyped: true }).filter(r => r.recordType === 'figure-caption').length };
  });
  fs.writeFileSync(path.join(base, baseline ? 'red-extraction.json' : 'green-extraction.json'), JSON.stringify(report.extraction, null, 2));
  check('13 full captions from actual source HTML', report.extraction.records.length === 13 && report.extraction.fullMatches.every(n => n === 1));
  check('body 213 preserved and both extraction paths agree', report.extraction.bodyCount === 213 && report.extraction.directTyped === 13);
  const before = JSON.parse(fs.readFileSync(path.join(base, 'red-extraction.json'), 'utf8'));
  assert.deepEqual(report.extraction.body, before.body);
  check('all original body text, IDs, source keys and hashes preserved', true);
  check('original main-figure source keys preserved', before.records.every(old => report.extraction.records.some(r => r.sourceKey === old.sourceKey)));
  check('main and ED terminal panels/statistics retained', report.extraction.expected.every(e => e.description.length > 300) && report.extraction.records.every(r => r.text.length > 400));
  const content = fs.readFileSync(path.join(root, baseline ? 'output/note016-nature-caption-batch/content.before.js' : 'content.js'), 'utf8');
  const start = content.indexOf('function focusLiteratureNoteCaptionSource(');
  const end = content.indexOf('\nasync function focusArticleWorkspaceSource(', start);
  await page.addScriptTag({ content: `const activeNativePdfStructure=()=>null; const pdfSemanticArticleChatSnapshot=()=>null;
    const getCanonicalArticleSnapshot=()=>captionSnapshot;
    const clearArticleChatCitationHighlight=()=>document.querySelectorAll('.sci-article-source-focus').forEach(e=>e.classList.remove('sci-article-source-focus'));
    ${content.slice(start, end)};
    window.captionTarget=r=>({kind:'literature-note-caption',documentHash:captionSnapshot.documentHash,navigationRevision:7,paragraphId:r.paragraphId,sourceKey:r.sourceKey,textHash:r.textHash});` });
  report.navigation = await page.evaluate(() => captionSnapshot.typedRecords.filter(r => r.recordType === 'figure-caption').map(r => {
    const ok = focusLiteratureNoteCaptionSource(captionTarget(r));
    const focused = document.querySelectorAll('.sci-article-source-focus');
    return { sourceKey: r.sourceKey, ok, focusedCount: focused.length, text: focused[0]?.textContent, visible: !!focused[0]?.getClientRects().length };
  }));
  check('all 13 captions navigate to one visible original source', report.navigation.every(n => n.ok && n.focusedCount === 1 && n.visible));
  report.rejections = await page.evaluate(() => {
    const source = captionSnapshot.typedRecords.find(r => r.recordType === 'figure-caption');
    const target = captionTarget(source), out = {};
    for (const [key, value] of Object.entries({ documentHash: 'foreign-document', navigationRevision: 6, sourceKey: 'foreign-key', textHash: 'stale-text' })) out[key] = !focusLiteratureNoteCaptionSource({ ...target, [key]: value });
    const original = document.querySelector('.c-article-section__figure');
    const duplicate = original.cloneNode(true); original.after(duplicate);
    out.ambiguous = !focusLiteratureNoteCaptionSource(target); duplicate.remove();
    const description = original.querySelector('[data-test="bottom-caption"]');
    const prior = description.innerHTML; description.textContent = 'Stale caption text';
    out.changedDom = !focusLiteratureNoteCaptionSource(target); description.innerHTML = prior;
    original.setAttribute('data-sci-plugin-ui', ''); out.pluginUi = !focusLiteratureNoteCaptionSource(target); original.removeAttribute('data-sci-plugin-ui');
    original.hidden = true; out.hidden = !focusLiteratureNoteCaptionSource(target); original.hidden = false;
    description.style.display = 'none'; out.hiddenDescription = !focusLiteratureNoteCaptionSource(target); description.style.display = '';
    const external = original.cloneNode(true); external.querySelector('a[href*="/figures/"]').setAttribute('href', '/articles/another-paper/figures/1');
    original.after(external); original.hidden = true; out.foreignFigure = !focusLiteratureNoteCaptionSource(target); original.hidden = false; external.remove();
    const duplicateRecord = structuredClone(source); captionSnapshot.typedRecords.push(duplicateRecord);
    out.duplicateRecord = !focusLiteratureNoteCaptionSource(target); captionSnapshot.typedRecords.pop();
    const ed = document.querySelector('.c-article-supplementary__item');
    const edTitle = ed.querySelector('h3'), edDescription = ed.querySelector('.c-article-supplementary__description');
    const captionForEd = () => SciLLM.articleCaptionSource(edTitle);
    ed.setAttribute('data-sci-plugin-ui', ''); out.edPlugin = !captionForEd(); ed.removeAttribute('data-sci-plugin-ui');
    const descriptionCopy = edDescription.cloneNode(true); ed.append(descriptionCopy);
    out.edAmbiguousDescription = !captionForEd(); descriptionCopy.remove();
    edDescription.hidden = true; out.edHiddenDescription = !captionForEd(); edDescription.hidden = false;
    const link = edTitle.querySelector('a'), href = link.getAttribute('href');
    link.href = '/articles/foreign-paper/figures/6'; out.edForeignLink = !captionForEd(); link.setAttribute('href', href);
    const oldTitle = edTitle.innerHTML; edTitle.textContent = 'Supplementary methods'; out.edUnrelatedLabel = !captionForEd(); edTitle.innerHTML = oldTitle;
    const related = document.createElement('article'); related.className = 'c-article-recommendations-card'; related.append(ed.cloneNode(true)); document.body.append(related);
    out.foreignArticle = !SciLLM.articleCaptionSource(related.querySelector('h3')); related.remove();
    const stable = SciLLM.extractArticleStructure(document);
    out.repeatStable = JSON.stringify(stable.typedRecords.filter(r => r.recordType === 'figure-caption')) === JSON.stringify(captionSnapshot.typedRecords.filter(r => r.recordType === 'figure-caption'));
    return out;
  });
  check('identity, stale DOM, ambiguity, hidden, plugin and foreign source rejected', Object.values(report.rejections).every(Boolean));
  await page.screenshot({ path: path.join(base, 'nature-caption-navigation.png') });
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.message; process.exitCode = 1; }
finally { fs.writeFileSync(path.join(base, baseline ? 'red-report.json' : 'green-report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, output: base }, null, 2));
