const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../popup.html'),'utf8');
const script = fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8');
const source = (start,end) => script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)));
function harness() {
  const elements = new Map();
  const make = id => ({id,hidden:true,open:false,dataset:{},classList:{toggle(){}},setAttribute(k,v){this[k]=v;}});
  for (const id of ['sidePanelApp','highlightControls','openLiteratureNote','literatureNoteDrawer','figurePanelHeaderFieldsControl','navigationOutlineControls']) elements.set(id,make(id));
  const views = ['navigation','highlights','figures','chat','notes','mechanism'].map(name=>Object.assign(make(name),{dataset:{workspaceView:name}}));
  const buttons = views.filter(x=>x.id!=='mechanism').map(x=>Object.assign(make(x.id),{dataset:{workspaceTarget:x.id}}));
  const toolGroups = ['navigation','highlights','figures','notes'].map(name=>Object.assign(
    name === 'navigation' ? elements.get('navigationOutlineControls') : make(name+'Tools'),
    {dataset:{workspaceTools:name}}
  ));
  const context = {
    activeWorkspaceView:'navigation',literatureNoteOpenSequence:0,literatureNoteDocumentState:null,
    activePanelTabContext:{key:'paper-a'},sidebarFocusModeController:null,saves:0,loads:0,renders:0,
    document:{getElementById:id=>elements.get(id),querySelectorAll:selector=>selector==='[data-workspace-tools]'?toolGroups:selector==='[data-workspace-view]'?views:buttons},
    scheduleActiveWorkspaceUiStateSave(){context.saves++;},closeFigurePanelHeaderFieldsMenu(){},
    scheduleLiteratureNoteSave(){},applyCurrentPaperMetaToLiteratureNote:()=>({changedFields:[]}),
    renderLiteratureNoteDrawer(){context.renders++;},ensureLiteratureNoteResizeObserver(){},
    resizeLiteratureNoteTextareas(){},requestAnimationFrame:fn=>fn(),showStatus(){},
    async loadLiteratureNoteDocumentState(){context.loads++;context.literatureNoteDocumentState={draft:'stored'};}
  };
  vm.createContext(context);
  vm.runInContext(source('function switchWorkspaceView(', 'function scheduleActiveWorkspaceUiStateSave('),context);
  vm.runInContext(source('async function openLiteratureNoteDrawer(', 'function getReadingViewDefinition('),context);
  return {context,elements,views,buttons};
}

test('only five bottom modules remain, with notes inside the scrollable workspace',()=>{
  assert.doesNotMatch(html,/data-workspace-(?:target|view)="analysis"/);
  assert.match(html,/<details id="highlightControls" class="highlight-controls">/);
  assert.ok(html.indexOf('id="applyHighlight"')<html.indexOf('id="showArticleAbbreviations"'));
  assert.ok(html.indexOf('id="literatureNoteDrawer"')>html.indexOf('<main class="workspace-main">'));
  assert.match(html,/id="openLiteratureNote"[^>]*data-workspace-target="notes"/);
  assert.doesNotMatch(html.slice(0,html.indexOf('</header>')),/id="openLiteratureNote"/);
});

test('legacy analysis state and shortcuts enter excerpts with highlighter settings expanded',()=>{
  const {context,elements,views,buttons}=harness();
  context.switchWorkspaceView('analysis',{persist:false});
  assert.equal(context.activeWorkspaceView,'highlights');
  assert.equal(elements.get('highlightControls').open,true);
  assert.equal(views.find(x=>x.id==='highlights').hidden,false);
  assert.equal(buttons.find(x=>x.id==='highlights')['aria-selected'],'true');
  assert.equal(context.saves,0);
});

