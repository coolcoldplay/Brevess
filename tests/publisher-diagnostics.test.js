const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(globalThis.SciLLM || (globalThis.SciLLM = {}),
  require('../core/publisher-adapters.js'));
Object.assign(globalThis.SciLLM, require('../core/article-structure.js'));
Object.assign(globalThis.SciLLM, require('../core/article-extractor.js'));
const diagnosticsApi = require('../core/publisher-diagnostics.js');

function createDiagnosticDocument({
  html = '<html><body><main id="main-content" class="article-page"><h2 id="introduction">Introduction</h2><div class="Body">FULL ARTICLE PARAGRAPH</div></main></body></html>'
} = {}) {
  const heading = {
    tagName: 'H2', id: 'introduction', className: 'section-title',
    textContent: 'Introduction', outerHTML: '<h2 id="introduction">Introduction</h2>',
    parentElement: null, getAttribute: () => null,
    querySelectorAll: () => [], querySelector: () => null
  };
  const paragraph = {
    tagName: 'DIV', id: '', className: 'Body', textContent: 'FULL ARTICLE PARAGRAPH',
    outerHTML: '<div class="Body">FULL ARTICLE PARAGRAPH</div>',
    parentElement: null, getAttribute: () => null,
    querySelectorAll: () => [], querySelector: () => null
  };
  const main = {
    tagName: 'MAIN', id: 'main-content', className: 'article-page',
    textContent: `${heading.textContent} ${paragraph.textContent}`,
    outerHTML: '<main id="main-content" class="article-page"><h2 id="introduction">Introduction</h2><div class="Body">FULL ARTICLE PARAGRAPH</div></main>',
    parentElement: null, getAttribute: () => null,
    querySelector: () => heading,
    querySelectorAll: selector => {
      if (selector === '*') return [heading, paragraph];
      if (selector === ':scope > *') return [heading, paragraph];
      if (selector.includes('h1') || selector.includes('[role="heading"]')) return [heading];
      if (selector === '.Body') return [paragraph];
      return [];
    }
  };
  heading.parentElement = main;
  paragraph.parentElement = main;
  return {
    title: 'Diagnostic fixture',
    location: {
      href: 'https://www.cell.com/cell/fulltext/S0000-0000(00)00000-0',
      hostname: 'www.cell.com',
      pathname: '/cell/fulltext/S0000-0000(00)00000-0',
      search: ''
    },
    readyState: 'complete',
    characterSet: 'UTF-8',
    contentType: 'text/html',
    documentElement: { outerHTML: html },
    body: main,
    querySelectorAll: selector => {
      if (selector === '*') return [main, heading, paragraph];
      if (selector === 'iframe') return [];
      if (selector === '.Body') return [paragraph];
      if (selector.includes('main') || selector.includes('.Body')) return [main, paragraph];
      if (selector.includes('h1') || selector.includes('[role="heading"]')) return [heading];
      return [];
    },
    querySelector: () => main,
    getElementById: id => id === 'introduction' ? heading : null
  };
}

test('builds a v2 adapter bundle with rendered article DOM and selector coverage', () => {
  const documentRef = createDiagnosticDocument({
    html: '<html><body><main class="new-cell-body"><h2>Mechanisms</h2>' +
      '<p>FULL ARTICLE PARAGRAPH</p><script>window.secret = 1</script></main></body></html>'
  });
  const report = diagnosticsApi.buildAdapterDiagnosticBundle(documentRef, {
    extensionVersion: '2.1.1',
    contentRevision: '2.1.1-diagnostic-r1',
    trace: [{ stage: 'extract', status: 'failed', error: { message: 'boom' } }]
  });

  assert.equal(report.kind, 'sci-publisher-adapter-diagnostic');
  assert.equal(report.schemaVersion, 2);
  assert.match(report.dom.documentHtml, /FULL ARTICLE PARAGRAPH/);
  assert.doesNotMatch(report.dom.documentHtml, /window\.secret = 1/);
  assert.equal(report.trace[0].status, 'failed');
  assert.ok(report.selectorCoverage.length > 0);
  assert.ok(report.candidates.some(item => /FULL ARTICLE PARAGRAPH/.test(item.html)));
  assert.equal(diagnosticsApi.validateAdapterDiagnosticBundle(report), report);
});

test('diagnostic bundle never reruns the extractor diagnostic', () => {
  const original = globalThis.SciLLM.diagnoseArticleExtraction;
  let calls = 0;
  globalThis.SciLLM.diagnoseArticleExtraction = () => {
    calls += 1;
    throw new Error('extractor crashed');
  };
  try {
    const report = diagnosticsApi.buildAdapterDiagnosticBundle(createDiagnosticDocument());
    assert.equal(report.kind, 'sci-publisher-adapter-diagnostic');
    assert.equal(report.extraction.available, false);
    assert.equal(calls, 0);
    assert.ok(report.selectorCoverage.length > 0);
  } finally {
    globalThis.SciLLM.diagnoseArticleExtraction = original;
  }
});

test('records bounded extraction traces with serialized errors', () => {
  let time = Date.parse('2026-07-17T00:00:00.000Z');
  const recorder = diagnosticsApi.createExtractionTraceRecorder({
    limit: 2,
    now: () => (time += 10)
  });
  const first = recorder.begin({ source: 'prepare', stage: 'extract_article' });
  recorder.complete(first, { paragraphCount: 3 });
  const second = recorder.begin({ source: 'outline', stage: 'extract_structure' });
  recorder.fail(second, new Error('bad selector'));
  const third = recorder.begin({ source: 'workspace', stage: 'extract_article' });
  recorder.complete(third, { paragraphCount: 9 });
  const snapshot = recorder.snapshot();

  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0].status, 'failed');
  assert.match(snapshot[0].error.message, /bad selector/);
  assert.equal(snapshot[1].paragraphCount, 9);
  assert.ok(snapshot[1].durationMs >= 0);
});

test('compatibility diagnostic wrapper returns the v2 bundle', () => {
  const report = diagnosticsApi.buildPublisherDiagnostic(createDiagnosticDocument());
  assert.equal(report.kind, 'sci-publisher-adapter-diagnostic');
  assert.equal(report.publisher.family, 'elsevier');
});
