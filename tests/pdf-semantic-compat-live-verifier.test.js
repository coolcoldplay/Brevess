const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const verifierPath = path.join(__dirname, '..', 'scripts',
  'verify-pdf-semantic-compat-live.mjs');

test('B2 live sample resolves navigation targets with full-document offsets', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const start = source.indexOf('globalThis.__b2ResolveSample = adapter =>');
  const end = source.indexOf('\n    };', start);
  assert.ok(start >= 0 && end > start, 'B2 sample helper is missing');
  const helper = source.slice(start, end);
  assert.match(helper, /adapter\?\.semanticNavigation/u);
  assert.match(helper, /paragraphTargets/u);
  assert.match(helper, /target\?\.normalizedStart/u);
  assert.match(helper, /target\?\.normalizedEnd/u);
  assert.match(helper, /start <= 0/u);
  assert.match(helper, /target\?\.expectedNormalizedQuote/u);
  assert.match(helper,
    /resolvePdfSemanticRange\?\.\(\s*target\.paragraphId, start, end, quote\)/u);
  assert.doesNotMatch(helper, /semantic\?\.index\?\.sentences/u);
  assert.doesNotMatch(helper, /\.indexOf\(quote\)/u,
    'paragraph-local offsets must never be passed to the compatibility adapter');
  assert.doesNotMatch(source, /normalizedText \|\| ''\)\.indexOf\(quote\)/u,
    'all compatibility diagnostics must use full-document navigation offsets');
  assert.match(source, /B2_SAMPLE_DID_NOT_USE_DOCUMENT_GLOBAL_OFFSET/u);
  assert.match(source, /B2_NAVIGATION_TARGET_LENGTH_MISMATCH/u);
  assert.match(source, /B2_NAVIGATION_TARGET_OFFSETS_OVERLAP/u);
});
