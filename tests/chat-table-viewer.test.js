const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../core/chat-table-viewer.js');
const text = textContent => ({nodeType:3,textContent});
const cell = (value,header=false) => ({tagName:header?'TH':'TD',style:{textAlign:'left'},textContent:value,childNodes:[text(value)]});
const table = () => ({rows:[{cells:[cell('Paper',true),cell('Relation',true)]},{cells:[cell('α-synuclein'),cell('Prior study')]}]});
test('table snapshot retains all columns, Unicode, inline links and no executable markup',()=>{
 const value=T.capture(table(),'Paper title');assert.equal(value.rows.length,2);assert.equal(value.rows[1][0].text,'α-synuclein');
 assert.equal(T.inline({tagName:'SCRIPT',childNodes:[text('bad()')]}).text,'');
 assert.equal(T.inline({tagName:'A',href:'javascript:bad()',childNodes:[text('link')]}).href,'');
 assert.equal(T.inline({tagName:'A',href:'https://doi.org/10.1038/test',childNodes:[text('study')]}).href,'https://doi.org/10.1038/test');
});
test('table opens a real wide extension popup and cleans up a failed open',async()=>{
 const stored={},calls=[];const chromeApi={storage:{session:{set:async x=>Object.assign(stored,x),remove:async k=>delete stored[k]}},runtime:{getURL:p=>'chrome-extension://test/'+p},windows:{create:async x=>calls.push(x)}};
 await T.open(table(),{chromeApi,screen:{availWidth:1440,availHeight:900},title:'test'});
 assert.equal(calls[0].width,1280);assert.equal(calls[0].type,'popup');assert.equal(calls[0].height,820);assert.equal(Object.keys(stored).length,1);
 chromeApi.windows.create=async()=>{throw Error('failure');};await assert.rejects(T.open(table(),{chromeApi,title:'test'}),/failure/);assert.equal(Object.keys(stored).length,1);
});
