import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { dragSelectAcrossNativePdfPages } from './pdf-selection-evidence-helper.mjs';
import { recordedSelectionBaseline, assertRecordedSelectionEndpoint,
  EXPECTED_PDF_SHA256 } from './verify-pdf-chat-note-migration-live.mjs';

export const REQUIRED_WHITESPACE_INDICES = Object.freeze([107, 109, 122, 126]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const shaFile = filename => sha(fs.readFileSync(filename));
const write = (filename, data) => fs.writeFileSync(filename, JSON.stringify(data, null, 2) + '\n');

export function assertSelectionIdentity(actual, baseline) {
  for (const key of ['rawCharacters', 'normalizedCharacters', 'rawSha256', 'normalizedSha256']) {
    assert.equal(actual[key], baseline[key], `WHITESPACE_SELECTION_${key.toUpperCase()}_CHANGED`);
  }
  assert.deepEqual(actual.endpoints, baseline.endpoints.map(({ pageNumber, index, offset }) =>
    ({ pageNumber, index, offset })), 'WHITESPACE_SELECTION_ENDPOINTS_CHANGED');
  assert.equal(actual.rangeCount, 1, 'WHITESPACE_SELECTION_NOT_ACTIVE');
}

export function assertWhitespaceVisualPair(before, after) {
  assert.equal(after.styles.wronglyMarkedParents, 0, 'WHITESPACE_PARENT_MARKED');
  assert.equal(after.styles.wronglyMarkedText, 0, 'WHITESPACE_NONSPACE_MARKED');
  assert.ok(Number.isInteger(after.styles.parentCount) && after.styles.parentCount >= 0,
    'WHITESPACE_PARENT_COUNT_MISSING');
  assert.ok(after.styles.brCount > 0, 'WHITESPACE_BR_SAMPLE_MISSING');
  assert.equal(after.styles.opaqueBrCount, 0, 'WHITESPACE_BR_NOT_TRANSPARENT');
  for (const index of REQUIRED_WHITESPACE_INDICES) {
    const old = before.regions.find(row => row.kind === 'whitespace' && row.index === index);
    const current = after.regions.find(row => row.kind === 'whitespace' && row.index === index);
    assert.ok(old && current, 'WHITESPACE_REQUIRED_REGION_MISSING');
    assert.equal(current.pureWhitespaceLeaf, true, 'WHITESPACE_REQUIRED_REGION_NOT_LEAF');
    assert.equal(current.marked, true, 'WHITESPACE_REQUIRED_REGION_UNMARKED');
    assert.equal(current.transparent, true, 'WHITESPACE_PSEUDO_NOT_TRANSPARENT');
    assert.equal(current.intersectsSelection, true, 'WHITESPACE_REQUIRED_REGION_NOT_SELECTED');
    assert.ok(old.pixelCount >= 4 && current.pixelCount >= 4, 'WHITESPACE_PIXEL_REGION_TOO_SMALL');
    assert.ok(old.bluePixels > 0, 'WHITESPACE_BEFORE_COLOR_NOT_OBSERVED');
    assert.equal(current.bluePixels, 0, 'WHITESPACE_BACKGROUND_STILL_VISIBLE');
  }
  const oldBody = before.regions.filter(row => row.kind === 'body');
  const currentBody = after.regions.filter(row => row.kind === 'body');
  assert.ok(oldBody.some(row => row.bluePixels >= 20), 'WHITESPACE_BEFORE_BODY_NOT_VISIBLE');
  assert.ok(currentBody.some(row => row.bluePixels >= 20 && !row.marked && !row.transparent),
    'WHITESPACE_BODY_SELECTION_LOST');
  return { visual: 'PASS', parentContainers: after.styles.parentCount > 0 ? 'PASS' : 'N/A',
    parentCount: after.styles.parentCount };
}

export function assertScrollProjection(first, second) {
  assert.ok(Math.abs(second.scrollTop - first.scrollTop) >= 20, 'WHITESPACE_SCROLL_NOT_CHANGED');
  for (const index of REQUIRED_WHITESPACE_INDICES) {
    const before = first.regions.find(row => row.kind === 'whitespace' && row.index === index);
    const after = second.regions.find(row => row.kind === 'whitespace' && row.index === index);
    assert.ok(before && after, 'WHITESPACE_SCROLL_REGION_MISSING');
    assert.ok(Math.abs(before.rect.left - after.rect.left) <= 0.75 &&
      Math.abs(before.rect.top - after.rect.top - (second.scrollTop - first.scrollTop)) <= 0.75,
    'WHITESPACE_SCROLL_PROJECTION_MISMATCH');
  }
  return true;
}

function readScreenshotPixels(filename, regions, viewport) {
  const python = String.raw`import sys,json,math
from PIL import Image
request=json.load(sys.stdin)
im=Image.open(request['filename']).convert('RGB')
assert im.width==request['viewport']['width'] and im.height==request['viewport']['height']
result=[]
for row in request['regions']:
 r=row['rect']; x1=max(0,math.ceil(r['left']+0.5));y1=max(0,math.ceil(r['top']+0.5))
 x2=min(im.width,math.floor(r['right']-0.5));y2=min(im.height,math.floor(r['bottom']-0.5))
 count=0;blue=0
 for y in range(y1,y2):
  for x in range(x1,x2):
   red,green,b=im.getpixel((x,y));count+=1
   if b-red>=20 and b-green>=8 and green-red>=8 and b>=180 and red>=120:blue+=1
 result.append({'index':row['index'],'kind':row['kind'],'pixelCount':count,'bluePixels':blue,
  'pixelBounds':{'left':x1,'top':y1,'right':x2,'bottom':y2}})
print(json.dumps(result))`;
  const result = spawnSync('python', ['-c', python], { input: JSON.stringify({ filename, regions, viewport }),
    encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'WHITESPACE_PNG_PIXEL_READ_FAILED');
  return JSON.parse(result.stdout);
}

async function currentSelection(reader) {
  const state = await reader.evaluate(() => {
    const selection = document.getSelection(), range = selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const endpoint = (node, offset) => {
      const span = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest('.pdf-native-text-layer span');
      return { pageNumber: Number(span.closest('.pdf-native-page').dataset.pdfPageNumber),
        index: [...span.closest('.pdf-native-text-layer').querySelectorAll('span')].indexOf(span), offset };
    };
    const raw = String(selection || '');
    return { raw, normalized: raw.normalize('NFKC').replace(/\s+/gu, ' ').trim(), rangeCount: selection.rangeCount,
      endpoints: range ? [endpoint(range.startContainer, range.startOffset), endpoint(range.endContainer, range.endOffset)] : [] };
  });
  return { rangeCount: state.rangeCount, endpoints: state.endpoints, rawCharacters: state.raw.length,
    normalizedCharacters: state.normalized.length, rawSha256: sha(state.raw), normalizedSha256: sha(state.normalized) };
}

async function readRegions(reader) {
  return reader.evaluate(required => {
    const selection = document.getSelection(), selected = selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
    if (!selected) throw Error('WHITESPACE_SELECTION_MISSING');
    const viewer = document.getElementById('pdfNativeViewer');
    const spans = [...document.querySelectorAll('.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span')];
    const transparent = element => {
      const value = getComputedStyle(element, '::selection').backgroundColor.replace(/\s/gu, '');
      return value === 'transparent' || value === 'rgba(0,0,0,0)' || /,0\)$/.test(value);
    };
    const row = (span, index, kind) => {
      const range = document.createRange(); range.selectNodeContents(span);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 1 && rect.height > 1);
      const rect = rects.at(-1);
      if (!rect) return null;
      const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
      const top = document.elementFromPoint(center.x, center.y);
      return { kind, index, pageNumber: Number(span.closest('.pdf-native-page').dataset.pdfPageNumber),
        pureWhitespaceLeaf: span.childElementCount === 0 && span.textContent.length > 0 && !span.textContent.trim(),
        marked: span.hasAttribute('data-pdf-whitespace-selection'), transparent: transparent(span),
        intersectsSelection: selected.intersectsNode(span),
        visible: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 200 && rect.bottom <= innerHeight - 8,
        uncovered: Boolean(top?.closest('.pdf-native-page')),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height } };
    };
    const regions = required.map(index => row(spans[index], index, 'whitespace'));
    const all = [...document.querySelectorAll('.pdf-native-text-layer span')];
    const body = [...document.querySelectorAll('.pdf-native-page[data-pdf-page-number="2"] .pdf-native-text-layer span')]
      .flatMap((span, index) => span.childElementCount === 0 && span.textContent.trim().length >= 30 &&
        selected.intersectsNode(span) ? [row(span, index, 'body')] : []).filter(item => item?.visible && item.uncovered).slice(0, 6);
    const brs = [...document.querySelectorAll('.pdf-native-text-layer br')];
    return { scrollTop: viewer.scrollTop, viewport: { width: innerWidth, height: innerHeight },
      styles: { parentCount: all.filter(span => span.childElementCount > 0).length,
        wronglyMarkedParents: all.filter(span => span.childElementCount > 0 && span.hasAttribute('data-pdf-whitespace-selection')).length,
        wronglyMarkedText: all.filter(span => span.textContent.trim() && span.hasAttribute('data-pdf-whitespace-selection')).length,
        brCount: brs.length, opaqueBrCount: brs.filter(br => !transparent(br)).length },
      regions: [...regions, ...body].filter(Boolean) };
  }, REQUIRED_WHITESPACE_INDICES);
}

