'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const messenger=require('../core/tab-messenger.js'),{executeContentRevisionAssignment}=require('./helpers/content-revision-runtime.js'),{createTabMessengerNavigationHarness}=require('./helpers/tab-messenger-navigation-harness.js');
const old='1.0.1-reliability-r32-paragraph-notes-v16';
const previous='1.0.1-reliability-r33-figure-source-v17';
const current='1.0.1-reliability-r34-figure-retry-v18';
test('R33 source lease revision replaces the F19 receiver and loads the helper before content',()=>{
 assert.equal(messenger.CONTENT_SCRIPT_REVISION,current);assert.equal(executeContentRevisionAssignment(fs.readFileSync(require.resolve('../content.js'),'utf8')),messenger.CONTENT_SCRIPT_REVISION);
 const files=messenger.CONTENT_SCRIPT_FILES;assert.ok(files.indexOf('core/figure-source-lease.js')>=0&&files.indexOf('core/figure-source-lease.js')<files.indexOf('content.js'));
});
for(const revision of [old,previous])for(const receiver of [true,false])test(`an old ${revision} page upgrades through the existing one-reload protocol (receiver=${receiver})`,async()=>{
 const tabId=(revision===previous?93401:93301)+(receiver?0:1),h=createTabMessengerNavigationHarness({tabId,url:'https://qa.test/revision-'+tabId,revision,receiver});h.current().dataset.sciLlmContentRevision=revision;
 // Real reload clears the old isolated world and main content marker; only
 // manifest's passive listeners exist until the normal full injection.
 h.onAfterReload(()=>h.navigate('https://qa.test/revision-'+tabId,{revision:'',receiver:false}));
 h.onAfterFiles(()=>{h.current().revision=messenger.CONTENT_SCRIPT_REVISION;h.current().dataset.sciLlmContentRevision=messenger.CONTENT_SCRIPT_REVISION;});
 await messenger.ensureCompatibleContentRevision(h.chromeApi,tabId);
 assert.equal(h.calls.filter(row=>row.type==='reload').length,1);assert.equal(h.calls.filter(row=>row.type==='files').length,1);assert.equal(h.current().revision,messenger.CONTENT_SCRIPT_REVISION);
});
