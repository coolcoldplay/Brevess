const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
function harness() {
  let updated;
  const forgotten=[],warmed=[],generations=new Map();
  const context=vm.createContext({chrome:{tabs:{onUpdated:{addListener(fn){updated=fn;}}}},
    tabSidePanelNavigationGenerations:generations,nextTabSidePanelNavigationGeneration:0,
    SciLLM:{forgetContentScriptState:id=>forgotten.push(id)},
    syncActivatedTabAfterUpdate:async(id,generation,tab,{warm})=>{if(warm)warmed.push(generation);}});
  vm.runInContext(source.slice(source.indexOf('chrome.tabs.onUpdated.addListener'),
    source.indexOf('chrome.tabs.onRemoved.addListener')),context);
  return {updated,forgotten,warmed,generations};
}
test('duplicate complete events share the pending content injection generation',()=>{
  const {updated,forgotten,warmed,generations}=harness();
  const tab={id:1,url:'https://example.org/article',status:'loading'};
  updated(1,{status:'loading'},tab);
  const loadingGeneration=generations.get(1);
  updated(1,{status:'complete'},{...tab,status:'complete'});
  updated(1,{status:'complete'},{...tab,status:'complete'});
  assert.deepEqual(warmed,[loadingGeneration,loadingGeneration]);
  assert.deepEqual(forgotten,[1],'complete must not discard the in-flight single-flight claim');
});
test('same-URL reload and URL navigation retire the prior document before warming',()=>{
  const {updated,generations}=harness();
  const tab={id:1,url:'https://example.org/article',status:'complete'};
  updated(1,{status:'complete'},tab);
  const initial=generations.get(1);
  updated(1,{status:'loading'},tab);
  assert.ok(generations.get(1)>initial);
  const reload=generations.get(1);
  updated(1,{status:'complete'},tab);
  assert.equal(generations.get(1),reload);
  updated(1,{url:'https://example.org/next'},{...tab,url:'https://example.org/next'});
  assert.ok(generations.get(1)>reload);
});
