const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const store = require('../core/supplemental-pdf-import-store.js');

function executableFunctionSource(script, name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = script.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

test('supplemental PDF import tokens and status keys are bounded and deterministic', () => {
  const token = 'pdf_0123456789abcdef0123456789abcdef';
  assert.equal(store.normalizeSupplementalPdfImportToken(token), token);
  assert.equal(store.normalizeSupplementalPdfImportToken('../bad'), '');
  assert.equal(
    store.supplementalPdfImportStatusKey(token),
    `brevessSupplementalPdfImportStatus:${token}`
  );
});

test('transient supplemental PDF blobs are proactively swept after expiry', () => {
  const script = read('core/supplemental-pdf-import-store.js');
  assert.equal(typeof store.cleanupExpiredSupplementalPdfImports, 'function');
  assert.match(script, /openCursor\(\)/);
  assert.match(script, /Number\(cursor\.value\?\.expiresAt\)\s*<=\s*now/);
  assert.match(script, /await deleteExpiredRecords\(database, now\)/);
  assert.match(script, /queueMicrotask\(\(\) => cleanupExpiredSupplementalPdfImports/);
});

test('side panel owns PDF selection and launches only an inactive transient reader', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="supplementalFigurePdfFile"[^>]+type="file"/);
  assert.match(html, /core\/supplemental-pdf-import-store\.js/);
  assert.match(script, /saveSupplementalPdfImportSession/);
  assert.match(script, /chrome\.tabs\.create\(\{\s*url:[^,]+,\s*active:\s*false/);
  assert.match(script, /headlessImport/);
  assert.doesNotMatch(
    script.slice(
      script.indexOf('async function openSupplementalMaterialPdf'),
      script.indexOf('let supplementalFigureImportTarget')
    ),
    /active:\s*true/
  );
});

test('headless reader consumes the transient PDF, reports status, and closes itself', () => {
  const html = read('pdf-reader.html');
  const script = read('pdf-reader.js');
  assert.match(html, /core\/supplemental-pdf-import-store\.js/);
  assert.match(script, /consumeSupplementalPdfImportSession/);
  assert.match(script, /supplementalPdfImportStatusKey/);
  assert.match(script, /chrome\.tabs\.remove/);
});

test('supplemental PDF completion counts panels from hints analyses and both depths', () => {
  const script = read('popup.js');
  const source = executableFunctionSource(script, 'supplementalPdfImportedPanelCount');
  const supplementalPdfImportedPanelCount = new Function(
    `${source}\nreturn supplementalPdfImportedPanelCount;`
  )();
  const snapshot = {
    figures: {
      figures: [
        {
          figureId: 'figure-s1', isSupplemental: true,
          panelHints: ['A', 'B'],
          standard: { panels: [{ panel: 'B' }, { panel: 'C' }] },
          deep: { panels: [{ panelId: 'D' }] },
          panelAnalyses: { E: {}, A: {} }
        },
        {
          figureId: 'figure-1', isSupplemental: false,
          panelHints: ['Z'], panelAnalyses: { Y: {} }
        }
      ]
    }
  };
  assert.equal(supplementalPdfImportedPanelCount(snapshot, 2), 5);
  assert.equal(supplementalPdfImportedPanelCount(null, 3), 3);
});
