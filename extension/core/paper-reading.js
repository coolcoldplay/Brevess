/* Portable reading results. Source documents keep ownership of their text, anchors and edits. */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(globalThis, function factory(shared) {
  'use strict';
  const clock = value => typeof value === 'number' ? value : Date.parse(value) || 0;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  function paperReadingKey(source) {
    return shared.automaticCrossFormatRole(source) === 'main' ? shared.normalizeCrossFormatPaperDoi(source.doi) : '';
  }
  function paperHighlightSources(distribution, paragraphs, notes) {
    const normalize = text => text.normalize('NFKC').replace(/\s+/gu,' ').trim();
    const texts = new Map((Array.isArray(paragraphs) ? paragraphs : []).map(p => [p.paragraphId, p.text || '']));
    const rows = (distribution?.rows || []).flatMap(row => Object.values(row.cells || {}).flatMap(cell => cell.items || []));
    const readings = [];
    for (const item of [...rows, ...(distribution?.unresolved || [])]) {
      if (!['llm','regex'].includes(item.source) || !item.quote) continue;
      const original = texts.get(item.paragraphId) || '';
      const start = item.sourceStart, end = item.sourceEnd;
      const selected = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= original.length
        ? original.slice(start,end) : '';
      const clipped = !item.fullQuote && item.quote.length === 240 && end-start > 240;
      const expected = normalize(item.fullQuote || item.quote);
      const exact = Boolean(selected && (clipped ? normalize(selected).startsWith(expected) : normalize(selected) === expected));
      readings.push({annotationId: item.highlightId + '-' + item.categoryId, nativeAnnotationId:item.annotationId,
        truncated:clipped && !exact, quote: exact ? selected : item.fullQuote || item.quote,
        prefix: exact ? original.slice(Math.max(0,start-64),start) : item.prefix || '',
        suffix: exact ? original.slice(end,end+64) : item.suffix || '', color:item.color, note:item.note, categoryName:item.categoryName, categoryId:item.categoryId, engine:item.source});
    }
    for (const item of notes || []) {
      const quote = item.quote || texts.get(item.paragraphId);
      if (quote && item.note) readings.push({annotationId:'paragraph-'+item.paragraphId,quote,note:item.note});
    }
    return readings;
  }
  async function readPaperEditions(target, records, {workspaceStore: store, publicTurn, readAsset, readArchivedHighlights}) {
    const doi = paperReadingKey(target);
    if (!doi) return [];
    const peers = records.filter(r => paperReadingKey(r) === doi && r.sourceFormat !== target.sourceFormat &&
      ![...(target.crossFormatLinks || []), ...(r.crossFormatLinks || [])].some(link => link.scope?.kind === 'local' &&
        link.state === 'revoked' && [link.source?.documentId,link.target?.documentId].includes(target.documentId) &&
        [link.source?.documentId,link.target?.documentId].includes(r.documentId)));
    if (!peers.length) return [];
    return (await Promise.all([target,...peers].map(async source => {
      const identity = await shared.createArticleWorkspaceIdentity({canonicalUrl:source.canonicalUrl,doi});
      let workspaceId=source.paperWorkspaceId || identity.workspaceId;
      let workspace=await store.getWorkspace(workspaceId);
      // Older local PDF records stripped file URLs. Recover their original owner only
      // from the byte-bound saved structure, including when the HTML is reopened first.
      if (!workspace && !source.paperWorkspaceId && !source.canonicalUrl && source.sourceFormat === 'pdf') {
        const matches=[];
        for (const candidate of await store.listWorkspaces()) {
          if (candidate.deletionPending || !candidate.aliases?.some(a=>a.type==='doi' && a.value===doi)) continue;
          const structure=await store.getAsset(candidate.workspaceId,'article/structure.json');
          if (structure?.content?.documentId===source.documentId && structure.content.documentHash===source.documentHash) matches.push(candidate);
        }
        if (matches.length>1) return null;
        if (matches.length===1) {workspace=matches[0]; workspaceId=workspace.workspaceId;}
      }
      if (workspace?.deletionPending || source.canonicalUrl && workspace && workspace.canonicalUrl !== identity.canonicalUrl) return null;
      const workspaceGeneration = Number(workspace?.workspaceGeneration || 1);
      const edition = {documentId:source.documentId, documentHash:source.documentHash, format:source.sourceFormat,
        workspaceId, workspaceGeneration, turns:[], deletedTurns:[]};
      const own = source.documentId === target.documentId;
      // The original highlighter commits its result to the article archive, even
      // when the reader has never explicitly saved the article to a workspace.
      const archived = !own && readArchivedHighlights ? await readArchivedHighlights(source) : null;
      if (!workspace) {
        if (archived) edition.highlights=archived.highlights;
        return edition;
      }
      const [chat, figs, draft, note, highlights, article, margin, abbreviations, analysis] = await Promise.all([
        store.readChatRestoreSnapshot(workspaceId, {withDeletedTurns:true}),
        ...['figures/inventory.json','figures/workspace-draft.json','annotations/literature-note.json',
          'annotations/highlights.json','article/paragraphs.json','annotations/paragraph-notes.json','annotations/abbreviations.json','analysis/full-analysis.json'].map((path,i) =>
          own && i !== 0 ? null : readAsset(workspaceId,path))
      ]);
      if (!chat.workspace || chat.workspace.deletionPending || chat.workspace.workspaceGeneration !== workspace.workspaceGeneration) return null;
      const current = asset => asset && Number(asset.workspaceGeneration || 1) === workspaceGeneration ? asset.content : null;
      const binding = current(chat.source);
      if (binding && (binding.documentId !== source.documentId || binding.documentHash !== source.documentHash && (source.sourceFormat !== 'html' || !source.documentHashes?.includes(binding.documentHash)) ||
          shared.normalizeWorkspaceCanonicalUrl(binding.url) !== workspace.canonicalUrl)) return null;
      edition.turns = chat.turns.filter(turn => Number(turn.workspaceGeneration || 1) === workspaceGeneration).map(turn =>
        ({...publicTurn(turn), createdAt:clock(turn.createdAt), updatedAt:clock(turn.updatedAt)}));
      edition.deletedTurns = chat.deletedTurns || [];
      edition.figureUpdatedAt = clock(figs?.updatedAt);
      if (!own) {
        const catalog = current(figs);
        edition.figures = (catalog?.figures || []).map(f => ({figureId:f.figureId, figureLabel:f.figureLabel,
          isSupplemental:f.isSupplemental === true, figureSeries:f.figureSeries, panelHints:f.panelHints,
          standard:f.standard, deep:f.deep, panelAnalyses:f.panelAnalyses, panelFollowups:f.panelFollowups,
          panelFollowupHistories:f.panelFollowupHistories}));
        edition.draft = current(draft) || catalog?.draft;
        for (const f of Object.values(edition.draft?.figures || {})) {
          if (!edition.figures.some(saved=>saved.figureId===f.figureId) && reviewedTime(f)) {
            edition.figures.push({figureId:f.figureId,figureLabel:f.figureLabel,isSupplemental:f.isSupplemental});
          }
        }
        edition.abbreviations=current(abbreviations);
        edition.crossFigureResult=catalog?.crossFigureLogic?.result;
        const savedAnalysis=current(analysis);
        edition.summaries=(savedAnalysis?.paragraphSummaries || []).filter(s=>s.summary).map(s=>({paragraphId:s.paragraphId,summary:s.summary}));
        const articleText=new Map((current(article)?.paragraphs || []).map(p=>[p.paragraphId,p.text]));
        for (const s of edition.summaries) s.quote=articleText.get(s.paragraphId) || '';
        if (binding) edition.boundHash=binding.documentHash;
        edition.note = current(note);
        const used = new Set();
        for (const values of Object.values(edition.note?.valuesByTemplate || {})) {
          for (const text of Object.values(values)) for (const match of String(text).matchAll(/(?:p-[a-f0-9]{16}|pdf-paragraph:[a-f0-9]{16})/gu)) used.add(match[0]);
        }
        const citations = Object.create(null);
        for (const p of [...(current(article)?.paragraphs || []),...(current(article)?.captionRecords || [])]) {
          if (used.has(p.paragraphId) && p.text) citations[p.paragraphId]=p.text;
        }
        for (const fields of Object.values(edition.note?.fieldEvidenceByTemplate || {})) for (const entry of Object.values(fields)) {
          for (const locator of entry?.locators || []) if (used.has(locator.paragraphId) && locator.expectedNormalizedQuote) citations[locator.paragraphId]=locator.expectedNormalizedQuote;
        }
        edition.noteCitations=citations;
        const paragraphs = current(article)?.paragraphs || [];
        const annotated = archived && archived.updatedAt > clock(highlights?.updatedAt)
          ? archived.highlights : paperHighlightSources(current(highlights)?.highlightDistribution, paragraphs);
        edition.highlights = [...annotated,...paperHighlightSources(null,paragraphs,current(margin)?.notes)];
      }
      return edition;
    }))).filter(Boolean);
  }

  function mergePaperTurns(editions, localId) {
    const removed = new Set(editions.flatMap(e => e.deletedTurns || [])), chosen = new Map();
    for (const edition of editions) {
      for (const turn of edition.turns || []) {
        if (!turn.turnId || removed.has(turn.turnId)) continue;
        const prev = chosen.get(turn.turnId), remote = edition.documentId !== localId;
        const createdAt = Math.min(prev?.createdAt || Infinity, clock(turn.createdAt) || Infinity);
        if (!prev || clock(turn.updatedAt) > clock(prev.turn.updatedAt) || clock(turn.updatedAt) === clock(prev.turn.updatedAt) && !remote) {
          chosen.set(turn.turnId,{turn,createdAt,edition,remote});
        } else prev.createdAt = createdAt;
      }
    }
    return {removed,chosen};
  }

  function paperFigureKey(f) {
    const parsed = shared.parseFigureLabel?.(f?.figureLabel);
    if (!parsed) return '';
    return (parsed.figureSeries === 'extended-data' || f.figureSeries === 'extended-data' ? 'ed' :
      parsed.isSupplemental || f.isSupplemental ? 'supp' : 'main') + ':' + parsed.figureCode;
  }
  function reviewedTime(value) {
    if (Array.isArray(value)) return Math.max(0,...value.map(reviewedTime));
    if (!record(value)) return 0;
    if (value.humanReviewed) return clock(value.editedAt) || 1;
    return Math.max(0,...Object.values(value).map(reviewedTime));
  }
  function mergeFigureFields(local, other) {
    if (!other) return local;
    if (Array.isArray(other) || record(other) && Object.hasOwn(other,'humanReviewed')) {
      const a = reviewedTime(local), b = reviewedTime(other);
      if (b > a) return other;
      if (a) return local;
      if (Array.isArray(other)) return local?.length ? local : other;
      return local?.value ? local : other;
    }
    if (!record(other)) return local ?? other;
    const result = {...local};
    for (const key of Object.keys(other)) {
      if (['__proto__','constructor','prototype'].includes(key)) continue;
      result[key] = mergeFigureFields(local?.[key],other[key]);
    }
    return result;
  }
  function projectPaperFigures(catalog, editions, documentId) {
    if (!catalog || !editions?.length) return catalog;
    const figures = [...(catalog.figures || [])], draft = {...catalog.draft,figures:{...catalog.draft?.figures}};
    const unmatched = [], ownTime = editions.find(e=>e.documentId===documentId)?.figureUpdatedAt || 0;
    const local = new Map();
    for (const f of figures) {
      const key=paperFigureKey(f);
      if (key) local.set(key, local.has(key) ? null : f);
    }
    const peers = editions.filter(e=>e.documentId!==documentId).sort((a,b)=>b.figureUpdatedAt-a.figureUpdatedAt);
    const times = new Map();
    for (const edition of peers) {
      const rows = edition.figures || [], byKey = new Map();
      for (const f of rows) { const key=paperFigureKey(f); byKey.set(key,(byKey.get(key)||0)+1); }
      for (const f of rows) {
        const fields = edition.draft?.figures?.[f.figureId];
        if (!fields || !reviewedTime(fields)) {
          if (!f.standard && !f.deep && !Object.keys(f.panelAnalyses||{}).length && !Object.keys(f.panelFollowups||{}).length) continue;
        }
        const key=paperFigureKey(f), target = local.get(key);
        if (!target || byKey.get(key)!==1) { unmatched.push({figure:f,draft:{figures:{[f.figureId]:fields}},format:edition.format}); continue; }
        const index=figures.indexOf(target), merged={...target};
        for (const prop of ['standard','deep','panelAnalyses','panelFollowups','panelFollowupHistories']) {
          const other = f[prop];
          if (!other || !Object.keys(other).length) continue;
          const timeKey=key+'/'+prop, time=times.get(timeKey)??ownTime;
          if (prop.startsWith('panel')) {
            merged[prop] = edition.figureUpdatedAt > time ? {...target[prop],...other} : {...other,...target[prop]};
          } else if (!target[prop] || edition.figureUpdatedAt > time) {
            merged[prop]={...other,figureId:target.figureId,figureLabel:target.figureLabel};
          }
          times.set(timeKey,Math.max(time,edition.figureUpdatedAt));
        }
        if (fields) draft.figures[target.figureId] = {...mergeFigureFields(draft.figures[target.figureId],fields),
          figureId:target.figureId,figureLabel:target.figureLabel};
        figures[index]=merged; local.set(key,merged);
      }
    }
    if (!draft.mechanismChain?.nodes?.length) {
      const ids=new Set(figures.map(f=>f.figureId));
      const chain=peers.map(e=>e.draft?.mechanismChain).find(c=>c?.nodes?.length && c.nodes.every(n=>!n.figureId||ids.has(n.figureId)));
      if (chain) draft.mechanismChain=chain;
    }
    const crossResult=catalog.crossFigureLogic?.result || peers.find(e=>e.crossFigureResult)?.crossFigureResult;
    return {...catalog,figures,draft,paperUnmatched:unmatched,
      ...(crossResult ? {crossFigureLogic:{...catalog.crossFigureLogic,result:crossResult}} : {})};
  }
  return {paperReadingKey,paperHighlightSources,readPaperEditions,mergePaperTurns,projectPaperFigures};
});
