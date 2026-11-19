const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const directory = path.join(__dirname, '../docs/assets/demo');
function loadDemo(web, fast=false) {
  const original = new URL('https://demo.invalid/assets/demo/native/popup.html' + (web ? '?web=' + web : ''));
  const location = new URL(fast?original.href.replace('/native/','/fast/'):original.href);
  const context = vm.createContext({
    location, URL, URLSearchParams, structuredClone,
    document: {baseURI: original.href, documentElement: {lang: 'zh-CN'}, addEventListener() {}},
    addEventListener() {}, parent: {postMessage() {}}
  });
  context.window = context;
  if(web)context.parent.BV_DEMO_DATA={web,documentId:'public-web-'+web,title:'Public source',publisher:web,source:web==='github'?'https://github.com/coolcoldplay/Brevess':'https://chatgpt.com/',figures:[],paragraphs:[{id:'intro',sectionId:'intro',text:'Research evidence',heading:'Introduction'}],outline:[{sectionId:'intro',title:'Introduction',level:1,children:[],analysisSectionIds:['intro']}]};
  for (const name of ['native-transport.js', 'paper-data.js', 'web-data.js', 'native-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(directory, name), 'utf8'), context, {filename: name});
  }
  return context;
}

for (const web of ['', 'github', 'chatgpt']) {
  test(`website ${web || 'paper'} keeps tab, filter and document identities consistent`, async () => {
    const c = loadDemo(web);
    const [tab] = await c.chrome.tabs.query({active: true});
    const fetched = await c.chrome.tabs.get(tab.id);
    const filter = await c.chrome.runtime.sendMessage({type: 'WFG_UX', command: 'GET'});
    const structure = c.__websiteDemo.structure();
    assert.equal(tab.url, c.BV_DEMO_DATA.source);
    assert.equal(fetched.url, tab.url);
    assert.equal(filter.data.navigationUrl, tab.url);
    assert.equal(filter.data.documentKey, structure.documentId);
    assert.equal(structure.url, tab.url);
    const paper = c.__websiteDemo.paper();
    if (web) {
      assert.equal(paper.doi, undefined);
      assert.equal(paper.sourceDocuments[0].sourceKind, 'webpage');
      assert.ok(!/\/c\/[a-f\d-]{12}/i.test(tab.url));
    } else {
      assert.equal(paper.doi, '10.1038/s41586-021-03819-2');
      assert.equal(c.BV_DEMO_DATA.figures.length, 5);
    }
  });
}

test('web sidebar consumes the complete parent corpus and its heading hierarchy',()=>{const c=loadDemo('chatgpt');assert.equal(c.BV_DEMO_DATA,c.parent.BV_DEMO_DATA);assert.equal(c.__websiteDemo.structure().nodes,c.BV_DEMO_DATA.outline);assert.equal(c.__websiteDemo.structure().paragraphs[0].sectionId,'intro');});

test('packed website entries still resolve original UI and diagram assets',()=>{
  const c=loadDemo('github',true);
  assert.equal(c.chrome.runtime.getURL('table-viewer.html'),'https://demo.invalid/assets/demo/native/table-viewer.html');
  assert.equal(c.chrome.runtime.getURL('vendor/mermaid/mermaid.min.js'),'https://demo.invalid/assets/demo/native/vendor/mermaid/mermaid.min.js');
  assert.equal(c.__websiteDemo.paper().sourceDocuments[0].sourceKind,'webpage');
});
