#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output', 'playwright');
fs.mkdirSync(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  if (!/Executable doesn't exist/i.test(String(error?.message || ''))) throw error;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
}
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const errors = [];

try {
  const human = await context.newPage();
  human.on('console', message => { if (message.type() === 'error') errors.push(`human console: ${message.text()}`); });
  human.on('pageerror', error => errors.push(`human page: ${error.message}`));
  await human.goto(pathToFileURL(path.join(root, 'Checkpoint2_Human_Review_Queue.html')).href);
  await human.waitForSelector('#card .target-text');
  if (!(await human.locator('#count').textContent()).includes('528')) throw new Error('Human queue count did not render');
  if (!(await human.locator('#candidate').evaluate(node => node.classList.contains('hidden')))) {
    throw new Error('Candidate label was visible before independent adjudication');
  }
  await human.selectOption('#independent', { index: 1 });
  await human.click('#lock');
  if (await human.locator('#candidate').evaluate(node => node.classList.contains('hidden'))) {
    throw new Error('Candidate label did not reveal after independent adjudication');
  }
  await human.click('[data-action="accept"]');
  await human.fill('#qstart', '0');
  await human.fill('#qend', '8');
  await human.fill('#quote', 'QA quote');
  await human.fill('#note', 'Playwright local QA');
  const humanDownload = human.waitForEvent('download');
  await human.click('#export');
  await (await humanDownload).saveAs(path.join(out, 'checkpoint2-human-qa-export.jsonl'));
  await human.screenshot({ path: path.join(out, 'checkpoint2-human-review.png'), fullPage: true });

  const figure = await context.newPage();
  figure.on('console', message => { if (message.type() === 'error') errors.push(`figure console: ${message.text()}`); });
  figure.on('pageerror', error => errors.push(`figure page: ${error.message}`));
  await figure.goto(pathToFileURL(path.join(root, 'Checkpoint2_Figure_Review_Queue.html')).href);
  await figure.waitForSelector('.image-wrap img');
  const imageLoaded = await figure.locator('.image-wrap img').evaluate(image => image.complete && image.naturalWidth > 0);
  if (!imageLoaded) throw new Error('Actual Figure asset did not load');
  if (!(await figure.locator('#count').textContent()).includes('30')) throw new Error('Figure queue count did not render');
  await figure.fill('#panels', 'A\nB');
  await figure.fill('#pairing', 'A/B caption pairing checked against image');
  await figure.fill('#observations', 'Direct observation QA entry');
  await figure.selectOption('#level', 'direct_observation');
  await figure.check('#complete');
  const figureDownload = figure.waitForEvent('download');
  await figure.click('#export');
  await (await figureDownload).saveAs(path.join(out, 'checkpoint2-figure-qa-export.jsonl'));
  await figure.screenshot({ path: path.join(out, 'checkpoint2-figure-review.png'), fullPage: true });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    passed: true,
    humanQueueItems: 528,
    humanCandidateHiddenUntilIndependentDecision: true,
    figureQueueItems: 30,
    actualFigureImageLoaded: true,
    jsonlExports: 2,
    screenshots: ['output/playwright/checkpoint2-human-review.png', 'output/playwright/checkpoint2-figure-review.png']
  }, null, 2));
} finally {
  await browser.close();
}
