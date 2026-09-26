const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pdfPackage;
test.before(async () => {
  pdfPackage = await import('../scripts/finalize-local-pdf-package.mjs');
});

function write(root, relative, value) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-package-'));
  const buildName = 'Brevess-test-pdf-build';
  const target = path.join(root, 'dist', buildName);
  const manifest = {
    manifest_version: 3,
    version: '1.0.1',
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+B4vL4I4bJQVURPfrGIV4YjSJ5h0NQBP3NY72ZyN26DX0ffpmTMlRpc1DKaNj21pjN46/Ig1MYu2b3ReoBdQKgzrKMDPACu1GoOOnF37ei79fJXPCovCaMRBXQrEYgsaYCf6RmTlkU98qQQjV6o211akZO0l7Ba4OrNQzUzULFP+AF88rl45cpjRtVFgsM6/duDnnQVWWCaKv1nLtvJvNRfO2AsydO0354f/iI3Ikirpx61xxWP0y/6uElWsqGI6Sm135IG8E+ahF4juNciziGmX+cgRDz2QN+KAdxL2GVewdmTU5AHC2/r9N5kf5JQkvYKb+5Ar0nLQBb31/ChmEQIDAQAB',
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    icons: { 16: 'icon.png' }
  };
  const sources = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'background.js': "importScripts('core/helper.js');\n" +
      "globalThis.workerUrl = chrome.runtime.getURL('assets/worker.mjs');\n" +
      "globalThis.cMapUrl = chrome.runtime.getURL('assets/cmaps/');",
    'core/helper.js': 'globalThis.helper = true;',
    'assets/worker.mjs': 'export const worker = true;',
    'assets/cmaps/example.bcmap': 'test-map',
    'popup.html': '<link rel="stylesheet" href="popup.css"><img src="icon.png">',
    'popup.css': '.icon{background:url("icon.png")}',
    'icon.png': 'not-a-real-png',
    'README.md': '# source readme',
    'INSTALL.md': '# source install',
    'BUILD39_OPTIMIZATION.md': '# build39 historical notes'
  };
  for (const [relative, value] of Object.entries(sources)) {
    write(root, relative, value);
    write(target, relative, value);
  }
  write(root, 'docs/pdf-progress.md', '# PDF progress\nNo private material.');
  write(root, 'output/api/report.json', {
    schemaVersion: 1, status: 'PASS', fixtures: false, replay: false,
    realPdf: true, model: 'verified-model', network: { realApiCalls: 2 }
  });
  write(root, 'output/ui/report.json', { schemaVersion: 1, status: 'PASS' });
  write(root, 'output/ocr/report.json', {
    schemaVersion: 1, status: 'PASS_WITH_EVIDENCE_REVIEW'
  });
  const evidencePath = write(root, 'tmp/pdf-package-evidence.json', {
    schemaVersion: 1,
    documentation: ['docs/pdf-progress.md'],
    reports: [
      { kind: 'realApi', path: 'output/api/report.json' },
      { kind: 'nativeUi', path: 'output/ui/report.json' },
      { kind: 'syntheticOcr', path: 'output/ocr/report.json' }
    ]
  });
  return { root, buildName, target, evidencePath, sourceFiles: Object.keys(sources) };
}

function validFigureApiReport(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'PASS_WITH_EVIDENCE_REVIEW',
    realFigures: true,
    fixtures: false,
    replay: false,
    realApiCalls: 9,
    model: 'verified-vision-and-synthesis-models',
    scope: {
      freshOriginalImagePanelExtraction: true,
      freshFigureSynthesis: true,
      broadScientificCorrectnessClaim: false
    },
    expectedPanelCount: 37,
    generatedPanelCount: 37,
    incompleteFigureErrors: 0,
    review: { status: 'PASS' },
    figures: [
      {
        figureId: 'figure-1', status: 'PASS',
        expectedPanelCount: 26, generatedPanelCount: 26,
        incompleteFigure: false, errors: []
      },
      {
        figureId: 'figure-2', status: 'PASS',
        expectedPanelCount: 11, generatedPanelCount: 11,
        incompleteFigure: false, errors: []
      }
    ],
    ...overrides
  };
}

