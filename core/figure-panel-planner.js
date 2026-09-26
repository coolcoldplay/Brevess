(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_PANEL_PROMPT_VERSION = '5-caption-footer-boundaries';
  const FIGURE_PANEL_IMAGE_EDGES = Object.freeze([1200, 960, 768]);
  const CAPACITY_ERROR_CODES = new Set([
    'TOKEN_LIMIT_REJECTED', 'CONTEXT_BUDGET_EXCEEDED', 'OUTPUT_TRUNCATED'
  ]);

  function cleanText(value, maximum = 8000) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function cleanSourceText(value, maximum = 8000) {
    return String(value || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/gu, ' ').trim().slice(0, maximum);
  }

  function panelRef(value) {
    const normalized = cleanText(value, 20).toUpperCase();
    return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(normalized) ? normalized : '';
  }

  function classifyFigurePanelQuestion(input = {}) {
    const topics = new Set(Array.isArray(input.topics) ? input.topics : []);
    const question = cleanText(input.customQuestion || input.question, 1600).toLowerCase();
    if (topics.has('axes_reading') || /(?:axis|axes|curve|trend|image|colour|color|signal|band|morpholog|横轴|纵轴|坐标|曲线|趋势|颜色|亮度|条带|形态|图像)/i.test(question)) {
      return 'visual';
    }
    if (topics.has('grouping') || /(?:group|control|treat|compar|statistic|p[ -]?value|分组|对照|处理组|比较|统计|显著)/i.test(question)) {
      return 'grouping_stats';
    }
    if (topics.has('technique_principle') || topics.has('sample_information') ||
        /(?:method|assay|protocol|sample|cohort|technique|方法|技术|原理|样本|队列)/i.test(question)) {
      return 'methods';
    }
    if (/(?:argument|evidence chain|role|contribute|mechanism|论证|证据链|作用|贡献|机制)/i.test(question)) {
      return 'argument_role';
    }
    return 'general';
  }

  function figurePanelFollowupOutputUnits(input = {}) {
    const topics = Array.isArray(input.topics) ? input.topics : [];
    const question = cleanText(input.customQuestion || input.question, 1600);
    let units = Math.max(1, topics.length, Math.ceil(question.length / 400));
    if (/(?:一步一步|逐步|分步骤|详细|详述|深入|完整|全面|系统(?:地|性)?|证据链|论证链|推理链|step[ -]?by[ -]?step|in detail|comprehensive|evidence chain|argument chain)/iu.test(question)) {
      units = Math.max(units, 8);
    } else if (/(?:如何|为什么|为何|机制|原理|比较|区别|联系|how|why|mechanism|compare|difference|relationship)/iu.test(question)) {
      units = Math.max(units, 4);
    }
    return Math.min(24, units);
  }

  function markerPanels(value) {
    const normalized = cleanText(value, 120).toUpperCase()
      .replace(/\b(?:AND|OR|TO)\b/g, ',')
      .replace(/[&;]/g, ',');
    const panels = [];
    const append = panel => {
      if (/^[A-Z]$/.test(panel) && !panels.includes(panel)) panels.push(panel);
    };
    normalized.split(/\s*,\s*/).filter(Boolean).forEach(part => {
      const range = part.match(/^([A-Z])\s*[-\u2010-\u2015\u2212]\s*([A-Z])$/);
      if (!range) {
        append(part);
        return;
      }
      const start = range[1].charCodeAt(0);
      const end = range[2].charCodeAt(0);
      if (end < start || end - start > 25) return;
      for (let code = start; code <= end; code += 1) {
        append(String.fromCharCode(code));
      }
    });
    return panels;
  }

  function longestSequentialInlineRun(markers) {
    let best = [];
    let current = [];
    let previousEnd = -1;
    for (const marker of markers) {
      const start = marker.panels[0]?.charCodeAt(0) ?? -1;
      const end = marker.panels.at(-1)?.charCodeAt(0) ?? start;
      const continues = current.length && start >= previousEnd && start <= previousEnd + 2;
      if (!continues) current = [];
      current.push(marker);
      previousEnd = end;
      const distinct = new Set(current.flatMap(item => item.panels));
      const bestDistinct = new Set(best.flatMap(item => item.panels));
      if (distinct.size > bestDistinct.size) best = current.slice();
    }
    return new Set(best.flatMap(item => item.panels)).size >= 2 ? best : [];
  }

  function extractFigurePanelCaption(caption, requestedPanel) {
    const text = cleanSourceText(caption, 12000);
    const panel = panelRef(requestedPanel);
    const letter = '[A-Z\\uFF21-\\uFF3A]';
    const group = `${letter}(?:\\s*[-\\u2010-\\u2015\\u2212]\\s*${letter})?` +
      '(?:(?:\\s*(?:,|&|;|，|；)\\s*|\\s+(?:and|or|to)\\s+)' +
      `${letter}(?:\\s*[-\\u2010-\\u2015\\u2212]\\s*${letter})?)*`;
    const markers = [];
    const parenthesized = new RegExp(`[\\(（]\\s*(${group})\\s*[\\)）]\\s*`, 'gi');
    for (const match of text.matchAll(parenthesized)) {
      const after = text.slice((match.index || 0) + match[0].length);
      const before = text.slice(0, match.index).trimEnd();
      const panels = markerPanels(match[1]);
      const previous = markers.at(-1);
      const nextSequentialSection = previous &&
        panels[0]?.charCodeAt(0) === previous.panels.at(-1)?.charCodeAt(0) + 1 &&
        !/\b(?:in|see|from|for|of|and|or|to|with|than|test|ANOVA|SEM|SD)\s*$/iu.test(before);
      const declarationBefore = before.slice(previous?.end || 0);
      const referenceBeforeTest = /\b(?:statistics|statistical\s+(?:analysis|analyses|tests?))\s*[:：]/iu.test(declarationBefore) &&
        /^(?:unpaired|paired|one[- ]way|two[- ]way|three[- ]way|Student['’]?s?|Welch['’]?s?|ANOVA|t[- ]test)\b/iu.test(after);
      // A section label introduces prose. References such as "test (A),"
      // and "(B)–(D) show mean ± SD" must stay with their original clause.
      if (!after || referenceBeforeTest || /^[,.;:!?，。；：！？&\-\u2010-\u2015\u2212]/u.test(after) ||
          /^(?:and|or|to)\b/iu.test(after) ||
          (markers.length && !/[.!?;。！？；:：]$/u.test(before) && !nextSequentialSection)) continue;
      markers.push({
        index: match.index,
        end: (match.index || 0) + match[0].length,
        panels
      });
    }
    const inlineCandidates = [];
    const inline = new RegExp(`(^|[.!?;。！？；]\\s+)(${group})(\\s*[,;:，；：]\\s*)`, 'gi');
    for (const match of text.matchAll(inline)) {
      const prefixLength = match[1]?.length || 0;
      inlineCandidates.push({
        index: (match.index || 0) + prefixLength,
        end: (match.index || 0) + match[0].length,
        panels: markerPanels(match[2])
      });
    }
    markers.push(...longestSequentialInlineRun(inlineCandidates));
    markers.sort((left, right) => left.index - right.index || right.end - left.end);
    if (!markers.length) {
      return { panel, sharedLegend: '', targetText: text.slice(0, 6000), combined: text.slice(0, 6000) };
    }
    // Keep a shared trailing declaration intact, including the Panel references
    // after each method or scale bar. Assigning the text *after* a reference
    // reverses its meaning. Do not infer or rewrite method-to-Panel mappings.
    const lastMarker = markers.at(-1);
    const tail = text.slice(lastMarker.end);
    const footerStartPattern = /(^|[.!?;。！？；]\s+)(?=(?:scale\s+bars?\b|statistics\s*[:：]|statistical\s+(?:analysis|analyses|tests?)\s*[:：]|(?:all\s+)?error\s+bars?\b|(?:unpaired|paired|one[- ]way|two[- ]way|three[- ]way|Student['’]?s?|Welch['’]?s?|ANOVA|t[- ]test)\b))/giu;
    let footerStart = text.length;
    for (const match of tail.matchAll(footerStartPattern)) {
      const index = lastMarker.end + match.index + match[1].length;
      const declaration = text.slice(index);
      // An unnamed test in a local narrative is not automatically a shared
      // method. Unheaded statistics require explicit Panel references.
      if (!/^(?:scale\s+bars?|statistics|statistical|(?:all\s+)?error\s+bars?)\b/iu.test(declaration) &&
          !new RegExp(`[\\(（]\\s*(${group})\\s*[\\)）]`, 'iu').test(declaration)) continue;
      footerStart = index;
      break;
    }
    const sharedLegend = [text.slice(0, markers[0].index).trim(), text.slice(footerStart).trim()]
      .filter(Boolean).join(' ');
    const ranges = markers.map((marker, index) => ({
      ...marker,
      text: text.slice(marker.index, Math.min(markers[index + 1]?.index ?? text.length, footerStart)).trim()
    }));
    const targets = ranges.filter(range => range.panels.includes(panel));
    const targetText = targets.map(range => range.text).join(' ').slice(0, 4800);
    const combined = [sharedLegend, targetText].filter(Boolean).join(' ');
    return { panel, sharedLegend, targetText, combined };
  }

  function queryTerms(value) {
    const normalized = cleanText(value, 4000).toLowerCase();
    const latin = normalized.match(/[a-z][a-z0-9+._-]{2,}/g) || [];
    const cjk = [];
    for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) || []) {
      for (let index = 0; index < run.length - 1; index += 1) cjk.push(run.slice(index, index + 2));
    }
    return [...new Set([...latin, ...cjk])].slice(0, 80);
  }

  function sectionWeight(sectionTitle, topic) {
    const section = cleanText(sectionTitle, 240).toLowerCase();
    const methods = /method|material|protocol|方法|材料|实验设计/.test(section);
    const results = /result|finding|结果|发现/.test(section);
    const discussion = /discussion|conclusion|讨论|结论/.test(section);
    if (topic === 'methods') return methods ? 7 : results ? 2 : discussion ? 0.5 : 0;
    if (topic === 'argument_role') return discussion ? 6 : results ? 5 : methods ? 1 : 0;
    if (topic === 'visual' || topic === 'grouping_stats') return results ? 7 : methods ? 2 : discussion ? 1 : 0;
    return results ? 5 : methods || discussion ? 3 : 0;
  }

  function selectFigurePanelParagraphs(paragraphs, options = {}) {
    const panel = panelRef(options.panelId);
    const figureLabel = cleanText(options.figureLabel, 80);
    const topic = options.topic || 'general';
    const terms = queryTerms(`${options.question || ''} ${figureLabel} ${panel}`);
    const scored = (Array.isArray(paragraphs) ? paragraphs : []).map((item, order) => {
      const text = cleanSourceText(item?.text, 1600);
      const sectionTitle = cleanText(item?.sectionTitle, 240);
      const scoringText = cleanText(item?.text, 1600);
      const haystack = `${sectionTitle} ${scoringText}`.toLowerCase();
      let score = sectionWeight(sectionTitle, topic);
      if (figureLabel && haystack.includes(figureLabel.toLowerCase())) score += 6;
      if (panel && new RegExp(`(?:fig(?:ure)?\\.?\\s*\\d+|panel)\\s*${panel}\\b`, 'i')
        .test(scoringText)) score += 8;
      for (const term of terms) if (haystack.includes(term)) score += 1;
      return {
        paragraphId: cleanText(item?.paragraphId, 120) || `panel-context-${order + 1}`,
        sectionTitle,
        text,
        ...(Array.isArray(item?.evidence) ? { evidence: item.evidence } : {}),
        score,
        order
      };
    }).filter(item => item.text && item.score > 0)
      .sort((left, right) => right.score - left.score || left.order - right.order);
    const selected = scored.slice(0, 4);
    if (selected.length < 2) {
      const selectedIds = new Set(selected.map(item => item.paragraphId));
      (Array.isArray(paragraphs) ? paragraphs : []).forEach((item, order) => {
        if (selected.length >= 2) return;
        const paragraphId = cleanText(item?.paragraphId, 120) || `panel-context-${order + 1}`;
        const text = cleanSourceText(item?.text, 1600);
        if (!text || selectedIds.has(paragraphId)) return;
        selectedIds.add(paragraphId);
        selected.push({ paragraphId, sectionTitle: cleanText(item?.sectionTitle, 240), text,
          ...(Array.isArray(item?.evidence) ? { evidence: item.evidence } : {}),
          score: 0, order });
      });
    }
    return selected.slice(0, 4).map(({ score, order, ...item }) => item);
  }

  function textTokens(value) {
    const text = String(value || '');
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    return Math.ceil(cjk / 1.5 + (text.length - cjk) / 4);
  }

  function imageTokens(width, height) {
    const safeWidth = Math.max(0, Number(width) || 0);
    const safeHeight = Math.max(0, Number(height) || 0);
    if (!safeWidth || !safeHeight) return 0;
    // A continuous pixel term keeps every resized retry measurably smaller,
    // while remaining conservative for the tiled vision encoders used by
    // current Provider APIs.
    return 85 + Math.ceil((safeWidth * safeHeight) / 750);
  }

  function estimateFigurePanelInputTokens(options = {}) {
    return Math.max(0, Number(options.fixedTokens) || 0) +
      textTokens(options.text) + imageTokens(options.width, options.height);
  }

  function normalizeImageVariant(value) {
    const dataUrl = String(value?.dataUrl || '');
    const width = Math.max(0, Math.round(Number(value?.width) || 0));
    const height = Math.max(0, Math.round(Number(value?.height) || 0));
    if (!/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(dataUrl) || !width || !height) return null;
    const maxEdge = Math.max(width, height);
    return {
      mediaType: cleanText(value?.mediaType, 80) || 'image/jpeg', dataUrl, width, height,
      maxEdge: Math.max(0, Math.round(Number(value?.maxEdge) || maxEdge)),
      inputMode: value?.inputMode === 'panel_crop' ? 'panel_crop' : 'figure_image',
      pixelsSupplied: true,
      ...(value?.assetProof && typeof value.assetProof === 'object'
        ? { assetProof: value.assetProof } : {}),
      ...(value?.pdfEvidenceBinding && typeof value.pdfEvidenceBinding === 'object'
        ? { pdfEvidenceBinding: value.pdfEvidenceBinding } : {})
    };
  }

  function historyText(history) {
    return history.map(item => `${item.role}: ${item.content}`).join('\n');
  }

  function historyRelevance(content, terms) {
    const haystack = cleanText(content, 4000).toLowerCase();
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'this', 'that', 'what', 'how', 'why',
      'explain', 'panel', 'figure', 'please', 'about'
    ]);
    let score = 0;
    for (const term of terms) {
      if (!stopWords.has(term) && haystack.includes(term)) score += 1;
    }
    return score;
  }

  function retrievePanelHistory(history, baseText, options = {}) {
    const normalized = (Array.isArray(history) ? history : []).map((item, index) => ({
      historyId: cleanText(item?.historyId || item?.turnId, 120) || `history-${index + 1}`,
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(item?.content || item?.answer || item?.question, 3200),
      order: index
    })).filter(item => item.content);
    const recentCount = Math.max(2, Math.min(8, Number(options.recentCount) || 5));
    const retrievedCount = Math.max(0, Math.min(8, Number(options.retrievedCount) || 4));
    const recentStart = Math.max(0, normalized.length - recentCount);
    const recent = normalized.slice(recentStart).map(item => ({
      ...item, memoryClass: 'recent'
    }));
    const terms = queryTerms(baseText);
    const retrieved = normalized.slice(0, recentStart)
      .map(item => ({
        ...item,
        content: cleanText(item.content, 1200),
        relevance: historyRelevance(item.content, terms),
        memoryClass: 'retrieved'
      }))
      .filter(item => item.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance || right.order - left.order)
      .slice(0, retrievedCount);
    const selected = [...retrieved, ...recent]
      .sort((left, right) => left.order - right.order)
      .map(({ relevance, ...item }) => item);
    return selected;
  }

  function boundedHistory(history, baseText, image, inputBudgetTokens) {
    const selected = retrievePanelHistory(history, baseText);
    while (selected.length && estimateFigurePanelInputTokens({
      fixedTokens: 1600,
      text: `${baseText}\n${historyText(selected)}`,
      width: image?.width,
      height: image?.height
    }) > inputBudgetTokens) {
      const retrievedIndex = selected.findIndex(item => item.memoryClass === 'retrieved');
      if (retrievedIndex >= 0) selected.splice(retrievedIndex, 1);
      else if (selected.length > 2) selected.shift();
      else return [];
    }
    return selected;
  }

  function buildPanelIR(input, panelId, topic, captionEvidence, contextParagraphs) {
    const existing = input.existingPanelInterpretation || {};
    return {
      version: 'panel-ir-v1',
      figureId: cleanText(input.figureId, 80),
      panelId,
      topic,
      sharedLegend: captionEvidence.sharedLegend,
      panelCaption: captionEvidence.targetText || captionEvidence.combined,
      bodyEvidence: contextParagraphs.map(item => ({
        paragraphId: item.paragraphId,
        sectionTitle: item.sectionTitle,
        text: item.text
      })),
      priorInterpretation: {
        role: cleanText(existing.role, 80),
        phenotype: cleanText(existing.phenotypeName || existing.phenotype, 240),
        methods: (Array.isArray(existing.methods) ? existing.methods : [])
          .map(item => cleanText(item, 240)).filter(Boolean).slice(0, 12),
        observation: cleanText(existing.directObservation || existing.observation, 1200),
        contribution: cleanText(existing.contribution, 1200)
      }
    };
  }

  function buildFigurePanelPlans(input = {}) {
    const topic = classifyFigurePanelQuestion(input);
    const panelId = panelRef(input.panelId || input.panel?.panel || input.panel);
    const captionEvidence = extractFigurePanelCaption(input.caption, panelId);
    const question = cleanText(input.customQuestion || input.question, 1600);
    const contextParagraphs = selectFigurePanelParagraphs(input.contextParagraphs, {
      panelId, figureLabel: input.figureLabel, topic, question
    });
    const panelIR = buildPanelIR(input, panelId, topic, captionEvidence, contextParagraphs);
    const contextWindowTokens = Math.max(8192, Math.floor(Number(input.contextWindowTokens) || 32768));
    const outputTokens = Math.max(512, Math.floor(Number(input.outputTokens) || 2048));
    const inputBudgetTokens = Math.max(
      0,
      Math.floor(contextWindowTokens * 0.9) - outputTokens - 768
    );
    const commonText = [cleanText(input.figureLabel, 80), question, JSON.stringify(panelIR)]
      .filter(Boolean).join('\n');
    const variants = (Array.isArray(input.imageVariants) ? input.imageVariants : [])
      .map(normalizeImageVariant).filter(Boolean)
      .filter(item => item.maxEdge <= 1200)
      .sort((left, right) => right.maxEdge - left.maxEdge ||
        (right.width * right.height) - (left.width * left.height));
    const uniqueVariants = [];
    const seen = new Set();
    for (const variant of variants) {
      const key = `${variant.inputMode}:${variant.width}x${variant.height}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueVariants.push(variant);
      }
    }
    const largest = uniqueVariants[0] || null;
    const history = boundedHistory(input.history, commonText, largest, inputBudgetTokens);
    const completeText = `${commonText}\n${historyText(history)}`;
    const candidates = [...uniqueVariants, null].map((image, index) => {
      const estimatedInputTokens = estimateFigurePanelInputTokens({
        fixedTokens: 1600, text: completeText, width: image?.width, height: image?.height
      });
      return {
        requestMode: input.requestMode === 'followup' ? 'followup' : 'interpretation',
        topic, panelId,
        inputMode: image?.inputMode || 'caption_context',
        images: image ? [{ mediaType: image.mediaType, dataUrl: image.dataUrl }] : [],
        assetProof: image?.assetProof || null,
        pdfEvidenceBinding: image?.pdfEvidenceBinding ||
          input.pdfEvidenceBinding || null,
        imageWidth: image?.width || 0,
        imageHeight: image?.height || 0,
        imageMaxEdge: image?.maxEdge || 0,
        pixelsSupplied: Boolean(image),
        captionEvidence,
        contextParagraphs,
        panelIR,
        history,
        selectedSources: [
          ...(captionEvidence.sharedLegend ? ['caption:shared_legend'] : []),
          ...(captionEvidence.targetText ? [`caption:panel_${panelId}`] : []),
          ...contextParagraphs.map(item => `paragraph:${item.paragraphId}`)
        ],
        inputBudgetTokens,
        estimatedInputTokens,
        degradationReason: index === 0
          ? (image ? '' : 'vision_unavailable_or_no_image')
          : (image ? 'smaller_image_for_capacity' : 'text_only_for_capacity')
      };
    }).filter(plan => plan.estimatedInputTokens <= inputBudgetTokens);
    const strictlySmaller = [];
    for (const plan of candidates) {
      const previous = strictlySmaller.at(-1);
      if (!previous || plan.estimatedInputTokens < previous.estimatedInputTokens) strictlySmaller.push(plan);
    }
    return strictlySmaller.length ? strictlySmaller : candidates.slice(-1);
  }

  function fallbackHash(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function buildFigurePanelCacheKey(input = {}) {
    const context = {
      documentHash: cleanText(input.documentHash, 100),
      figureHash: cleanText(input.figureHash, 160),
      panelId: panelRef(input.panelId),
      providerId: cleanText(input.providerId, 80),
      model: cleanText(input.model, 240),
      profileSignature: cleanText(input.profileSignature, 160),
      inputMode: cleanText(input.inputMode, 40),
      imageWidth: Math.max(0, Number(input.imageWidth) || 0),
      imageHeight: Math.max(0, Number(input.imageHeight) || 0),
      promptVersion: cleanText(input.promptVersion || FIGURE_PANEL_PROMPT_VERSION, 40),
      requestMode: input.requestMode === 'followup' ? 'followup' : 'interpretation',
      questionSignature: cleanText(input.questionSignature, 160)
    };
    if (input.pdfEvidenceBinding && typeof input.pdfEvidenceBinding === 'object') {
      context.pdfEvidenceBinding = input.pdfEvidenceBinding;
    }
    const hash = typeof shared.stableHash === 'function' ? shared.stableHash(context) : fallbackHash(context);
    return `figure-panel:${hash}`;
  }

  function isFigurePanelCapacityError(error) {
    if (CAPACITY_ERROR_CODES.has(String(error?.code || ''))) return true;
    if (String(error?.code || '') !== 'PROVIDER_REJECTED') return false;
    return /(?:context|token|request|payload|image).{0,32}(?:large|long|limit|capacity|maximum|exceed)|too\s+(?:large|long)/i
      .test(String(error?.message || ''));
  }

  return {
    FIGURE_PANEL_PROMPT_VERSION,
    FIGURE_PANEL_IMAGE_EDGES,
    classifyFigurePanelQuestion,
    figurePanelFollowupOutputUnits,
    extractFigurePanelCaption,
    selectFigurePanelParagraphs,
    estimateFigurePanelInputTokens,
    buildFigurePanelPlans,
    retrievePanelHistory,
    buildPanelIR,
    buildFigurePanelCacheKey,
    isFigurePanelCapacityError
  };
});
