// Offline source verification only. Reads the supplied PDF and extracted source;
// does not launch a browser, unlock a profile, or send a model request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadArticle, run } from './verify-qa012-live-neuron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/qa012-user-pdf-20260924');
const read = file => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const articleFile = path.join(out, 'article.json');
const article = read('article.json'), pages = read('page-map.json');
const rows = read('resource-table.json'), virus = read('virus-coverage.json');
const checks = [];
function check(name, test) { test(); checks.push({ name, status: 'PASS' }); }

check('PDF bytes remain the supplied hash', () => assert.equal(digest(path.join(out, 'neuron-original.pdf')),
  '262ce6c85d923017318bc5940d13d681d3a613473b25353e60a507024ba97cf6'));
check('all 55 PDF pages mapped to nonempty retained text', () => {
  assert.equal(pages.length, 55);
  assert.deepEqual([...new Set(article.paragraphs.map(p => p.source.page))], Array.from({ length: 55 }, (_, i) => i + 1));
  for (const page of pages) {
    assert.equal(page.page, pages.indexOf(page) + 1);
    assert.ok(page.rawText && page.paragraphIds.length);
    assert.deepEqual(page.paragraphIds, article.paragraphs.filter(p => p.source.page === page.page).map(p => p.id));
  }
});
check('actual article sections retained', () => {
  for (const section of ['SUMMARY', 'INTRODUCTION', 'RESULTS', 'DISCUSSION', 'REFERENCES', 'Key resources table',
    'EXPERIMENTAL MODEL AND STUDY PARTICIPANT DETAILS', 'AAV vectors', 'Binge-like eating paradigm', 'Fiber photometry',
    'Ex-vivo electrophysiology', 'QUANTIFICATION AND STATISTICAL ANALYSIS', 'Supplemental Figure S14', 'Supplemental Table S1']) {
    assert.ok(article.paragraphs.some(p => p.section.includes(section)), section);
  }
});
check('58 original resource rows retain all three cells', () => {
  assert.equal(rows.length, 58);
  for (const row of rows) {
    assert.ok(row.cells.length === 3 && row.cells.every(Boolean));
    const p = article.paragraphs.find(p => p.id === row.paragraphId);
    assert.equal(p.source.page, row.page);
    for (const cell of row.cells) assert.ok(p.text.includes(cell));
  }
});
check('21 virus supplier rows retained, including duplicate tool at different suppliers', () => {
  assert.equal(virus.resourceTableRows.length, 21);
  const sameName = virus.resourceTableRows.filter(r => r.cells[0] === 'AAV2/8-hSyn-DIO-hM4D(Gi)-mCherry');
  assert.deepEqual(sameName.map(r => r.cells.slice(1)), [['Taitool Bioscience', 'S0193-8'], ['BrainVTA', 'PT-0020']]);
});
const mentionCounts = pages.map(page => ({ page: page.page,
  rawCount: (page.rawText.match(/(?:sc)?AAV/g) || []).length,
  retainedTextCount: article.paragraphs.filter(p => p.source.page === page.page).reduce((n, p) => n + (p.text.match(/(?:sc)?AAV/g) || []).length, 0),
  retainedHeadingCount: page.page === 22 ? 1 : 0 }));
check('all text-layer AAV/scAAV occurrences retained per page (AAV heading moved to section)', () => {
  for (const m of mentionCounts) assert.equal(m.retainedTextCount + m.retainedHeadingCount, m.rawCount, `page ${m.page}`);
});
check('complete AAV method construct list and gRNA targets', () => {
  const p = article.paragraphs.find(p => p.section.endsWith(' — AAV vectors'));
  assert.equal(p.source.page, 22);
  assert.equal((p.text.match(/(?:sc)?AAV\d+\/\d+-/g) || []).length, 21);
  for (const term of ['>10^12', 'Taitool Bioscience', 'BrainVTA', 'Shanghai Umibio', 'ENSMUST00000079278.4',
    'CTGAGGAGAAGCAGACGGATCGG', 'TGAAAGCAAGGAGTGCCAGGCGG', 'TGGAGGAAAGTACATGGTATGGG']) assert.ok(p.text.includes(term), term);
});
check('additional Fiber photometry construct outside main AAV list retained', () => {
  const p = article.paragraphs.find(p => p.text.includes('AAV2/9-hSyn-FLEX-GCaMP6s'));
  assert.equal(p.source.page, 26);
  assert.ok(p.section.endsWith('Fiber photometry'));
});
check('original promoter discrepancy is not normalized away', () => {
  assert.ok(article.paragraphs.some(p => p.source.page === 20 && p.text.includes('AAV2/9-hSyn-fDIO-ChrimsonR-mCherry')));
  assert.ok(article.paragraphs.some(p => p.source.page === 22 && p.text.includes('AAV2/9-hEF1a-fDIO-ChrimsonR-mCherry-ER2-WPRE-pA')));
});
const loaded = loadArticle(articleFile);
check('original QA-012 loader identity and coverage contract', () => {
  assert.equal(loaded.sourceSha256, digest(articleFile));
  assert.ok(loaded.coverage.methodsIds.length && loaded.coverage.resourceIds.length && loaded.coverage.aavIds.length);
});
const preflight = await run(['--preflight-only', '--article', articleFile, '--output-dir', path.join(out, 'preflight')]);
check('original QA-012 preflight without credentials or network', () => {
  assert.equal(preflight.status, 'PREFLIGHT_PASS');
  assert.equal(preflight.realApiCalls, 0);
});
const report = { status: 'PASS', articleSha256: digest(articleFile), pdfSha256: article.provenance.pdfSha256,
  checks, mentionCounts, aavOccurrences: mentionCounts.reduce((n, m) => n + m.rawCount, 0),
  paragraphs: article.paragraphs.length, sections: new Set(article.paragraphs.map(p => p.section)).size,
  coverage: loaded.coverage, preflightOutput: preflight.output,
  boundary: 'User PDF text-layer reconstruction and offline contract only. No model-answer or publisher-DOM acceptance.' };
fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: checks.length, articleSha256: report.articleSha256,
  paragraphs: report.paragraphs, aavOccurrences: report.aavOccurrences, preflightOutput: preflight.output }));