async function dragRecordedSelection(reader, baseline, report) {
  const measured = new Proxy(reader, { get(target, property) {
    if (property === 'locator') return selector => {
      const locator = target.locator(selector);
      const match = /^\.pdf-native-page\[data-pdf-page-number="([12])"\] \.pdf-native-text-layer span$/u.exec(selector);
      if (!match) return locator;
      const point = baseline.endpoints.find(item => item.pageNumber === Number(match[1]));
      return new Proxy(locator, { get(nodes, method) {
        if (method === 'evaluateAll') return async () => {
          const candidate = await nodes.evaluateAll((spans, point) => {
            const span = spans[point.index], text = span?.firstChild;
            if (text?.nodeType !== Node.TEXT_NODE) throw Error('WHITESPACE_ENDPOINT_NOT_TEXT');
            const bounds = span.getBoundingClientRect(), page = span.closest('.pdf-native-page').getBoundingClientRect();
            const caret = document.createRange(); caret.setStart(text, point.offset); caret.collapse(true);
            return { pageNumber: point.pageNumber, index: point.index, offset: point.offset, content: text.textContent,
              geometry: { left: bounds.left - page.left, top: bounds.top - page.top, width: bounds.width, height: bounds.height },
              hitFraction: (caret.getBoundingClientRect().left + 0.1 - bounds.left) / bounds.width };
          }, point);
          const { content, ...observed } = candidate; observed.contentSha256 = sha(content);
          assertRecordedSelectionEndpoint(observed, point); report.endpoints.push(observed);
          return { index: observed.index, hitFraction: observed.hitFraction };
        };
        const member = Reflect.get(nodes, method); return typeof member === 'function' ? member.bind(nodes) : member;
      } });
    };
    const member = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member;
  } });
  const gesture = await dragSelectAcrossNativePdfPages(measured, {
    startPage: 1, endPage: 2, minimumCharacters: 20, prepareEvidence: false
  });
  report.gesture = { inputMethod: gesture.inputMethod, wheelSteps: gesture.wheelSteps,
    descriptorValid: gesture.descriptor?.validation?.valid === true };
}

