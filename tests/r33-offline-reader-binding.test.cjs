'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../output/r33-figure-flow/offline-diagnosis/probes.cjs');
test('owned offline reader for an existing saved workspace is a readable article entry',()=>{
 assert.equal(P.readable(),true,'Toolbar must admit an owned offline reader to a subsequent validated workspace binding.');
});
test('confirmed saved-workspace reader activation reaches its dedicated adapter without generic injection',async()=>{
 const result=await P.activate();assert.equal(result.response.success,true,'Saved workspace entry must not be rejected as an unsupported extension page.');
 assert.equal(result.activated,1);assert.equal(result.injected,0);
});
test('offline reader validates saved-workspace binding before loading its source HTML',async()=>{
 const result=await P.reader();
 assert.equal(result.requests[0].type,'OFFLINE_ARTICLE_GET_SNAPSHOT');
 assert.equal(result.requests[1].type,'ARTICLE_WORKSPACE_GET_ASSET');
 assert.equal(result.elements.get('offlineArticleStartReading').disabled,false);
 assert.equal(result.elements.get('offlineArticleFrame').srcdoc,result.html);
});
test('current reader really loads only its bound offline asset, providing a source-display control',async()=>{
 const result=await P.reader();assert.equal(result.requests.length,2);
 assert.equal(result.requests[1].type,'ARTICLE_WORKSPACE_GET_ASSET');assert.equal(result.requests[1].workspaceId,P.WORKSPACE);
 assert.equal(result.elements.get('offlineArticleFrame').srcdoc,result.html);
 assert.match(result.elements.get('offlineArticleStatus').textContent,/已从本机恢复网页/);
});
test('unrelated extension settings pages remain unreadable',()=>{
 assert.equal(P.readable(`chrome-extension://${P.EXTENSION}/options.html`),false);
});
test('existing publisher and PDF reader paths remain readable controls',()=>{
 assert.equal(P.readable('https://www.nature.com/articles/s41590-025-02126-6'),true);
 assert.equal(P.readable(`chrome-extension://${P.EXTENSION}/pdf-reader.html?source=https://journal.test/a.pdf`),true);
});
