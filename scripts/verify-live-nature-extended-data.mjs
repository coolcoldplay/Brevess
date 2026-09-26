import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'playwright', 'live-nature-extended-data');
const url = process.env.NATURE_ARTICLE_URL ||
  'https://www.nature.com/articles/s41586-026-10907-8';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const diagnostics = { pageErrors: [], consoleErrors: [] };
page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('.c-article-supplementary__item').first()
    .waitFor({ state: 'attached', timeout: 60000 });
  for (const relativePath of [
    'core/supplemental-materials.js',
    'core/figure-extractor.js',
    'core/figure-viewer.js'
  ]) {
    await page.addScriptTag({ path: path.join(root, relativePath) });
  }
  const result = await page.evaluate(() => {
    const paragraphs = Array.from(document.querySelectorAll('p')).map((element, index) => ({
      paragraphId: `live-p-${index + 1}`,
      sectionTitle: element.closest('.c-article-section')
        ?.querySelector('.c-article-section__title')?.textContent || '',
      text: element.textContent || ''
    }));
    const figures = SciLLM.extractArticleFigures(document, paragraphs);
    const references = SciLLM.extractSupplementalReferences(paragraphs);
    const materials = SciLLM.discoverSupplementalMaterials(document);
    return {
      figures: figures.map(figure => ({
        figureId: figure.figureId,
        figureLabel: figure.figureLabel,
        figureSeries: figure.figureSeries,
        panels: figure.panelHints,
        captionLength: figure.caption.length,
        imageSource: SciLLM.selectFigureImageSource(figure, document.baseURI)
      })),
      references: references.map(reference => ({
        shortLabel: reference.shortLabel,
        panels: reference.panels
      })),
      materials: materials.map(material => ({
        title: material.title,
        kind: material.kind,
        url: material.url
      }))
    };
  });
  const supplemental = result.figures.filter(figure =>
    figure.figureSeries === 'extended-data'
  );
  const nativeExtendedDataMaterials = result.materials.filter(material =>
    /extended data fig/i.test(material.title)
  );
  const report = {
    url,
    passed: result.figures.filter(figure => figure.figureSeries === 'main').length === 5 &&
      supplemental.length === 11 &&
      supplemental.every(figure => figure.captionLength > 100 && figure.imageSource) &&
      result.references.some(reference => reference.shortLabel === 'ED7') &&
      nativeExtendedDataMaterials.length === 0 &&
      diagnostics.pageErrors.length === 0,
    ...result,
    diagnostics
  };
  await page.locator('#Sec44-section').screenshot({
    path: path.join(outputDir, 'nature-extended-data-section.png')
  });
  fs.writeFileSync(
    path.join(outputDir, 'live-nature-extended-data-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
