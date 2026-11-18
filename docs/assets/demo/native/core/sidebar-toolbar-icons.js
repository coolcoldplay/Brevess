/* One 24-unit outline system for the two compact sidebar toolbars. */
(function () {
  'use strict';
  const paths = {
    sidePanelNotificationSummary: 'M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4',
    openSidePanelSettings: 'M19.11 9.05L21.82 10.09L21.82 13.91L19.11 14.95L20.29 17.59L17.59 20.29L14.95 19.11L13.91 21.82L10.09 21.82L9.05 19.11L6.41 20.29L3.71 17.59L4.89 14.95L2.18 13.91L2.18 10.09L4.89 9.05L3.71 6.41L6.41 3.71L9.05 4.89L10.09 2.18L13.91 2.18L14.95 4.89L17.59 3.71L20.29 6.41L19.11 9.05Z M15.25 12a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0',
    copyLiteratureNote: 'M9 9h12v12H9zM15 9V3H3v12h6',
    exportLiteratureNoteMarkdown: 'M3 18V6l5 7 5-7v12M19 6v12m-3-3 3 3 3-3',
    toggleLiteratureNoteMarkdown: 'M8 6l-5 6 5 6M16 6l5 6-5 6M14 3l-4 18',
    focusToggle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 2',
    figurePanelHeaderFieldsButton: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
    collapseAllOutlineLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    collapseAllFigureLevels: 'm7 4 5 5 5-5M7 20l5-5 5 5',
    openSupplementalFigureImport: 'M20 14v6H4V4h10M14 4l6 6M9 9h.01M4 17l5-5 5 5M17 3v6M14 6h6',
    translateNavigationTitles: 'M3 5h12M9 3v2M12 5c-1 5-4 8-8 10M5 8c1 3 3 5 6 7M13 21l4-10 4 10M14.5 17h5',
    showArticleAbbreviations: 'm4 18 5-12 5 12M6 14h6M17 8h4M17 12h3M17 16h4',
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
  apply();
  for (const id of ['sidePanelHeader','sidePanelDocumentStatus']) {
    const root = document.getElementById(id); if (root) new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  }
})();
