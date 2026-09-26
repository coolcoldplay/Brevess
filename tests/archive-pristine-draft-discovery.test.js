const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const figures = require('../core/figure-workspace.js');
const workspaceApi = require('../core/article-workspace.js');
const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
function fn(name, deps = {}) {
  let start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  return Function(...Object.keys(deps), `return (${source.slice(start, next < 0 ? source.length : start + 1 + next).trim()});`)(...Object.values(deps));
}
function restore() {
  const workspace = { workspaceId:'workspace:'+'a'.repeat(64), workspaceGeneration:1,
    canonicalUrl:'https://example.org/paper', directoryName:'Paper--'+'a'.repeat(16),
    contentHash:'b'.repeat(64), revision:1 };
  const content = {...figures.createFigureWorkspaceDraft([]), binding:{...workspace,documentId:'doc:paper',documentHash:'b'.repeat(64)}};
  const asset={relativePath:'figures/workspace-draft.json',content,revision:1,contentHash:'fixture'};
  const manifest=workspaceApi.createWorkspaceManifest(workspace,[{path:asset.relativePath,revision:1,contentHash:'aabbccdd',byteSize:100}]);
  return {match:'exact',manifest,assets:[asset],turns:[]};
}
const classify = () => fn('isPristineFigureOnlyWorkspaceRestore',{SciLLM:figures});
function withBaselines(value = restore()) {
  const paragraph = { paragraphId:'p1', sourceKey:'p1', sourceIdentity:'p1', text:'Source text.',
    textHash:'hash', displayText:'Source text.', sectionId:'s1', sectionKind:'results',
    sectionTitle:'Results', displaySectionTitle:'Results', sectionPath:['Results'], navigationRevision:1 };
  const structure = {documentId:'doc:paper', documentHash:'hash', title:'Paper',
    url:value.manifest.canonicalUrl, publisherFamily:'generic', revision:1, diagnostics:null,
    nodes:[{sectionId:'s1',sourceKey:'s1',title:'Results',displayTitle:'Results',
      level:1,order:0,paragraphCount:1,sectionKind:'results',analysisSectionIds:['s1'],
      analysisLeafSectionIds:['s1'],analysisSelected:true,analysisIndeterminate:false,children:[]}]};
  for (const [path,content] of [['article/paragraphs.json',{revision:1,paragraphs:[paragraph]}],
    ['article/structure.json',structure]]) {
    value.assets.push({relativePath:path,content,revision:1});
    value.manifest.assets.push({path,revision:1,contentHash:'aabbccdd',byteSize:100});
  }
  return value;
}
test('exact untouched automatic draft is not a saved result and object key order is immaterial',()=>{
  const value=restore(); assert.equal(classify()(value),true);
  value.assets[0].content=Object.fromEntries(Object.entries(value.assets[0].content).reverse());
  assert.equal(classify()(value),true);
});
test('later automatic paragraph/structure baselines do not turn the pristine draft into saved results',()=>{
  const value=withBaselines();
  value.assets.reverse();assert.equal(classify()(value),true);
  value.assets.push({...value.assets[0]});assert.equal(classify()(value),false);
});
for (const [name,mutate] of [
  ['user deselected Results', r=>{r.assets[2].content.nodes[0].analysisSelected=false;}],
  ['user selected Methods', r=>{r.assets[1].content.paragraphs[0].sectionKind='methods';r.assets[2].content.nodes[0].sectionKind='methods';}],
  ['unknown structure field', r=>{r.assets[2].content.explicitUserNotes=['preserve'];}],
  ['unknown node field', r=>{r.assets[2].content.nodes[0].userNote='preserve';}],
  ['unknown paragraph field', r=>{r.assets[1].content.paragraphs[0].summary='preserve';}],
  ['incomplete baseline', r=>{r.assets.pop();r.manifest.assets.pop();}],
  ['unknown analysis leaf', r=>{r.assets[2].content.nodes[0].analysisLeafSectionIds=['unknown'];}]
]) test(`keeps baseline semantics: ${name}`,()=>{
  const value=withBaselines();mutate(value);assert.equal(classify()(value),false);
});
test('default excluded Methods and mixed parent selection remain pristine',()=>{
  const value=withBaselines();
  const result=value.assets[2].content.nodes[0];
  const methods={...result,sectionId:'s2',sectionKind:'methods',analysisSectionIds:['s2'],
    analysisLeafSectionIds:['s2'],analysisSelected:false};
  value.assets[1].content.paragraphs.push({...value.assets[1].content.paragraphs[0],paragraphId:'p2',sectionId:'s2',sectionKind:'methods'});
  value.assets[2].content.nodes=[{...result,sectionId:'root',paragraphCount:0,
    analysisSectionIds:['root','s1','s2'],analysisLeafSectionIds:['s1','s2'],
    analysisSelected:false,analysisIndeterminate:true,children:[result,methods]}];
  assert.equal(classify()(value),true);
});
function withBibliography() {
  const value=withBaselines();
  const workspace={...value.manifest};
  const metadata=[['citation_journal_title','Example Journal'],['citation_publication_date','2024-03-12']];
  const document={head:{querySelectorAll:()=>metadata.map(([name,content])=>({
    getAttribute:key=>({name,content}[key]??null)
  }))}};
  const bibliography={...require('../core/article-bibliography.js').extractArticleBibliography(document,
    {canonicalUrl:workspace.canonicalUrl}),workspaceId:workspace.workspaceId};
  const path='article/bibliography.json';
  value.assets.push({relativePath:path,content:bibliography,revision:1});
  value.manifest.assets.push({path,revision:1,contentHash:'aabbccdd',byteSize:100});
  const ensured={success:true,workspace,archiveIdentity:{documentId:'doc:paper',documentHash:'hash',
    canonicalUrl:workspace.canonicalUrl},bibliographyBaseline:structuredClone(bibliography)};
  return {value,ensured};
}
test('only fresh same-owner raw bibliography identical to current extraction is an automatic baseline',()=>{
  const {value,ensured}=withBibliography();assert.equal(classify()(value,ensured),true);
});
for (const [name,mutate] of [
  ['missing fresh extraction',(_r,e)=>{e.bibliographyBaseline=null;}],
  ['changed saved value',r=>{r.assets[3].content.journal.value='Manual journal';}],
  ['changed saved raw evidence',r=>{r.assets[3].content.journal.evidence[0].raw='Manual journal';}],
  ['unknown edited metadata',r=>{r.assets[3].content.manualNote='Keep this';}],
  ['explicit cleared bibliography',r=>{r.assets[3].content={};}],
  ['wrong current owner',(_r,e)=>{e.workspace.workspaceId='workspace:other';}],
  ['wrong current generation',(_r,e)=>{e.workspace.workspaceGeneration=2;}],
  ['wrong current URL',(_r,e)=>{e.workspace.canonicalUrl='https://example.org/other';}],
  ['changed current document',(_r,e)=>{e.archiveIdentity.documentHash='different';}],
  ['foreign raw bibliography', (r,e)=>{r.assets[3].content.workspaceId=e.bibliographyBaseline.workspaceId='workspace:other';}]
]) test(`preserves bibliography boundary: ${name}`,()=>{
  const {value,ensured}=withBibliography();mutate(value,ensured);assert.equal(classify()(value,ensured),false);
});
for (const [name, mutate] of [
  ['explicit empty edit',r=>{r.assets[0].content.revision=1;}],
  ['human-reviewed empty',r=>{r.assets[0].content.meta.backgroundItems[0].humanReviewed=true;}],
  ['empty edited timestamp',r=>{r.assets[0].content.meta.backgroundItems[0].editedAt=123;}],
  ['actual text',r=>{r.assets[0].content.meta.backgroundItems[0].value='Saved user text';}],
  ['figure descriptors',r=>{r.assets[0].content.figures={f1:{}};}],
  ['review tombstone',r=>{r.assets[0].content.mechanismChain.reviewTombstones.nodes=['deleted'];}],
  ['unknown future field',r=>{r.assets[0].content.newField='';}],
  ['incompatible schema',r=>{r.assets[0].content.schemaVersion=6;}],
  ['stored chat',r=>{r.turns=[{turnId:'saved'}];}],
  ['extra cleared asset',r=>{r.assets.push({relativePath:'annotations/manual.json',content:{annotations:[]}});}],
  ['missing manifest asset',r=>{r.manifest.assets=[];}],
  ['extra manifest asset',r=>{r.manifest.assets.push({...r.manifest.assets[0],path:'chat/tombstones/deleted.json'});}],
  ['wrong binding',r=>{r.assets[0].content.binding.workspaceGeneration=2;}],
  ['content changed',r=>{r.match='content-changed';}]
  ,['new generation after workspace clear',r=>{r.manifest.workspaceGeneration=2;r.assets[0].content.binding.workspaceGeneration=2;}]
]) test(`never falls through ${name}`,()=>{const value=restore();mutate(value);assert.equal(classify()(value),false);});

