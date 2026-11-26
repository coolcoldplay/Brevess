/* One 24-unit outline system for the two compact sidebar toolbars. */
(function () {
  'use strict';
  const batch = 'm10 3 2.2 5.8L18 11l-5.8 2.2L10 19l-2.2-5.8L2 11l5.8-2.2zM19 2v5m-2.5-2.5h5M19 16v5m-2.5-2.5h5';
  const translate = 'M3 5h12M9 3v2M12 5c-1 5-4 8-8 10M5 8c1 3 3 5 6 7M13 21l4-10 4 10M14.5 17h5';
  const paths = {
    batchHighlights: batch, batchOutline: batch, batchFigures: batch, batchNotes: batch,
    openHighlightSettings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    applyHighlight: 'm5 15 10-11 5 5L9 20H4zM3 22h13',
    pdfPanelWorkspaceOpen: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M7 7h10v10H7z',
    figureBoardOpen: 'M3 3h7v6H3zM14 15h7v6h-7zM3 15h7v6H3zM6.5 9v6M7 12h10v3',
    figureBoardReview: 'M4 3h12l4 4v14H4zM7 13l3 3 6-7',
    chatDisplayMode: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    sidePanelSavedScripts: 'M3 5h7l2 2h9v13H3zM10 11l-2 2 2 2M15 11l2 2-2 2',
    toggleBilingualTranslation: translate,
    importArticleAbbreviationsToGlobal: 'M3 4h13l5 5v12H3zM7 4v6h10V4M7 21v-7h10v7',
    configureAbbreviationLookup: 'M9 15l6-6M8 10l-3 3a4 4 0 0 0 6 6l3-3M10 8l3-3a4 4 0 0 1 6 6l-3 3',
    addArticleAbbreviationEntry: 'M12 4v16M4 12h16',
    removeArticleAbbreviationEntry: 'M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    translateArticleAbbreviations: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    sidePanelNotificationSummary: 'M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4',
    openSidePanelSettings: 'M19.11 9.05L21.82 10.09L21.82 13.91L19.11 14.95L20.29 17.59L17.59 20.29L14.95 19.11L13.91 21.82L10.09 21.82L9.05 19.11L6.41 20.29L3.71 17.59L4.89 14.95L2.18 13.91L2.18 10.09L4.89 9.05L3.71 6.41L6.41 3.71L9.05 4.89L10.09 2.18L13.91 2.18L14.95 4.89L17.59 3.71L20.29 6.41L19.11 9.05Z M15.25 12a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0',
    copyLiteratureNote: 'M9 9h12v12H9zM15 9V3H3v12h6',
    exportLiteratureNoteMarkdown: 'M3 18V6l5 7 5-7v12M19 6v12m-3-3 3 3 3-3',
    toggleLiteratureNoteMarkdown: 'M8 6l-5 6 5 6M16 6l5 6-5 6M14 3l-4 18',
    figurePanelHeaderFieldsButton: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
    collapseAllOutlineLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    collapseAllFigureLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    openSupplementalFigureImport: 'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M4 17l5-5 3.5 3.5 2-2 5.5 5.5M7.5 8.5h.01M18.5 2v7M15 5.5h7',
    translateNavigationTitles: translate,
    showArticleAbbreviations: 'm2 20 6.5-16L15 20M4.5 14h8.1M17 6h5M17 12h4M17 18h5',
    saveCurrentArticleWorkspace: 'M4 3h13l4 4v14H3V3h1M7 3v6h10V3M7 21v-8h10v8',
    refreshArticleNavigation: 'M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4',
    refreshFigureInventory: 'M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4',
    clearArticleChat: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7',
    sidePanelMoreToolsSummary: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2M19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
    autofillLiteratureNote: 'M5 3h10l4 4v5M5 3v18h8M9 8h4M9 12h3M16 16l2-2 3 3-2 2-4 1z'
  };
  function apply() {
    for (const [id, d] of Object.entries(paths)) {
      const button = document.getElementById(id); if (!button || button.querySelector('[data-toolbar-icon]')) continue;
      const old = button.querySelector(':scope > svg,:scope > i,:scope > .side-panel-tool-letter,:scope > .side-panel-more-glyph,:scope > .figure-panel-header-fields-triangle');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [k, v] of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.75','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true','data-toolbar-icon':''})) svg.setAttribute(k,v);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d',d); svg.append(path);
      if (old) old.replaceWith(svg); else button.prepend(svg);
    }
  }
  globalThis.BrevessAnalysisIcon = (button, action) => {
    const path = button.querySelector('[data-toolbar-icon] path');
    if (!path) return;
    const d = action === 'pause' ? 'M8 5v14M16 5v14' : action === 'resume' ? 'M7 4l13 8-13 8z' : batch;
    if (path.getAttribute('d') !== d) path.setAttribute('d', d);
  };
  apply();
  for (const id of ['sidePanelHeader','sidePanelDocumentStatus']) {
    const root = document.getElementById(id); if (root) new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  }
})();
