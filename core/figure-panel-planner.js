(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const FIGURE_PANEL_PROMPT_VERSION = '9-evidence-certainty';
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

  // Offsets always address source text. Normalization is only for classification.
  // Semicolons belong to a declaration (notably method-to-Panel mappings).
  function captionDeclarations(text, start, end) {
    const spans = [];
    let cursor = start;
    let depth = 0;
    for (let index = start; index < end; index += 1) {
      const char = text[index];
      if (/[（(]/u.test(char)) depth += 1;
      if (/[）)]/u.test(char)) depth = Math.max(0, depth - 1);
      if (depth || !/[.!?。！？]/u.test(char)) continue;
      if (char === '.' && (/\d/u.test(text[index - 1] || '') && /\d/u.test(text[index + 1] || '') ||
          /(?:^|\W)n$/iu.test(text.slice(cursor, index)) && /^\.s\./iu.test(text.slice(index)) ||
          /(?:^|\W)n\.s$/iu.test(text.slice(cursor, index)))) continue;
      spans.push({ index: cursor, end: index + 1 });
      cursor = index + 1;
    }
    if (cursor < end) spans.push({ index: cursor, end });
    return spans.filter(span => text.slice(span.index, span.end).trim());
  }

  function unresolvedCaptionApplicability(text, completeGroup, normalizedData) {
    for (const match of text.matchAll(/\b(?:for|in|within|among)\b\s*/giu)) {
      const object = text.slice(match.index + match[0].length);
      const panelObject = object.match(/^\(([^()]*)\)/u);
      if (panelObject && completeGroup.test(panelObject[1].trim())) continue;
      // These describe replication or the normalization reference, rather
      // than a population. Every other unresolved object keeps its owner.
      if (/^in\b/iu.test(match[0]) && normalizedData && /^reference\s+to\b/iu.test(object)) continue;
      if (/^in\b/iu.test(match[0]) && /^all\s+experiments\b.*\bperformed\b/iu.test(text) &&
          /^(?:(?:(?:n\s*=\s*)?\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:independent\s+)?(?:biological\s+|technical\s+)?(?:replicates?|duplicates?|triplicates?)(?:\s+and\s+analy[sz]ed\s+by\s+[^.!?。！？]+)?(?:\s+unless\s+otherwise\s+(?:stated|indicated))?[.!?。！？]$/iu.test(object)) continue;
      return true;
    }
    return false;
  }

  function ambiguousCaptionProperty(text) {
    const prose = text.replace(/\([^()]*\)/gu, ' ');
    if (/;/u.test(prose) || [...prose.matchAll(/\b(?:are|were|is|was|have|has|had)\b/giu)].length > 1) return true;
    // A second subject with its own predicate is not governed by the first
    // parsed range. This includes clauses with and, commas or contrast words.
    if (/(?:[,;]\s*|\b(?:and|or|but|yet|while|whereas|although|where)\s+)(?:[\p{L}\p{N}][\p{L}\p{N}'’-]*\s+){1,10}(?:are|were|is|was|have|has|had|show|shows|shown|presented|expressed|display|displays|represent|represents|remain|remains)\b/iu.test(prose)) return true;
    // Accept a mean property only when the whole claim is one summary and
    // its Panel qualifiers. Arbitrary trailing prose cannot borrow its scope.
    if (/^(?:(?:all\s+)?(?:[\p{L}\p{N}-]+\s+){0,3}(?:data|values|measurements|signals)\b|(?:all\s+)?error\s+bars?\b).*\bmean\b/iu.test(text)) {
      const claim = text.replace(/\b(?:for|in)\s*\([^()]*\)/giu, ' ').replace(/\s+/gu, ' ').replace(/\s+([.!?。！？])$/u, '$1').trim();
      const subject = '(?:(?:all\\s+)?(?:[\\p{L}\\p{N}-]+\\s+){0,3}(?:data|values|measurements|signals)\\s+(?:(?:are|were)\\s+)?(?:shown|presented|expressed)\\s+as|(?:all\\s+)?error\\s+bars?\\s+(?:show|represent|indicate))';
      const uncertainty = '(?:SD|SEM|SE|standard\\s+deviations?|standard\\s+errors?(?:\\s+of\\s+(?:the\\s+)?mean)?|(?:(?:\\d{1,2}(?:\\.\\d+)?|100(?:\\.0+)?)\\s*%\\s*)?(?:CIs?|confidence\\s+intervals?))';
      return !new RegExp(`^${subject}\\s+mean(?:\\s*(?:±|\\+/?-|with|and)\\s*${uncertainty})?(?:\\s+unless\\s+otherwise\\s+(?:stated|indicated))?[.!?。！？]$`, 'iu').test(claim);
    }
    return false;
  }

  function statisticalCaptionScope(text, group) {
    // Definitions are shared; mapped tests and labelled results retain their
    // exact original sentence and only the explicitly named Panel owners.
    if (/\b(?:only|except)\b/iu.test(text)) return null;
    const number = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
    const threshold = new RegExp(`^(?:[*∗★]+\\s*p|n\\.?s\\.?\\s+p)\\s*(?:<=|>=|[<>≤≥])\\s*${number}$`, 'iu');
    const definitions = text.replace(/[.]$/u, '').split(/[,;]\s*|\s+and\s+/iu)
      .map(part => part.replace(/^and\s+/iu, '').trim()).filter(Boolean);
    if (definitions.length > 1 && definitions.every(part => threshold.test(part))) return { public: true, statistics: true };
    if (/^Experiments were independently repeated (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) times with similar results[.]$/iu.test(text)) {
      return { public: true, statistics: true };
    }
    const method = '(?:(?:one|two|three)[- ](?:tailed|sided|way)\\s+)?' +
      '(?:(?:unpaired|paired)\\s+)?(?:t[- ]tests?|ANOVA|(?:Student[\'’]s?|Welch[\'’]s?)\\s+t[- ]tests?|Pearson\\s+correlation\\s+analysis)';
    const clause = `${method}\\s*(?:(?:for|in)\\s*)?\\(${group}\\)`;
    const mapping = text.replace(/^Statistical significance was determined by\s+/iu, '').replace(/[.]$/u, '');
    const completeMapping = new RegExp(`^${clause}(?:\\s*(?:,\\s*(?:and\\s+)?|;\\s*|and\\s+)${clause})*$`, 'iu');
    if (/[.]$/u.test(text) && completeMapping.test(mapping)) {
      const panels = [...new Set([...mapping.matchAll(/\(([^()]*)\)/gu)]
        .flatMap(match => markerPanels(match[1])))];
      if (panels.length) return { panels };
    }
    // A sentence may contain several labelled statistical rows separated by
    // semicolons. Keep the rows together, including their original labels.
    const row = new RegExp(`(?:^|;\\s*)(${group})\\s+[^;.!?]{1,100}:`, 'giu');
    if (new RegExp(`^${group}\\s+[^;.!?]{1,100}:`, 'iu').test(text) && /\bP\s*=\s*\d/iu.test(text)) {
      const panels = [...new Set([...text.matchAll(row)].flatMap(match => markerPanels(match[1])))];
      if (panels.length) return { panels };
    }
    const representative = new RegExp(`^The numbers in the graphs indicate the percentage of cells, and plots of data from one representative tumor are shown\\s*\\((${group})\\)[.]?$`, 'iu');
    const matched = text.match(representative);
    return matched ? { panels: markerPanels(matched[1]) } : null;
  }

  function captionDeclarationScope(value, group) {
    const text = cleanText(value, 12000);
    const statistics = statisticalCaptionScope(text, group);
    if (statistics) return statistics;
    if (!/[.!?。！？]$/u.test(text)) return { local: true };
    const refs = [...text.matchAll(/\(([^()]*)\)/gu)];
    const completeGroup = new RegExp(`^${group}$`, 'iu');
    const restrictive = /\b(?:only|except)\b/iu.test(text);
    const mapping = /^(?:scale\s+bars?\b|statistics\s*[:：]|statistical\s+(?:analysis|analyses|tests?)\s*[:：])/iu.test(text) ||
      /^(?:all\s+)?error\s+bars?\b/iu.test(text) && (refs.length > 1 || /;/u.test(text)) ||
      /^(?:unpaired|paired|one[- ]way|two[- ]way|three[- ]way|Student['’]?s?|Welch['’]?s?|ANOVA|t[- ]test)\b/iu.test(text) &&
        refs.length > 0 && !/\b(?:for|in)\s*\(/iu.test(text);
    if (restrictive) return { local: true };
    const property = /^(?:(?:all\s+)?(?:[\p{L}\p{N}-]+\s+){0,3}(?:data|values|measurements|signals)\b|(?:all\s+)?error\s+bars?\b|n\s*=|(?:unpaired|paired|one[- ]way|two[- ]way|three[- ]way|Student['’]?s?|Welch['’]?s?|ANOVA|t[- ]test)\b|all\s+experiments\b|statistics\s*[:：]|statistical\s+(?:analysis|analyses|tests?)\s*[:：])/iu.test(text);
    const normalizedData = text.match(/\b(?:data|values|measurements|signals)\s*(?:(?:in|for)\s*)?\(([^()]*)\)\s+(?:are|were|is|was)\s+(?:not\s+)?normali[sz]ed\b/iu);
    const qualification = text.match(/\b(?:for|in)\s*\(([^()]*)\)/iu);
    const qualifiedProperty = property && qualification &&
      /\b(?:mean|error|normali[sz]ed|replicates?|test|ANOVA|performed|analy[sz]ed)\b|^n\s*=/iu.test(text);
    if ((property || normalizedData) && unresolvedCaptionApplicability(text, completeGroup, normalizedData)) {
      return { local: true };
    }
    const qualifiedMapping = qualifiedProperty && !/^scale\s+bars?\b/iu.test(text) &&
      (refs.filter(ref => completeGroup.test(ref[1].trim())).length <= 1 || /\bfor\s*\(/iu.test(text));
    if (mapping && !qualifiedMapping) return { public: true };
    if (normalizedData || qualifiedProperty) {
      if (ambiguousCaptionProperty(text)) return { local: true };
      // No partial range parsing or resolving conflicting predicates.
      const range = (normalizedData || qualification)[1].trim();
      if (!completeGroup.test(range) || refs.filter(ref => completeGroup.test(ref[1].trim())).length > 1) return { local: true };
      const panels = markerPanels(range);
      return panels.length ? { panels } : { local: true };
    }
    // An unresolved explicit/population qualifier cannot become a default.
    if (property && (refs.length || ambiguousCaptionProperty(text))) return { local: true };
    const publicDeclaration = /^(?:(?:all\s+)?error\s+bars?\b|data\s+(?:(?:are|were)\s+)?(?:shown|presented|expressed)\s+as\s+mean\b|all\s+experiments\s+(?:(?:were\s+)?performed|analy[sz]ed)\b)/iu.test(text) ||
      /^n\s*=\s*\d+.*\bunless\s+otherwise\s+(?:stated|indicated)\b/iu.test(text);
    // Adjacent definitions do not confer shared scope on a result or on
    // an attachment with its own Panel/population qualification.
    const attachment = /^(?:[*∗★]+\s*p\s*[<>=≤≥]|n\.?s\.?\s+(?:indicates|means|denotes)|See\s+also\s+(?:Figure|Table)\b)/iu.test(text) &&
      !refs.length && !/\bp\s*=\s*[\d.]/iu.test(text) &&
      !unresolvedCaptionApplicability(text, completeGroup, false);
    return { public: publicDeclaration, attachment };
  }

  function joinCaptionSpans(text, spans) {
    const merged = [];
    for (const span of spans.sort((left, right) => left.index - right.index)) {
      const previous = merged.at(-1);
      if (previous && span.index <= previous.end) previous.end = Math.max(previous.end, span.end);
      else if (previous && !text.slice(previous.end, span.index).trim()) previous.end = span.end;
      else merged.push({ index: span.index, end: span.end });
    }
    return merged.map(span => text.slice(span.index, span.end).trim()).filter(Boolean).join(' ');
  }

  function extractFigurePanelCaption(caption, requestedPanel) {
    const text = cleanSourceText(caption, 12000);
    const panel = panelRef(requestedPanel);
    const letter = '[A-Z\\uFF21-\\uFF3A]';
    const group = `${letter}(?:\\s*[-\\u2010-\\u2015\\u2212]\\s*${letter})?` +
      '(?:(?:\\s*(?:,|&|;|，|；)\\s*|\\s+(?:and|or|to)\\s+)' +
      `${letter}(?:\\s*[-\\u2010-\\u2015\\u2212]\\s*${letter})?)*`;
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
    const markers = longestSequentialInlineRun(inlineCandidates);
    const declarations = captionDeclarations(text, 0, text.length);
    const parenthesized = new RegExp(`[\\(（]\\s*(${group})\\s*[\\)）]\\s*`, 'gi');
    for (const match of text.matchAll(parenthesized)) {
      const after = text.slice((match.index || 0) + match[0].length);
      const before = text.slice(0, match.index).trimEnd();
      const panels = markerPanels(match[1]);
      // Inline headings establish the current source section too. Otherwise,
      // references in "a,b, WT (a) versus mutant (b) mice" become boundaries
      // and joining their fragments can change the original group assignment.
      const previous = markers.reduce((latest, marker) =>
        marker.index < match.index && (!latest || marker.index > latest.index) ? marker : latest, null);
      const nextSequentialSection = previous &&
        panels[0]?.charCodeAt(0) === previous.panels.at(-1)?.charCodeAt(0) + 1 &&
        !/\b(?:in|see|from|for|of|and|or|to|with|than|test|ANOVA|SEM|SD)\s*$/iu.test(before);
      const declarationBefore = before.slice(previous?.end || 0);
      const referenceBeforeTest = /\b(?:statistics|statistical\s+(?:analysis|analyses|tests?))\s*[:：]/iu.test(declarationBefore) &&
        /^(?:unpaired|paired|one[- ]way|two[- ]way|three[- ]way|Student['’]?s?|Welch['’]?s?|ANOVA|t[- ]test)\b/iu.test(after);
      const referenceBeforeNormalization = /\b(?:data|values|measurements|signals)\s*(?:in\s*)?$/iu.test(before) &&
        /^(?:are|were|is|was)\s+(?:not\s+)?normali[sz]ed\b/iu.test(after);
      // A leading property declaration has no prior section to guard its
      // for/in reference. Check that declaration without treating its scope
      // as a heading or altering the owner of the following prose.
      const leadingDeclaration = !previous && /\b(?:for|in)\s*$/iu.test(before) &&
        declarations.find(span => span.index <= match.index && span.end > match.index);
      const leadingScope = leadingDeclaration && captionDeclarationScope(
        text.slice(leadingDeclaration.index, leadingDeclaration.end), group);
      const referenceBeforeProperty = leadingScope && (leadingScope.panels || leadingScope.local);
      // A section label introduces prose. References such as "test (A),"
      // and "(B)–(D) show mean ± SD" must stay with their original clause.
      if (!after || referenceBeforeTest || referenceBeforeNormalization || referenceBeforeProperty || /^[,.;:!?，。；：！？&\-\u2010-\u2015\u2212]/u.test(after) ||
          /^(?:and|or|to)\b/iu.test(after) ||
          (previous && !/[.!?;。！？；:：]$/u.test(before) && !nextSequentialSection)) continue;
      markers.push({
        index: match.index,
        end: (match.index || 0) + match[0].length,
        panels
      });
    }
    markers.sort((left, right) => left.index - right.index || right.end - left.end);
    if (!markers.length) {
      return { panel, sharedLegend: '', targetText: text.slice(0, 6000), combined: text.slice(0, 6000) };
    }
    const sharedSpans = [];
    let sharedStatistics = false;
    const targetSpans = [];
    const sections = [{ index: 0, end: 0, panels: null }, ...markers];
    for (let owner = 0; owner < sections.length; owner += 1) {
      const section = sections[owner];
      const end = sections[owner + 1]?.index ?? text.length;
      if (section.panels?.includes(panel)) targetSpans.push({ index: section.index, end: section.end });
      let adjacentPublic = false;
      for (const span of captionDeclarations(text, section.end, end)) {
        const scope = captionDeclarationScope(text.slice(span.index, span.end), group);
        if (scope.panels) {
          if (scope.panels.includes(panel)) targetSpans.push(span);
          adjacentPublic = false;
        } else if (!section.panels || owner === sections.length - 1 &&
            !scope.local && (scope.public || scope.attachment && adjacentPublic)) {
          sharedSpans.push(span);
          if (scope.statistics) sharedStatistics = true;
          adjacentPublic = true;
        } else {
          if (section.panels.includes(panel)) targetSpans.push(span);
          adjacentPublic = false;
        }
      }
    }
    const sharedLegend = joinCaptionSpans(text, sharedSpans);
    const targetText = joinCaptionSpans(text, targetSpans).slice(0, 4800);
    const combined = [sharedLegend, targetText].filter(Boolean).join(' ');
    return { panel, sharedLegend, targetText, combined,
      ...(sharedStatistics ? { sharedStatistics: true } : {}) };
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