function directoryHarness(value, allowMissing=true) {
  const calls=[];const context={tabId:1};
  const run=fn('restoreCurrentArticleWorkspaceFromDirectory',{
    capturePanelContext:()=>context,isCurrentPanelContext:()=>true,
    resolveArticleWorkspaceDirectoryPermission:async()=> 'granted',
    sendTabMessage:async(_,message)=>{calls.push(message.action);if(message.action==='ensureArticleWorkspace')return {success:true,workspace:value.manifest,archiveIdentity:{documentId:'doc:paper',documentHash:'hash'}};throw Error('UNEXPECTED_APPLY');},
    assertArticleWorkspaceRestorePanelReady:()=>{},
    sendLlmMessage:async()=>({permission:'granted',restore:value}),
    isPristineFigureOnlyWorkspaceRestore:classify(),
    buildArticleWorkspaceRestoreTarget:()=>{calls.push('target');throw Error('PROTECTED_EXISTING_APPLY');}
  });
  return {calls,run:()=>run({panelContext:context,allowMissing})};
}
test('automatic and explicit optional directory discovery skip pristine draft before apply or commit',async()=>{
  const h=directoryHarness(restore());assert.equal(await h.run(),null);assert.deepEqual(h.calls,['ensureArticleWorkspace']);
});
test('edited empty drafts and required workspace scans retain existing protected restore path',async()=>{
  for(const required of [true,false]) {
    const value=restore();if(!required)value.assets[0].content.revision=1;
    const h=directoryHarness(value,!required);await assert.rejects(h.run(),/PROTECTED_EXISTING_APPLY/);assert.equal(h.calls.at(-1),'target');
  }
});
test('explicit scan of a pristine draft uses the existing guarded legacy load context',async()=>{
  const context={tabId:1};let loaded=0;
  const run=fn('scanArticleWorkspaceForContext',{
    isCurrentPanelContext:()=>true,currentArticleArchiveProbe:null,
    resolveArticleWorkspaceDirectoryPermission:async()=> 'granted',
    sendTabMessage:async()=>({success:true,workspace:{workspaceId:'paper'},archiveIdentity:{documentId:'doc:paper'}}),
    assertArticleWorkspaceRestorePanelReady:()=>{},sendLlmMessage:async()=>({permission:'granted',restore:restore()}),
    isPristineFigureOnlyWorkspaceRestore:classify(),
    loadArticleArchiveForContext:async value=>{assert.equal(value.panelContext,context);loaded++;return 'loaded';},
    buildArticleWorkspaceRestoreTarget:()=>{throw Error('EMPTY_DRAFT_SHOULD_NOT_COMMIT');},
    describeArticleWorkspaceRestoreError:e=>e.message,showStatus:message=>{throw Error(message);}
  });
  assert.equal(await run({panelContext:context,permissionTicket:'ticket'}),'loaded');assert.equal(loaded,1);
});