export async function run({ baselineRoot, extensionRoot, outputDirectory, pdfPath }) {
  assert.ok(baselineRoot && extensionRoot && outputDirectory && pdfPath, 'WHITESPACE_EXPLICIT_INPUTS_REQUIRED');
  assert.equal(fs.existsSync(outputDirectory), false, 'WHITESPACE_OUTPUT_ALREADY_EXISTS');
  assert.equal(shaFile(pdfPath), EXPECTED_PDF_SHA256, 'WHITESPACE_PUBLIC_PDF_CHANGED');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const report = { status: 'RUNNING', realApiCalls: 0, llmRequests: 0, annotationsCreated: 0, versions: {} };
  const persist = () => write(path.join(outputDirectory, 'report.json'), report);
  let baselineScroll = null;
  try {
    for (const [version, root] of [['before', baselineRoot], ['after', extensionRoot]]) {
      const record = { endpoints: [], captures: [], externalHttpRequests: 0, pageErrors: 0, consoleErrors: 0, workerErrors: 0 };
      report.versions[version] = record;
      const baseline = recordedSelectionBaseline(EXPECTED_PDF_SHA256, shaFile(path.join(root, 'core/pdf-text-projection.js')));
      assert.equal(baseline.normalizedCharacters, 508, 'WHITESPACE_READING_ORDER_BASELINE_REQUIRED');
      record.source = Object.fromEntries(['pdf-native-reader.mjs', 'pdf-reader.css', 'core/pdf-text-projection.js']
        .map(file => [file, shaFile(path.join(root, file))]));
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-whitespace-selection-'));
      const extension = path.join(temporary, 'extension'); fs.cpSync(root, extension, { recursive: true });
      let context, reader;
      try {
        context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'msedge',
          headless: true, reducedMotion: 'reduce', colorScheme: 'light', viewport: { width: 1320, height: 960 },
          deviceScaleFactor: 1, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
        await context.route(/^https?:\/\//u, route => { record.externalHttpRequests += 1; return route.abort(); });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
        worker.on('console', message => { if (message.type() === 'error') record.workerErrors += 1; });
        reader = await context.newPage();
        reader.on('pageerror', () => { record.pageErrors += 1; });
        reader.on('console', message => { if (message.type() === 'error') record.consoleErrors += 1; });
        await reader.goto(`chrome-extension://${new URL(worker.url()).host}/pdf-reader.html`, { waitUntil: 'domcontentloaded' });
        await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
        await reader.waitForFunction(hash => globalThis.__brevessNativePdfDocument?.phase === 'text-ready' &&
          globalThis.__brevessNativePdfDocument?.structure?.documentHash === hash &&
          globalThis.__brevessPdfSemanticDocument?.indexedPageCount === 23, EXPECTED_PDF_SHA256, { timeout: 120000 });
        for (let step = 0; step < 12; step += 1) {
          if (await reader.evaluate(() => Number(__brevessPdfReaderBridge.command('getState').scale)) <= 1.1) break;
          await reader.locator('#pdfReaderZoomOut').click();
        }
        record.scale = await reader.evaluate(() => Number(__brevessPdfReaderBridge.command('getState').scale));
        assert.equal(record.scale, baseline.scale, 'WHITESPACE_SCALE_CHANGED');
        await dragRecordedSelection(reader, baseline, record);
        record.selection = await currentSelection(reader); assertSelectionIdentity(record.selection, baseline);
        const initial = await readRegions(reader);
        const required = initial.regions.filter(row => row.kind === 'whitespace');
        assert.equal(required.length, REQUIRED_WHITESPACE_INDICES.length, 'WHITESPACE_RANGE_RECTS_MISSING');
        const wantedScroll = baselineScroll ?? initial.scrollTop + Math.min(...required.map(row => row.rect.top)) - 260;
        await reader.mouse.move(100, 500);
        await reader.mouse.wheel(0, wantedScroll - initial.scrollTop); await reader.waitForTimeout(250);
        for (let position = 0; position < 2; position += 1) {
          if (position) { await reader.mouse.wheel(0, 40); await reader.waitForTimeout(250); }
          const capture = await readRegions(reader);
          if (!position && version === 'before') baselineScroll = capture.scrollTop;
          assert.ok(Math.abs(capture.scrollTop - (baselineScroll + position * 40)) <= 1, 'WHITESPACE_SCROLL_POSITION_MISMATCH');
          assertSelectionIdentity(await currentSelection(reader), baseline);
          for (const row of capture.regions.filter(row => row.kind === 'whitespace')) {
            assert.equal(row.visible && row.uncovered, true, 'WHITESPACE_REGION_OCCLUDED');
          }
          const filename = `${version}-selection-${position + 1}.png`;
          const target = path.join(outputDirectory, filename);
          await reader.screenshot({ path: target, animations: 'disabled', fullPage: false });
          const pixels = readScreenshotPixels(target, capture.regions, capture.viewport);
          capture.regions = capture.regions.map(row => ({ ...row,
            ...pixels.find(pixel => pixel.index === row.index && pixel.kind === row.kind) }));
          record.captures.push({ ...capture, screenshot: filename, screenshotSha256: shaFile(target) }); persist();
        }
        assertScrollProjection(record.captures[0], record.captures[1]);
        assert.equal(record.externalHttpRequests + record.pageErrors + record.consoleErrors + record.workerErrors, 0,
          'WHITESPACE_BROWSER_OR_NETWORK_ERRORS');
      } finally {
        await context?.close();
        const resolved = path.resolve(temporary), tempRoot = path.resolve(os.tmpdir());
        assert.ok(resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith('brevess-whitespace-selection-'));
        fs.rmSync(resolved, { recursive: true, force: true }); persist();
      }
    }
    report.captureCoverage = [0, 1].map(position =>
      assertWhitespaceVisualPair(report.versions.before.captures[position], report.versions.after.captures[position]));
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failureCode = String(error.message).match(/\bWHITESPACE_[A-Z0-9_]+\b/u)?.[0] ||
      String(error.code || 'WHITESPACE_LIVE_FAILED');
    process.exitCode = 1;
  } finally { persist(); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/u, '')] = process.argv[i + 1];
  run({ baselineRoot: args.baseline, extensionRoot: args.extension, outputDirectory: args.output, pdfPath: args.pdf })
    .then(report => console.log(JSON.stringify({ status: report.status, failureCode: report.failureCode || '' })))
    .catch(error => { console.error(String(error.code || error.message)); process.exitCode = 1; });
}
