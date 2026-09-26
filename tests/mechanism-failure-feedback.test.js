const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Evidence = require('../core/evidence-first-mechanism.js');
const script = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const context = {};
vm.runInNewContext(script.split('// DOM-independent popup UI helpers: start')[1]
  .split('// DOM-independent popup UI helpers: end')[0] + '\nglobalThis.helpers = PopupUiHelpers;', context);
const helpers = context.helpers;
function load(name, next, dependencies = {}) {
  const start = script.indexOf(name === 'runCrossFigureLogic' ? 'async function '+name+'(' : 'function '+name+'(');
  const end = script.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start);
  return Function(...Object.keys(dependencies), 'return ('+script.slice(start, end).trim()+');')(...Object.values(dependencies));
}
const format = load('formatLlmFailureMessage', 'function currentLiteratureNotePaperMetaProjection');
const statusLabel = load('mechanismGenerationStatusLabel', 'function renderMechanismGenerationStatus', { t: text => text });
const cases = [
  ['MECHANISM_OPERATION_DEADLINE_EXCEEDED', /运行时限|总时限/u],
  ['MECHANISM_PROVIDER_REQUEST_BUDGET_EXCEEDED', /调用次数上限/u],
  ['MECHANISM_RUN_STATE_READ_FAILED', /读取.*运行状态/u],
  ['MECHANISM_RUN_STATE_WRITE_FAILED', /保存.*运行状态/u],
  ['MECHANISM_CHECKPOINT_READ_FAILED', /读取.*检查点/u],
  ['MECHANISM_CHECKPOINT_WRITE_FAILED', /保存.*检查点/u],
  ['MECHANISM_WORKSPACE_SYNC_FAILED', /工作区.*同步/u]
];
for (const [code, expected] of cases) test('MECH-008 identifies '+code+' without guessing model configuration', () => {
  const message = format('机制链生成', { code, message: 'private provider response sk-test-secret' });
  assert.match(message, expected);
  assert.doesNotMatch(message, /检查模型设置|API 额度|sk-test-secret|已保存检查点/u);
});
test('existing provider authentication and quota directions stay distinct', () => {
  assert.match(format('机制链生成', {code:'AUTH_INVALID'}), /密钥/u);
  assert.match(format('机制链生成', {code:'QUOTA_EXHAUSTED'}), /账户额度/u);
  assert.match(format('文献笔记自动填写', {code:'INVALID_RESPONSE'}), /格式/u);
});
test('unknown mechanism failure stays neutral and never exposes raw provider details', () => {
  const message = format('机制链生成', {code:'NEW_FAILURE',message:'private provider response'});
  assert.match(message,/未完成/u);
  assert.doesNotMatch(message,/检查模型设置|private provider response/u);
  assert.match(format('文献笔记自动填写',{code:'NEW_FAILURE'}),/检查模型设置/u);
});

async function runFailure({ code, success, status = 'failed' }) {
  const versions = Evidence.EVIDENCE_FIRST_VERSIONS;
  const controller = helpers.createMechanismGenerationUiController({
    normalizeEvidenceFirstVersions: Evidence.normalizeEvidenceFirstVersions
  });
  const binding = { documentId:'sha256:failure-document', workspaceId:'workspace:'+'d'.repeat(64),
    workspaceGeneration:7, workspaceLifecycle:13, draftRevision:21,
    mechanismChainFingerprint:'mechanism-chain-v1-a1b2c3d4' };
  const notifications = []; let finalizes=0, seeds=0, sends=0;
  const run = load('runCrossFigureLogic', 'async function runReviewOutlineAnalysis', {
    activeWorkspaceView:'figures', requireUsableLlm:()=>true,
    queryPanelTargetTab:async()=>({id:41}), figureTaskGeneration:3, isCurrentFigureTask:()=>true,
    capturePanelContext:()=>({tabId:41}), isCurrentPanelContext:()=>true,
    refreshArticleWorkspace:async()=>({inventoryReady:true}),
    captureFigureWorkspaceEditContext:()=>({...binding}),
    createMechanismOperationId:()=> 'mechanism:failure-test-12345678', SciLLM:Evidence,
    createEvidenceFirstMechanismPopupRequest:helpers.createEvidenceFirstMechanismPopupRequest,
    replaceMechanismGenerationUiController:()=>controller, mechanismGenerationUiController:controller,
    renderMechanismGenerationStatus:()=>undefined,
    sendTabMessage:async(_tab,req)=>{sends++; return {success,status,code,operationId:req.operationId,
      operationEpoch:1,evidenceFirstVersions:versions};},
    mechanismGenerationOwnData:helpers.mechanismGenerationOwnData,
    isSeedableMechanismGenerationResult:helpers.isSeedableMechanismGenerationResult,
    mechanismGenerationStatusLabel:statusLabel, formatLlmFailureMessage:format,
    showStatus:(message,type)=>notifications.push({message,type}),
    switchWorkspaceView:()=>undefined,
    finalizeSuccessfulMechanismGeneration:async()=>{finalizes++;},
    seedMechanismChainFromCrossFigure:async()=>{seeds++;},
    isCurrentFigureWorkspaceEditContext:()=>true, mechanismSnapshotMatchesContext:()=>true,
    setMechanismChainSaveStatus:()=>undefined, persistCurrentArticleArchive:async()=>undefined,
    figureWorkspaceRenderCoordinator:{request:()=>undefined}, currentWorkspaceSnapshot:null
  });
  await run({returnView:'figures'});
  return {notifications,finalizes,seeds,sends,presentation:controller.presentation()};
}
for (const success of [false,true]) test('MECH-008 production run retains deadline cause for success='+success, async()=>{
  const result=await runFailure({success,code:'MECHANISM_OPERATION_DEADLINE_EXCEEDED'});
  assert.equal(result.presentation.status,'failed');
  assert.equal(result.presentation.active,false);
  assert.equal(result.finalizes,0); assert.equal(result.seeds,0); assert.equal(result.sends,1);
  assert.match(result.notifications.at(-1).message,/运行时限|总时限/u);
  assert.equal(result.notifications.at(-1).type,'error');
});
test('MECH-008 revision conflict retains the refresh action',async()=>{
  const result=await runFailure({success:true,status:'revision_conflict',code:'MECHANISM_REVISION_CONFLICT'});
  assert.match(result.notifications.at(-1).message,/刷新/u);
  assert.equal(result.finalizes,0);
});
test('MECH-008 cancellation stays a non-error terminal result',async()=>{
  const result=await runFailure({success:true,status:'cancelled',code:'CANCELLED'});
  assert.match(result.notifications.at(-1).message,/已取消/u);
  assert.equal(result.notifications.at(-1).type,'success');
  assert.equal(result.sends,1);assert.equal(result.finalizes,0);
});
test('MECH-008 needs-review still warns without declaring failure or finalizing graph',async()=>{
  const result=await runFailure({success:true,status:'needs_review',code:''});
  assert.match(result.notifications.at(-1).message,/人工核验/u);
  assert.equal(result.notifications.at(-1).type,'warning');
  assert.equal(result.finalizes,0);assert.equal(result.seeds,0);
});