for (const [name,decision,proofChange,expectProbe] of [
  ['old automatic empty restore','workspace-auto-restored',()=>{},true],
  ['explicit skip','skipped',()=>{},false],
  ['existing manual results','current-workspace',()=>{},false],
  ['explicit loaded workspace','workspace-loaded',()=>{},false],
  ['missing local proof','workspace-auto-restored',p=>{p.identity=null;},false],
  ['other document','workspace-auto-restored',p=>{p.identity.documentId='doc:other';},false],
  ['different content','workspace-auto-restored',p=>{p.identity.documentHash='new';},false],
  ['stale panel','workspace-auto-restored',p=>{p.panelContext.tabId=2;},false]
]) test(`pristine discovery decision: ${name}`,async()=>{
  const identity={documentId:'doc:paper',documentHash:'hash',canonicalUrl:'https://example.org/paper'};
  const proof={identity:{...identity},panelContext:{tabId:1}};proofChange(proof);
  let probes=0;
  const run=fn('probeCurrentArticleArchive',{
    articleArchivePromptDecisionRevision:0,
    currentArticleArchiveIdentity:()=>identity,setArticleArchivePrompt:()=>{},
    workspaceAlreadyHasArticleResults:()=>false,
    readArticleArchivePromptDecision:async()=>({decision,...identity}),
    isCurrentPanelContext:c=>c.tabId===1,
    sendLlmMessage:async()=>{probes++;return {available:true};},
    document:{getElementById:()=>null}
  });
  await run({pristineBaselineProof:proof});assert.equal(probes,expectProbe?1:0);
});

for (const change of ['skip', 'stale-panel', 'changed-hash', 'new-results', 'decision-during-final-read']) {
  test(`late probe cannot revive a stale history card: ${change}`,async()=>{
    const identity={documentId:'doc:paper',documentHash:'hash',canonicalUrl:'https://example.org/paper'};
    const original={...identity};let current=true,hasResults=false,decision='workspace-auto-restored',reads=0;
    const prompts=[];
    const state={
      articleArchivePromptDecisionRevision:0,
      currentArticleArchiveIdentity:()=>({...identity}),setArticleArchivePrompt:p=>prompts.push(p),
      workspaceAlreadyHasArticleResults:()=>hasResults,isCurrentPanelContext:()=>current,
      readArticleArchivePromptDecision:async()=>{
        reads++;
        if(change==='decision-during-final-read'&&reads===2)state.articleArchivePromptDecisionRevision++;
        return {decision,...original};
      },
      sendLlmMessage:async()=>{
        if(change==='skip')decision='skipped';
        if(change==='stale-panel')current=false;
        if(change==='changed-hash')identity.documentHash='changed';
        if(change==='new-results')hasResults=true;
        return {found:true};
      },
      document:{getElementById:()=>null}
    };
    const run=require('node:vm').runInNewContext('('+fn('probeCurrentArticleArchive').toString()+')',state);
    await run({pristineBaselineProof:{identity:original,panelContext:{tabId:1}}});
    assert.equal(prompts.some(p=>p?.found),false);
  });
}
