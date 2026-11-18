const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/core/chat-diagram-viewer.js');

function fixture() {
  const values = {}, calls = [];
  const session = {
    set: async value => Object.assign(values, value),
    get: async key => ({ [key]: values[key] }),
    remove: async key => { delete values[key]; }
  };
  return { values, calls, chromeApi: {
    storage: { session }, runtime: { getURL: path => 'chrome-extension://test/' + path },
    windows: { create: async value => { calls.push(value); } }
  } };
}

test('expanded view preserves exact Mermaid source without serializing rendered HTML', async () => {
  const f = fixture(), source = 'flowchart LR\n  A["输入 α-synuclein"] --> B["预测结构"]';
  await D.open(source, { chromeApi:f.chromeApi, screen:{ availWidth:1512, availHeight:900 }, title:'论文标题' });
  const window = f.calls[0];
  assert.equal(window.type, 'popup');
  assert.equal(window.width, 1440);
  assert.equal(window.height, 900);
  assert.equal(window.state, undefined);
  const value = await D.consume(window.url.split('#')[1], { storage:f.chromeApi.storage.session });
  assert.deepEqual(value, { source, title:'论文标题' });
  assert.deepEqual(f.values, {});
  await assert.rejects(D.consume(window.url.split('#')[1], { storage:f.chromeApi.storage.session }), /过期/);
});

test('model directives cannot override strict Mermaid renderer configuration', async () => {
  const f = fixture();
  for (const source of ['', null, 'x'.repeat(20001), '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B', '---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B']) {
    await assert.rejects(D.open(source, { chromeApi:f.chromeApi }), /内容无效/);
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.values, {});
});

test('failed window creation removes the temporary diagram snapshot', async () => {
  const f = fixture();
  f.chromeApi.windows.create = async () => { throw Error('window unavailable'); };
  await assert.rejects(D.open('flowchart LR\nA-->B', { chromeApi:f.chromeApi }), /window unavailable/);
  assert.deepEqual(f.values, {});
});

test('expired and invalid snapshots cannot open diagrams or read arbitrary session keys', async () => {
  const f = fixture();
  await D.open('flowchart LR\nA-->B', { chromeApi:f.chromeApi });
  const id = f.calls[0].url.split('#')[1], key = D.PREFIX + id;
  f.values[key].createdAt = 1000;
  await assert.rejects(D.consume(id, { storage:f.chromeApi.storage.session, now:602000 }), /过期/);
  assert.deepEqual(f.values, {});
  await assert.rejects(D.consume('private-setting', { storage:{ get:() => assert.fail('must not read unrelated keys') } }), /重新打开/);
});

test('PNG export uses crisp native diagram dimensions and bounds memory for very large graphs', () => {
  assert.deepEqual(D.pngDimensions(600, 400), { width:1200, height:800 });
  for (const [width,height] of [[20000,1000],[1000,20000],[10000,10000]]) {
    const size = D.pngDimensions(width,height);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height <= 16000000);
    assert.ok(Math.abs(size.width / size.height - width / height) < .03);
  }
  assert.throws(() => D.pngDimensions(NaN, 100));
});

test('copy starts during user gesture and transfers the completed PNG, not SVG text', async () => {
  let resolve, writeStarted = false;
  const png = new Blob(['png'], { type:'image/png' });
  const pending = new Promise(done => { resolve = done; });
  class Item { constructor(data) { this.data = data; } }
  const copying = D.copyPng({}, { toPng:() => pending, ClipboardItem:Item, clipboard:{
    write: async items => {
      writeStarted = true;
      assert.deepEqual(Object.keys(items[0].data), ['image/png']);
      assert.equal(await items[0].data['image/png'], png);
    }
  } });
  assert.equal(writeStarted, true);
  resolve(png);
  await copying;
});

test('clipboard denial is reported instead of claiming the picture was copied', async () => {
  class Item { constructor(data) { this.data = data; } }
  await assert.rejects(D.copyPng({}, { toPng:async () => new Blob(), ClipboardItem:Item,
    clipboard:{ write:async () => { throw Error('clipboard denied'); } } }), /clipboard denied/);
});
