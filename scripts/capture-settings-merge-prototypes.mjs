import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const prototypePath = path.join(root, 'prototypes', 'settings-onboarding-merge', 'index.html');
const outputDir = path.join(root, 'output', 'playwright', 'settings-onboarding-audit-20260814', 'proposals');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const baseUrl = pathToFileURL(prototypePath).href;
  for (const variant of ['a', 'b', 'c']) {
    await page.goto(`${baseUrl}?variant=${variant}`, { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(outputDir, `proposal-${variant}-1440.png`),
      fullPage: false
    });
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(`${baseUrl}?variant=a`, { waitUntil: 'load' });
  await page.screenshot({
    path: path.join(outputDir, 'proposal-a-600.png'),
    fullPage: false
  });
  process.stdout.write(`${outputDir}\n`);
} finally {
  await browser.close();
}