test('outline bulk controls live left of abbreviations and appear only in navigation',()=>{
  const tools = html.slice(html.indexOf('class="side-panel-global-tools"'), html.indexOf('id="showArticleAbbreviations"'));
  for (const id of ['navigationOutlineControls','expandAllOutlineLevels','collapseAllOutlineLevels']) {
    assert.ok(tools.includes(`id="${id}"`), `${id} belongs before abbreviations`);
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  const navigation = html.slice(html.indexOf('<section id="workspace-navigation"'), html.indexOf('<section id="workspace-highlights"'));
  assert.doesNotMatch(navigation, /workspace-outline-toolbar|expandAllOutlineLevels|collapseAllOutlineLevels/);
  const {context,elements} = harness();
  for (const view of ['navigation','highlights','figures','mechanism','chat','notes','navigation']) {
    context.switchWorkspaceView(view,{persist:false,loadNotes:false});
    assert.equal(elements.get('navigationOutlineControls').hidden, view !== 'navigation', view);
  }
});

test('mechanism subpage keeps Figure navigation selected and associated with its visible panel',()=>{
  const {context,views,buttons}=harness();
  context.switchWorkspaceView('mechanism',{persist:false});
  const figure=buttons.find(x=>x.id==='figures');
  assert.equal(context.activeWorkspaceView,'mechanism');
  assert.equal(views.find(x=>x.id==='mechanism').hidden,false);
  assert.equal(views.find(x=>x.id==='figures').hidden,true);
  assert.equal(figure['aria-selected'],'true');
  assert.equal(figure.tabIndex,0);
  assert.equal(figure['aria-controls'],'workspace-mechanism');
  assert.equal(buttons.filter(x=>x.tabIndex===0).length,1);
  context.switchWorkspaceView('figures',{persist:false});
  assert.equal(figure['aria-controls'],'workspace-figures');
  assert.match(html,/id="workspace-mechanism"[^>]*role="tabpanel"[^>]*aria-labelledby="workspace-tab-figures"/);
});

test('legacy note opener activates notes as a real selected module',async()=>{
  const {context,views,buttons}=harness();
  await context.openLiteratureNoteDrawer();
  assert.equal(context.activeWorkspaceView,'notes');
  assert.equal(views.find(x=>x.id==='notes').hidden,false);
  assert.equal(buttons.find(x=>x.id==='notes')['aria-selected'],'true');
  assert.equal(context.loads,1);
  assert.equal(context.renders,1);
});

test('switching away during asynchronous note loading cannot reopen it',async()=>{
  const {context,elements}=harness();
  let finish;
  context.loadLiteratureNoteDocumentState=()=>new Promise(resolve=>{finish=resolve;});
  const pending=context.openLiteratureNoteDrawer();
  context.switchWorkspaceView('chat');
  finish();
  await pending;
  assert.equal(context.activeWorkspaceView,'chat');
  assert.equal(elements.get('literatureNoteDrawer').hidden,true);
  assert.equal(context.renders,0);
});

test('switching paper during note loading cannot render the previous note',async()=>{
  const {context}=harness();
  let finish;
  context.loadLiteratureNoteDocumentState=()=>new Promise(resolve=>{finish=resolve;});
  const pending=context.openLiteratureNoteDrawer();
  context.activePanelTabContext.key='paper-b';
  finish();
  await pending;
  assert.equal(context.renders,0);
});

test('reopening notes preserves in-memory edits while autosave is pending',async()=>{
  const {context}=harness();
  const draft={draft:'unsaved edit'};
  context.literatureNoteDocumentState=draft;
  await context.openLiteratureNoteDrawer();
  context.switchWorkspaceView('highlights');
  await context.openLiteratureNoteDrawer();
  assert.equal(context.loads,0);
  assert.equal(context.literatureNoteDocumentState,draft);
});

test('legacy close returns to navigation rather than leaving a blank notes module',async()=>{
  const {context}=harness();
  await context.openLiteratureNoteDrawer();
  context.closeLiteratureNoteDrawer();
  assert.equal(context.activeWorkspaceView,'navigation');
});

test('restored notes state is accepted alongside legacy analysis state',()=>{
  const restore=source('function applyRestoredSidePanelUiState(', 'function buildArticleWorkspaceRestoreTarget(');
  assert.match(restore,/'notes'/);
  assert.match(restore,/'analysis'/);
});

test('workspace tabs expose associated panels and one keyboard tab stop',()=>{
  assert.match(html,/class="workspace-bottom-nav" role="tablist"/);
  for (const name of ['navigation','highlights','figures','chat','notes']) {
    assert.match(html,new RegExp(`data-workspace-target="${name}"[^>]*role="tab"[^>]*aria-controls="(?:workspace-${name}|literatureNoteDrawer)"`));
    assert.match(html,new RegExp(`data-workspace-view="${name}"[^>]*role="tabpanel"`));
  }
  const {context,buttons}=harness();
  context.switchWorkspaceView('highlights');
  assert.deepEqual(buttons.filter(b=>b.tabIndex===0).map(b=>b.id),['highlights']);
});

test('arrow and end keys activate tabs without changing the content keyboard handlers',()=>{
  const tabs=Array.from({length:5},(_,index)=>({index,focus(){this.focused=true;},click(){this.clicked=true;}}));
  const context={document:{querySelectorAll:()=>tabs}};
  vm.createContext(context);
  vm.runInContext(source('function handleWorkspaceTabKeydown(', 'function setupWorkspaceNavigation('),context);
  const event=(key,currentTarget)=>({key,currentTarget,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
  context.handleWorkspaceTabKeydown(event('ArrowLeft',tabs[0]));
  assert.equal(tabs[4].focused,true);
  assert.equal(tabs[4].clicked,true);
  context.handleWorkspaceTabKeydown(event('Home',tabs[3]));
  assert.equal(tabs[0].clicked,true);
  const other=event('F',tabs[1]);
  context.handleWorkspaceTabKeydown(other);
  assert.equal(other.prevented,undefined);
});

test('legacy A shortcut describes its new destination instead of a removed module',()=>{
  const shortcuts=fs.readFileSync(path.join(__dirname,'../core/keyboard-shortcuts.js'),'utf8');
  assert.match(shortcuts,/actionId: 'analysis', label: '打开摘句的高亮设置'/);
});