function addFigureApiEvidence(f, report, options = {}) {
  const relative = 'output/figure-api/report.json';
  if (options.write !== false) write(f.root, relative, report);
  const manifest = JSON.parse(fs.readFileSync(f.evidencePath, 'utf8'));
  manifest.reports.push({ kind: 'figureApi', path: relative });
  write(f.root, 'tmp/pdf-package-evidence.json', manifest);
}

test('validates explicit evidence, source hashes, fixed ID and writes PDF package metadata', () => {
  const f = fixture();
  const info = pdfPackage.finalizeLocalPdfPackage({
    rootDir: f.root,
    buildName: f.buildName,
    evidenceManifestPath: f.evidencePath,
    sourceFiles: f.sourceFiles,
    now: new Date('2026-09-09T00:00:00.000Z')
  });
  assert.equal(info.status, 'PASS_WITH_EVIDENCE_REVIEW');
  assert.equal(info.extensionId, 'finhfnjbpidfakpmkghkfjlfcfpoandh');
  assert.equal(info.verification.reports[0].realPdf, true);
  assert.equal(info.verification.reports[0].realApiCalls, 2);
  assert.equal(info.verification.realMineruScannedPdfVerified, false);
  assert.equal(info.actionsPerformed.compiled, false);
  assert.equal(info.actionsPerformed.nativeHostRegistered, false);
  assert.equal(fs.readFileSync(path.join(f.target, 'docs/pdf-progress.md'), 'utf8'),
    fs.readFileSync(path.join(f.root, 'docs/pdf-progress.md'), 'utf8'));
  const readme = fs.readFileSync(path.join(f.target, 'README.md'), 'utf8');
  assert.match(readme, /直接保留并显示原 PDF 页面/u);
  assert.match(readme, /没有完成.*真实扫描 PDF 经 MinerU 识别后/u);
  assert.match(readme, /非多模态分析依据正文、图注/u);
  assert.match(readme, /不代表真实 OCR/u);
  assert.match(readme, /\[`docs\/pdf-progress\.md`\]\(docs\/pdf-progress\.md\)/u);
  assert.match(readme, /BUILD39_OPTIMIZATION\.md.*历史优化记录/u);
  const install = fs.readFileSync(path.join(f.target, 'INSTALL.md'), 'utf8');
  assert.match(install, new RegExp(`${f.buildName}.*1\\.0\\.1`, 'u'));
  assert.ok(fs.existsSync(path.join(f.target, 'PACKAGE_INFO.json')));
});

test('rejects replay, non-PDF or zero-call reports labeled as real API evidence', () => {
  const f = fixture();
  write(f.root, 'output/api/report.json', {
    status: 'PASS', realPdf: false, fixtures: false, replay: false,
    network: { realApiCalls: 2 }
  });
  assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
    rootDir: f.root
  }), /REAL_API_EVIDENCE_INVALID/u);
  write(f.root, 'output/api/report.json', {
    status: 'PASS', realPdf: true, fixtures: false, replay: true,
    network: { realApiCalls: 0 }
  });
  assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
    rootDir: f.root
  }), /REAL_API_EVIDENCE_INVALID/u);
});

test('accepts separately reviewed fresh original-image Figure API evidence', () => {
  const f = fixture();
  addFigureApiEvidence(f, validFigureApiReport());
  const evidence = pdfPackage.validateVerificationManifest(f.evidencePath, {
    rootDir: f.root
  });
  const figureApi = evidence.reports.find(report => report.kind === 'figureApi');
  assert.deepEqual({
    realFigures: figureApi.realFigures,
    realApiCalls: figureApi.realApiCalls,
    expectedPanelCount: figureApi.expectedPanelCount,
    generatedPanelCount: figureApi.generatedPanelCount,
    figureCount: figureApi.figureCount,
    scientificReview: figureApi.scientificReview
  }, {
    realFigures: true,
    realApiCalls: 9,
    expectedPanelCount: 37,
    generatedPanelCount: 37,
    figureCount: 2,
    scientificReview: 'PASS'
  });
});

