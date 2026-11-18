import crypto from 'node:crypto';
import vm from 'node:vm';

// Export complete production functions, without rewriting their markup or events.
// The website supplies only document/storage/AI adapters through this factory.
export function selectionExport(content) {
  const pieces=[];
  const take=(name,method=false)=>{
    const start=content.search(new RegExp(method?`^    ${name}\\(`:`^(?:async )?function ${name}\\(`,'m'));
    if(start<0)throw Error(`Missing production component: ${name}`);
    const tail=content.slice(start),end=tail.search(method?/\r?\n    }\r?\n/:/\r?\n}\r?\n/);
    if(end<0)throw Error(`Incomplete production component: ${name}`);
    const value=tail.slice(0,end)+(method?'\r\n    }':'\r\n}');
    pieces.push({name,method,sha256:crypto.createHash('sha256').update(value).digest('hex'),bytes:Buffer.byteLength(value)});
    return `/* production:${name}:start */\n${value}\n/* production:${name}:end */`;
  };
  const names=['showManualSelectionToolbar','closeManualSelectionToolbar','clampManualFloating','bindManualFloatingDrag','positionManualFloating','makeManualButton','scheduleManualAfterPaint','manualAnnotationDraftKey','manualAnnotationSourceIdentity','selectionSurfaceExistingAnnotationCurrent','manualAnnotationById','manualCategoryById','manualCategoriesForAnalysisMode','pastelManualColor','automaticAnnotationId','appendManualAbbreviationEditor','appendManualNoteSharingControls'];
  const methods=['buildRegexes','findMatches','mergeOverlappingMatches','createHighlightSpan','showTooltip','createTooltipContent','hideTooltip'];
  const source=`/* Generated from production content.js by build-website-demo.mjs. */
window.BVCreateSelectionUI = function(env) {
 const {SciLLM,chrome,currentManualDocument,currentManualBlocks,currentManualCategories,currentManualAnalysisModes,
  saveSelectionSurfaceAnnotations,sendManualMessage,appendManualFixedPhrase,addCurrentArticleAbbreviation,
  showManualStatus,restoreManualAnnotations,updateCurrentManualRecord,ensureAutomaticHighlightAnnotation,
  showHighlightContextPopover}=env;
 let currentManualSelection=null,currentManualSelectionUi=null;
 let currentManualAnalysisModeId=currentManualAnalysisModes[0].id;
 const currentManualSelectionActions=env.actions,currentManualSelectionProfileId='prepared-example';
 const currentManualSelectionWebSearchEnabled=false,currentManualSelectionWebSearchSupported=false;
 const currentManualRebindId='',currentManualUnresolved=[],manualAnnotationDrafts=new Map();
 const manualSelectionDismissalRevision=0,articleWorkspaceLifecycleGeneration=1;
 const contentDocumentIdentity='public-alphafold-demo',currentArticleStructure={revision:1};
 const llmPresentationState={language:'zh-CN'},manualUiLifecycle={retain(){}};
 const contentNavigationIdentity=()=>location.href.split('#')[0];
 const effectiveArticlePageUrl=()=>env.source;
 const manualReadableText=element=>element.textContent;
 const isCurrentManualMutationCandidate=descriptor=>descriptor.validation?.valid===true;
 const scheduleCurrentArticleArchiveSave=()=>{},releaseSelectionAfterManualAction=()=>closeManualSelectionToolbar();
 ${names.map(name=>take(name)).join('\n\n')}
 class NativeHighlighter { constructor(){this.matchCounts={};} ${methods.map(name=>take(name,true)).join('\n\n')} }
 return {open:showManualSelectionToolbar,close:closeManualSelectionToolbar,pastel:pastelManualColor,
  highlighter:new NativeHighlighter(),setMode(id){currentManualAnalysisModeId=id;},
  reset(){closeManualSelectionToolbar();manualAnnotationDrafts.clear();}};
};\n`;
  new vm.Script(source);
  return {source,pieces};
}

export function translationExport(content) {
  const name='paintTranslation',start=content.indexOf('        function paintTranslation(');
  const tail=content.slice(start),end=tail.indexOf('\n        }');
  if(start<0||end<0)throw Error('Missing production translation renderer');
  const value=tail.slice(0,end)+'\n        }';
  const pieces=[{name,sha256:crypto.createHash('sha256').update(value).digest('hex'),bytes:Buffer.byteLength(value)}];
  const source=`/* Exact production bilingual renderer; public prepared translations only. */
window.BVCreateTranslationUI = function() {
 const displaySources=new WeakMap();
 const destroyed=false,epoch=0,translationsHidden=false;
 const confirmedEntry=()=>null,clearPending=()=>{},clearFailure=()=>{},persistRecord=()=>{};
 const checkNavigation=()=>true,sourceMatches=record=>record.element.textContent===record.text;
 /* production:${name}:start */
${value}
/* production:${name}:end */
 return {paint:paintTranslation};
};\n`;
  new vm.Script(source);
  return {source,pieces};
}

export function figureViewerExport(content) {
 const names=['showFigureImageViewer','closeFigureImageViewer','getFigureImageViewerState','adjacentFigureViewerId','navigateFigureImageViewer','bindFigureViewerPointerControls','bindFigureViewerMagnifier'],pieces=[];
 const functions=names.map(name=>{
  const start=content.search(new RegExp(`^(?:async )?function ${name}\\(`,'m')),tail=content.slice(start),end=tail.search(/\r?\n}\r?\n/);
  if(start<0||end<0)throw Error('Missing production figure viewer: '+name);
  const value=tail.slice(0,end)+'\r\n}';pieces.push({name,sha256:crypto.createHash('sha256').update(value).digest('hex'),bytes:Buffer.byteLength(value)});
  return `/* production:${name}:start */\n${value}\n/* production:${name}:end */`;
 });
 const source=`/* Exact production figure viewer with an in-memory website backend. */
window.BVCreateFigureViewer=function(env){
 const {document,window,SciLLM,getFigureViewerInventory,loadSharedFigureOriginalResource,promoteSavedFigureOriginalDisplay,bindAnnotations,publishFigureImageViewerState,bodyFigureAnnotationLayers}=env;
 const FIGURE_IMAGE_VIEWER_ID='sci-figure-image-viewer';
 let figureImageViewerGeneration=0,figureImageViewerObjectUrl='',figureImageViewerPointerCleanup=null,figureImageViewerMagnifierCleanup=null,figureImageViewerAnnotationCleanup=null,figureImageViewerViewportCleanup=null,figureImageViewerKeyHandler=null;
 const findFigureAnalysisTarget=id=>getFigureViewerInventory().find(f=>f.figureId===id);
 const figureViewerDisplayTitle=figure=>figure.figureLabel+' · '+figure.title;
 const adoptFigureViewerAnalysisSource=async()=>[],figureImageDiagnosticCode=error=>error.message;
 const bindFigureViewerAnnotations=async(...args)=>{const editor=await bindAnnotations(...args);figureImageViewerAnnotationCleanup=()=>editor?.destroy();};
 ${functions.join('\n\n')}
 return {open:showFigureImageViewer,close:closeFigureImageViewer,state:getFigureImageViewerState};
};\n`;
 new vm.Script(source);return {source,pieces};
}
