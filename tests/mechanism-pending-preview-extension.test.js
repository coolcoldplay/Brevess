const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
  'verify-mechanism-pending-preview-extension.mjs'), 'utf8');

test('pending-preview browser verifier uses the current production modules', () => {
  assert.match(source, /SCI_EXTENSION_ROOT/u);
  assert.match(source, /SCI_QA_OUTPUT_DIR/u);
  assert.match(source, /core\/figure-workspace\.js/u);
  assert.match(source, /core\/mechanism-network\.js/u);
  assert.match(source, /core\/mechanism-pending-preview\.js/u);
  assert.match(source, /vendor\/mermaid\/mermaid\.min\.js/u);
  assert.match(source, /report\.sourceHashes/u);
});

test('browser verifier covers needs-review, isolated nodes, and every non-relation Panel class', () => {
  assert.match(source, /status: 'needs_review'/u);
  assert.match(source, /Astrocyte state/u);
  assert.match(source, /node_observation/u);
  assert.match(source, /inconclusive/u);
  assert.match(source, /ambiguous_target/u);
  assert.match(source, /excluded_schematic/u);
  assert.match(source, /figure-4:A/u);
});

test('browser verifier rejects invalid input and proves read-only storage behavior', () => {
  assert.match(source, /replace\('node-v2-', 'node-v1-'\)/u);
  assert.match(source, /rejectedIsNull/u);
  assert.match(source, /invalidChangedHost/u);
  assert.match(source, /qaSavedMechanismChain/u);
  assert.match(source, /rendered\.before === rendered\.after/u);
  assert.match(source, /querySelectorAll\('button,input,select,textarea,\[contenteditable\]'\)/u);
});

test('browser verifier blocks the network and records visual evidence', () => {
  assert.match(source, /context\.route\(\/\^https\?:/u);
  assert.match(source, /realApiCalls === 0/u);
  assert.match(source, /mechanism-pending-preview\.png/u);
  assert.match(source, /report\.json/u);
  assert.match(source, /await run\(\);\s*$/u);
});
