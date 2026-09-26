const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');

function buildCellFixture() {
  const sections = Array.from({ length: 72 }, (_, sectionIndex) => {
    const paragraphs = Array.from({ length: 8 }, (_, paragraphIndex) => `
      <div class="section-paragraph Body body-copy">
        Section ${sectionIndex + 1} paragraph ${paragraphIndex + 1} reports a mechanistic
        observation with sufficient scientific prose to be recognized as article content.
        The result includes a comparison, an effect direction, and a concluding sentence.
      </div>`).join('');
    return `<section class="article-section"><h2>Section ${sectionIndex + 1}</h2>${paragraphs}</section>`;
  }).join('');
  const collateral = Array.from({ length: 3600 }, (_, index) =>
    `<div class="recommendation-card"><span>Recommended item ${index + 1}</span></div>`
  ).join('');
  return `<!doctype html><html><head><title>Cell review benchmark</title></head><body>
    <nav>${collateral}</nav>
    <article id="cell-fulltext" class="article-content">${sections}</article>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('https://www.cell.com/benchmark-review', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: buildCellFixture()
  }));
  await page.goto('https://www.cell.com/benchmark-review', { waitUntil: 'domcontentloaded' });
  for (const relative of ['core/publisher-adapters.js', 'core/article-structure.js', 'core/article-extractor.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  const result = await page.evaluate(() => {
    const runs = [];
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      const records = SciLLM.extractArticle(document);
      runs.push({ durationMs: performance.now() - startedAt, recordCount: records.length });
    }
    return { elementCount: document.querySelectorAll('*').length, runs };
  });
  process.stdout.write(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
