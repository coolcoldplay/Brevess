const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-pdf-remote-source.mjs');
const verifier = fs.readFileSync(verifierPath, 'utf8');

async function moduleApi() {
  return import(pathToFileURL(verifierPath).href);
}

function passingObservation(api) {
  return {
    sourceUrl: api.PUBLIC_PDF_URL,
    sourceFetchCount: 2,
    sourceStatuses: [200, 200],
    sourceByteLengths: [5336630, 5336630],
    sourceHashes: [api.PUBLIC_PDF_SHA256, api.PUBLIC_PDF_SHA256],
    pdfBytes: 5336630,
    documentHash: api.PUBLIC_PDF_SHA256,
    reloadDocumentHash: api.PUBLIC_PDF_SHA256,
    pageCount: 23,
    reloadPageCount: 23,
    viewerState: 'ready',
    phase: 'text-ready',
    firstPageRendered: true,
    firstPageNonWhitePixels: 500,
    workspaceReady: true,
    workspaceIndexed: true,
    paragraphCount: 300,
    characterCount: 75000,
    title: 'elife-83176-v2',
    reloadTitle: 'elife-83176-v2',
    externalLinkCount: 9,
    externalLinkHref: 'https://doi.org/10.7554/eLife.83176',
    externalClickTarget: 'https://doi.org/10.7554/eLife.83176',
    internalLinkCount: 8,
    internalTargetPage: 4,
    internalCurrentPage: 4,
    savedPage: 4,
    reloadCurrentPage: 4,
    savedScale: 1.25,
    reloadScale: 1.25,
    savedPositionHash: api.PUBLIC_PDF_SHA256,
    initialReaderUrl: `chrome-extension://id/pdf-reader.html?source=${
      encodeURIComponent(api.PUBLIC_PDF_URL)}`,
    reloadReaderUrl: `chrome-extension://id/pdf-reader.html?source=${
      encodeURIComponent(api.PUBLIC_PDF_URL)}`,
    apiRequestCount: 0,
    unexpectedHttpRequestCount: 0,
    runtimeErrorCount: 0
  };
}

test('remote-PDF acceptance decision fails closed for every required observation', async () => {
  const api = await moduleApi();
  const passing = passingObservation(api);
  assert.equal(api.assessRemotePdfSource(passing).pass, true);

  const failures = {
    sourceUrl: 'https://example.test/paper.pdf',
    sourceFetchCount: 0,
    sourceStatuses: [403],
    sourceByteLengths: [100],
    sourceHashes: ['wrong'],
    reloadDocumentHash: 'wrong',
    reloadPageCount: 22,
    viewerState: 'error',
    workspaceIndexed: false,
    paragraphCount: 0,
    title: 'PDF reader',
    externalClickTarget: '',
    internalCurrentPage: 3,
    reloadCurrentPage: 1,
    reloadScale: 1,
    reloadReaderUrl: 'chrome-extension://id/pdf-reader.html',
    apiRequestCount: 1,
    unexpectedHttpRequestCount: 1,
    runtimeErrorCount: 1
  };
  for (const [field, value] of Object.entries(failures)) {
    assert.equal(api.assessRemotePdfSource({ ...passing, [field]: value }).pass, false, field);
  }
});

test('verifier uses the exact public remote URL in an isolated Edge extension profile', () => {
  assert.match(verifier,
    /https:\/\/cdn\.elifesciences\.org\/articles\/83176\/elife-83176-v2\.pdf/u);
  assert.match(verifier, /6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1/u);
  assert.match(verifier, /PUBLIC_PDF_PAGE_COUNT = 23/u);
  assert.match(verifier, /brevess-pdf-remote-source-/u);
  assert.match(verifier, /launchPersistentContext\(profileDirectory/u);
  assert.match(verifier, /channel: 'msedge'/u);
  assert.match(verifier, /dailyBrowserUsed:\s*false/u);
  assert.match(verifier, /pdf-reader\.html\?source=\$\{/u);
  assert.doesNotMatch(verifier, /localhost|127\.0\.0\.1|setInputFiles/u);
});

test('verifier permits only the real PDF fetch and exercises links and reload persistence', () => {
  assert.match(verifier, /context\.route\(\/\^https\?:\\\/\\\//u);
  assert.match(verifier, /requestUrl === PUBLIC_PDF_URL/u);
  assert.match(verifier, /const response = await route\.fetch\(\)/u);
  assert.match(verifier, /sha256:\s*sha256\(body\)/u);
  assert.match(verifier, /await route\.abort\('blockedbyclient'\)/u);
  assert.match(verifier, /__brevessRemoteVerifierExternalTarget/u);
  assert.match(verifier, /a\.pdf-native-link-hit\[href\^="#page="\]/u);
  assert.match(verifier, /await page\.reload\(\{ waitUntil: 'domcontentloaded' \}\)/u);
  assert.match(verifier, /brevess-pdf-position:/u);
  assert.match(verifier, /workspaceIndexed/u);
  assert.match(verifier, /firstPageNonWhitePixels/u);
  assert.match(verifier, /apiRequestCount/u);
  assert.match(verifier, /unexpectedHttpRequestCount/u);
});
