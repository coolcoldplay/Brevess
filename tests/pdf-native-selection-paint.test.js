const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reader=fs.readFileSync(path.join(__dirname,'../pdf-native-reader.mjs'),'utf8');
const source=reader.slice(reader.indexOf('let nativeSelectionPaintFrame ='),reader.indexOf('async function ensureMountedPageTextLayer('));
function fixture(options={}) {
  const calls=[];
  const section={querySelector:()=>({remove(){calls.push('remove');}}),classList:{remove(){calls.push('class-clear');}}};
  const context=vm.createContext({active:true,disposed:false,lifecycle:{isTerminal:()=>false},
    viewer:{querySelectorAll:selector=>selector==='.pdf-native-page'?[section]:[{}]},
    document:{getSelection(){calls.push('read-selection');return {rangeCount:1,isCollapsed:false,
      getRangeAt(){return {intersectsNode(){throw new Error('detached range');}}}};}},
    cancelAnimationFrame:id=>calls.push(`cancel:${id}`),...options});
  vm.runInContext(source,context);
  return {context,calls};
}
test('selection paint retires its pending animation before source teardown',()=>{
  const {context,calls}=fixture();
  vm.runInContext('nativeSelectionPaintFrame=7; cancelNativeSelectionPaint();',context);
  assert.deepEqual(calls,['cancel:7','remove','class-clear']);
  assert.equal(vm.runInContext('nativeSelectionPaintFrame',context),0);
  for(const name of ['deactivate','releaseNativeResources']) {
    const body=reader.slice(reader.indexOf(`function ${name}(`));
    assert.match(body.slice(0,body.indexOf('\n}')),/cancelNativeSelectionPaint\(\)/);
  }
});
test('disposed, inactive and terminal readers never read a stale selection',()=>{
  for(const options of [{disposed:true},{active:false},{lifecycle:{isTerminal:()=>true}}]) {
    const {context,calls}=fixture(options);
    vm.runInContext('paintNativeSelection()',context);
    assert.equal(calls.includes('read-selection'),false);
  }
});
test('selection paint clears safely when a selected text layer was detached',()=>{
  const {context,calls}=fixture();
  assert.doesNotThrow(()=>vm.runInContext('paintNativeSelection()',context));
  assert.ok(calls.includes('remove'));
});
