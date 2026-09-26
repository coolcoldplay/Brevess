const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SNAPSHOT_BYTES,
  normalizeBaseUrl,
  validateEnhancedSnapshot,
  saveEnhancedSnapshotToZotero
} = require('../core/zotero-connector.js');

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

test('enhanced snapshot follows the Zotero Connector session protocol', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const endpoint = new URL(url).pathname.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ endpoint, method: options.method, body, headers: options.headers });
    if (endpoint === 'ping') {
      return new Response('9.0.5', {
        status: 200,
        headers: { 'X-Zotero-Version': '9.0.5' }
      });
    }
    if (endpoint === 'getSelectedCollection') {
      return jsonResponse({
        libraryID: 1,
        libraryName: 'My Library',
        libraryEditable: true,
        filesEditable: true,
        id: 42,
        name: 'Paper Reading'
      });
    }
    if (endpoint === 'saveItems') return jsonResponse({}, 201);
    if (endpoint === 'saveSingleFile') return new Response('', { status: 201 });
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };

  const result = await saveEnhancedSnapshotToZotero({
    title: 'Mechanism paper',
    url: 'https://example.org/article',
    snapshotContent: '<html><body><mark>highlight</mark></body></html>',
    figureNoteHtml: '<h1>Brevess：图解</h1>',
    chatNoteHtml: '<h1>Brevess：全文问答</h1>'
  }, { fetchImpl });

  assert.equal(result.imported, true);
  assert.equal(result.target, 'C42');
  assert.equal(result.snapshotAttached, true);
  assert.equal(result.noteAttached, true);
  assert.equal(result.notesAttached, 2);
  assert.equal(result.figureNoteAttached, true);
  assert.equal(result.chatNoteAttached, true);
  assert.deepEqual(calls.map(call => call.endpoint), [
    'ping',
    'getSelectedCollection',
    'saveItems',
    'saveSingleFile'
  ]);
  assert.equal(calls[0].headers['X-Zotero-Connector-API-Version'], '3');
  assert.equal(calls[2].body.uri, 'https://example.org/article');
  assert.equal(calls[2].body.items[0].itemType, 'webpage');
  assert.deepEqual(
    calls[2].body.items[0].notes.map(note => note.note),
    ['<h1>Brevess：图解</h1>', '<h1>Brevess：全文问答</h1>']
  );
  assert.deepEqual(
    calls[2].body.items[0].tags,
    [{ tag: 'Brevess' }, { tag: '增强网页快照' }]
  );
  assert.match(calls[3].body.snapshotContent, /<mark>highlight<\/mark>/);
  assert.equal(calls[3].body.items[0].id, calls[2].body.items[0].id);
});

test('read-only attachment targets fail before a partial Zotero item is created', async () => {
  const calls = [];
  const fetchImpl = async url => {
    const endpoint = new URL(url).pathname.split('/').pop();
    calls.push(endpoint);
    if (endpoint === 'ping') return new Response('9.0.5', { status: 200 });
    if (endpoint === 'getSelectedCollection') {
      return jsonResponse({
        libraryID: 3,
        libraryName: 'Read-only files',
        libraryEditable: true,
        filesEditable: false,
        id: null,
        name: 'Read-only files'
      });
    }
    throw new Error('A save endpoint must not be called');
  };
  await assert.rejects(
    saveEnhancedSnapshotToZotero({
      title: 'Paper',
      url: 'https://example.org/paper',
      snapshotContent: '<html><body>Paper</body></html>',
      figureNoteHtml: '<p>Figure note</p>',
      chatNoteHtml: '<p>Q&A note</p>'
    }, { fetchImpl }),
    error => error.code === 'ZOTERO_FILES_READ_ONLY'
  );
  assert.deepEqual(calls, ['ping', 'getSelectedCollection']);
});

test('Zotero endpoint and snapshot size are bounded', () => {
  assert.equal(MAX_SNAPSHOT_BYTES, 192 * 1024 * 1024);
  assert.equal(normalizeBaseUrl(), 'http://127.0.0.1:23119/connector/');
  assert.throws(
    () => normalizeBaseUrl('https://example.org/connector/'),
    error => error.code === 'ZOTERO_INVALID_ENDPOINT'
  );
  assert.throws(
    () => validateEnhancedSnapshot({
      title: 'Paper',
      url: 'https://example.org/paper',
      snapshotContent: `<html>${'x'.repeat(MAX_SNAPSHOT_BYTES)}</html>`,
      figureNoteHtml: '',
      chatNoteHtml: ''
    }),
    error => error.code === 'ZOTERO_SNAPSHOT_TOO_LARGE'
  );
});
