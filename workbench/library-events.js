/* Event bridge for the global library and the hierarchical material pane.
 * Kept outside app.js so the existing canvas/search listeners stay untouched.
 */
(() => {
  'use strict';
  const runtime = () => window.__workbenchRuntime;
  const run = fn => Promise.resolve().then(fn).catch(error => runtime()?.toast?.(error.message || error.code || '操作未完成'));
  document.addEventListener('click', event => {
    const rt = runtime();
    if (!rt) return;
    const entry = event.target.closest('[data-library-entry]');
    if (entry) { rt.ui.librarySelected = entry.dataset.libraryEntry; rt.renderLibraryView(); return; }
    const scope = event.target.closest('[data-library-scope]');
    if (scope) { rt.ui.libraryScope = scope.dataset.libraryScope; rt.ui.libraryPage = 1; run(rt.loadGlobalLibrary); return; }
    const tab = event.target.closest('[data-library-detail-tab]');
    if (tab) { rt.ui.libraryDetailTab = tab.dataset.libraryDetailTab; rt.renderLibraryDetail(); return; }
    const use = event.target.closest('[data-library-use-index]');
    if (use) { run(() => rt.openLibraryUse(Number(use.dataset.libraryUseIndex))); return; }
    const paper = event.target.closest('[data-material-paper-index]');
    if (paper) { run(() => rt.selectMaterialPaper(Number(paper.dataset.materialPaperIndex))); return; }
    const figure = event.target.closest('[data-material-figure]');
    if (figure) { rt.ui.materialFigureId = figure.dataset.materialFigure; rt.renderResources(); return; }
    const level = event.target.closest('[data-material-level]');
    if (level) {
      if (level.dataset.materialLevel === 'papers') { rt.ui.materialPaperEntry = null; rt.ui.materialFigureId = null; rt.ui.materialPlanOpen = false; }
      else if (level.dataset.materialLevel === 'paper') rt.ui.materialFigureId = null;
      else if (level.dataset.materialLevel === 'plan-root') rt.ui.materialPlanOpen = false;
      rt.renderResources(); return;
    }
    const planFigure = event.target.closest('[data-material-plan-figure]');
    if (planFigure) { rt.ui.materialPlanOpen = true; rt.renderResources(); return; }
    const editLink = event.target.closest('[data-edit-material-link]');
    if (editLink) run(() => rt.editMaterialLink?.(editLink.dataset.editMaterialLink));
  });
  document.addEventListener('change', event => {
    const rt = runtime();
    if (!rt) return;
    if (event.target.dataset.edgeKind) {
      run(() => rt.editEdgeKind?.(event.target.dataset.edgeKind, event.target.value));
    } else if (event.target.id === 'material-source') {
      rt.ui.materialSource = event.target.value;
      rt.ui.materialPaperEntry = null;
      rt.ui.materialFigureId = null;
      rt.ui.materialPlanOpen = false;
      rt.renderResources();
    } else if (event.target.id === 'library-view-scope') {
      rt.ui.libraryScope = event.target.value;
      rt.ui.libraryPage = 1;
      run(rt.loadGlobalLibrary);
    } else if (event.target.id === 'library-view-sort') {
      rt.ui.librarySort = event.target.value;
      rt.renderLibraryView();
    }
  });
})();
