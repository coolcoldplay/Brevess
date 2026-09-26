const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reader = fs.readFileSync(path.join(__dirname,'../pdf-native-reader.mjs'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../pdf-reader.css'),'utf8');

test('standalone PDF page supplies the PDF.js TextLayer scale variables for each zoom and user unit',()=>{
  const properties = new Map();
  const style = {setProperty:(key,value)=>properties.set(key,value)};
  const record = {page:{userUnit:2,getViewport:({scale})=>({scale,width:600*2*scale,height:800*2*scale})},
    section:{classList:{remove(){}},style}};
  const source=reader.slice(reader.indexOf('function updateRecordViewport('),reader.indexOf('function renderPdfAnnotationOverlay('));
  const sandbox={renderPdfAnnotationOverlay(){}};
  vm.runInNewContext(source,sandbox);
  for(const scale of [1,1.97,3]) {
    sandbox.updateRecordViewport(record,scale);
    assert.equal(properties.get('--user-unit'),'2');
    assert.equal(properties.get('--scale-factor'),String(scale));
    assert.equal(record.section.style.width,`${600*2*scale}px`);
  }
  const rules=css.match(/\.pdf-native-page\s*\{([^}]+)\}/)[1];
  assert.match(rules,/--total-scale-factor:\s*calc\(var\(--scale-factor\)\s*\*\s*var\(--user-unit\)\)/);
  assert.match(rules,/--scale-round-x:\s*1px/);
  assert.match(rules,/--scale-round-y:\s*1px/);
});