test('rejects missing, zero-call, replayed or failed-review Figure API evidence', () => {
  {
    const f = fixture();
    addFigureApiEvidence(f, null, { write: false });
    assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
      rootDir: f.root
    }), /EVIDENCE_REPORT_MISSING/u);
  }
  const invalidReports = [
    validFigureApiReport({ realApiCalls: 0 }),
    validFigureApiReport({ replay: true }),
    validFigureApiReport({ review: { status: 'FAIL' } })
  ];
  for (const report of invalidReports) {
    const f = fixture();
    addFigureApiEvidence(f, report);
    assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
      rootDir: f.root
    }), /FIGURE_API_EVIDENCE_INVALID/u);
  }
});

test('rejects incomplete Figure results and generated Panel count mismatches', () => {
  {
    const f = fixture();
    const report = validFigureApiReport();
    report.figures[0].incompleteFigure = true;
    report.figures[0].errors = [{ code: 'incompleteFigure' }];
    addFigureApiEvidence(f, report);
    assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
      rootDir: f.root
    }), /FIGURE_API_EVIDENCE_INVALID/u);
  }
  {
    const f = fixture();
    addFigureApiEvidence(f, validFigureApiReport({ generatedPanelCount: 36 }));
    assert.throws(() => pdfPackage.validateVerificationManifest(f.evidencePath, {
      rootDir: f.root
    }), /FIGURE_API_EVIDENCE_INVALID/u);
  }
});

test('resource checking distinguishes from properties and actual static or dynamic imports', () => {
  const propertySource = "const from = ownData(edge, 'from');\nconst to = ownData(edge, 'to');";
  const cases = [
    [propertySource, true],
    ['if(t==="import"||t==="from"){}', true],
    ['const grammar="@import"; const example="import \'./missing.mjs\'";', true],
    ["import { worker }from'./assets/worker.mjs';", true],
    ["export { worker } from './missing.mjs';", false],
    ["import helper from './missing.mjs';", false],
    ["import './missing.mjs';", false],
    ["await import( './missing.mjs');", false],
    ["new Worker( './missing.mjs');", false]
  ];
  for (const [source, valid] of cases) {
    const f = fixture();
    write(f.root, 'background.js', source);
    write(f.target, 'background.js', source);
    const finalize = () => pdfPackage.finalizeLocalPdfPackage({
      rootDir: f.root, buildName: f.buildName,
      evidenceManifestPath: f.evidencePath, sourceFiles: f.sourceFiles
    });
    if (valid) assert.doesNotThrow(finalize);
    else assert.throws(finalize, /MISSING_LOCAL_RESOURCE/u);
  }
});

test('rejects changed staged source, missing local resources and credential-shaped text', () => {
  {
    const f = fixture();
    write(f.target, 'core/helper.js', 'globalThis.helper = false;');
    assert.throws(() => pdfPackage.finalizeLocalPdfPackage({
      rootDir: f.root, buildName: f.buildName,
      evidenceManifestPath: f.evidencePath, sourceFiles: f.sourceFiles
    }), /PACKAGE_SOURCE_HASH_MISMATCH/u);
  }
  {
    const f = fixture();
    write(f.root, 'popup.html', '<script src="missing.js"></script>');
    write(f.target, 'popup.html', '<script src="missing.js"></script>');
    assert.throws(() => pdfPackage.finalizeLocalPdfPackage({
      rootDir: f.root, buildName: f.buildName,
      evidenceManifestPath: f.evidencePath, sourceFiles: f.sourceFiles
    }), /MISSING_LOCAL_RESOURCE/u);
  }
  {
    const f = fixture();
    write(f.root, 'background.js',
      "globalThis.missing = chrome.runtime.getURL('vendor/pdfjs/wasm/');");
    write(f.target, 'background.js',
      "globalThis.missing = chrome.runtime.getURL('vendor/pdfjs/wasm/');");
    assert.throws(() => pdfPackage.finalizeLocalPdfPackage({
      rootDir: f.root, buildName: f.buildName,
      evidenceManifestPath: f.evidencePath, sourceFiles: f.sourceFiles
    }), /MISSING_LOCAL_RESOURCE/u);
  }
  assert.equal(pdfPackage.findCredentialPattern('apiKey = "fixture"'), '');
  assert.equal(pdfPackage.findCredentialPattern(
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890'
  ), 'bearer-token');
});
