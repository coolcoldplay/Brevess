(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_STRUCTURE_VERSION = '1';
  const TERMINAL_SECTION = /^(references|bibliography|literature cited)\b/i;
  const UTILITY_SECTION = /^(?:keywords?|abbreviations?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|information|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|generative ai statement|declaration of ai use|funding|conflicts? of interest(?:\s+declaration)?|competing interests?|declaration of (?:competing )?interests?|data availability(?:\s+statement)?|supplementary (?:materials?|data)|footnotes?|recommended articles?|cited by|article metrics?|metrics\s*&\s*citations|view options|publication history|license summary\*?|subjects|article views|altmetric|citations|figures|tables|media|share|show full outline)$/i;

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function hash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let first = 2166136261;
    let second = 2166136261 ^ 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}` +
      `${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function flattenStructureNodes(nodes) {
    const result = [];
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      result.push(node);
      result.push(...flattenStructureNodes(node.children));
    });
    return result;
  }

  function headingAnchor(item, path) {
    return {
      domId: normalize(item.domId),
      dataSelector: normalize(item.dataSelector),
      headingText: normalize(item.title),
      headingPathFingerprint: hash(path.map(entry => entry.title)),
      blockFingerprint: normalize(item.blockFingerprint || item.sourceKey),
      sourceOrder: Number(item.order) || 0
    };
  }

  function paragraphAnchor(item, path) {
    return {
      domId: normalize(item.domId),
      dataSelector: normalize(item.dataSelector),
      headingText: path.length ? path[path.length - 1].title : '',
      headingPathFingerprint: hash(path.map(entry => entry.title)),
      blockFingerprint: normalize(item.blockFingerprint || item.sourceKey || hash(item.text)),
      sourceOrder: Number(item.order) || 0
    };
  }

  function buildArticleStructure(input = {}) {
    const sourceHeadings = (Array.isArray(input.headings) ? input.headings : [])
      .map((item, index) => ({
        ...item,
        sourceKey: normalize(item?.sourceKey || `heading-${index + 1}`),
        parentSourceKey: normalize(item?.parentSourceKey),
        title: normalize(item?.title),
        level: Math.min(6, Math.max(1, Number(item?.level) || 2)),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
      }))
      .filter(item => item.title)
      .sort((first, second) => first.order - second.order);

    const nodes = [];
    const nodeBySourceKey = new Map();
    const stack = [];
    let terminalReached = false;
    let excludedCount = 0;

    for (const item of sourceHeadings) {
      if (terminalReached) {
        excludedCount += 1;
        continue;
      }
      if (TERMINAL_SECTION.test(item.title)) {
        terminalReached = true;
        excludedCount += 1;
        continue;
      }
      if (UTILITY_SECTION.test(item.title)) {
        excludedCount += 1;
        continue;
      }

      const explicitParent = item.parentSourceKey
        ? nodeBySourceKey.get(item.parentSourceKey) : null;
      let level = explicitParent
        ? Math.min(6, Math.max(item.level, explicitParent.level + 1))
        : item.level;
      let parent = explicitParent;

      if (!parent) {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        parent = stack.length ? stack[stack.length - 1] : null;
      }

      const ancestry = parent
        ? [...parent.headingPath, { sectionId: parent.sectionId, title: parent.title }]
        : [];
      const sectionId = `sec-${hash([
        input.adapterId || 'generic',
        item.sourceKey,
        item.title,
        ancestry.map(entry => entry.title)
      ])}`;
      const path = [
        ...ancestry,
        { sectionId, title: item.title }
      ];
      const node = {
        nodeId: `node-${sectionId.slice(4)}`,
        sectionId,
        sourceKey: item.sourceKey,
        title: item.title,
        level,
        parentSectionId: parent?.sectionId || '',
        order: item.order,
        anchor: headingAnchor(item, path),
        headingPath: ancestry,
        children: [],
        paragraphIds: []
      };
      if (parent) parent.children.push(node);
      else nodes.push(node);
      nodeBySourceKey.set(item.sourceKey, node);

      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push(node);
    }

    const flatNodes = flattenStructureNodes(nodes);
    const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : [])
      .map((item, index) => ({
        ...item,
        sourceKey: normalize(item?.sourceKey || `paragraph-${index + 1}`),
        headingSourceKey: normalize(item?.headingSourceKey),
        text: normalize(item?.text),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
      }))
      .filter(item => item.text)
      .sort((first, second) => first.order - second.order)
      .flatMap(item => {
        let node = item.headingSourceKey
          ? nodeBySourceKey.get(item.headingSourceKey) : null;
        if (!node) {
          node = [...flatNodes].reverse().find(candidate =>
            candidate.order <= item.order
          ) || flatNodes[0];
        }
        if (!node) return [];
        const pathNodes = [];
        let current = node;
        while (current) {
          pathNodes.unshift(current);
          current = current.parentSectionId
            ? flatNodes.find(candidate => candidate.sectionId === current.parentSectionId)
            : null;
        }
        const headingPath = pathNodes.map(candidate => ({
          level: candidate.level,
          sectionId: candidate.sectionId,
          title: candidate.title
        }));
        const paragraphId = `p-${hash([
          item.sourceKey, node.sectionId, item.text.slice(0, 800)
        ])}`;
        node.paragraphIds.push(paragraphId);
        return [{
          paragraphId,
          sourceKey: item.sourceKey,
          sectionId: node.sectionId,
          sectionTitle: node.title,
          sectionKind: item.sectionKind || 'article',
          headingLevel: node.level,
          headingPath,
          kind: item.kind || 'paragraph',
          text: item.text,
          order: item.order,
          anchor: paragraphAnchor(item, headingPath)
        }];
      });

    const structure = {
      version: ARTICLE_STRUCTURE_VERSION,
      adapterId: normalize(input.adapterId || 'generic'),
      publisherFamily: normalize(input.publisherFamily || 'generic'),
      strategy: normalize(input.strategy || 'semantic-merge'),
      revision: Math.max(1, Number(input.revision) || 1),
      title: normalize(input.title),
      documentId: normalize(input.documentId),
      diagnostics: {
        outlineEntryCount: Math.max(0, Number(input.diagnostics?.outlineEntryCount) || 0),
        matchedOutlineEntryCount: Math.max(
          0, Number(input.diagnostics?.matchedOutlineEntryCount) || 0
        ),
        headingCount: flatNodes.length,
        paragraphCount: paragraphs.length,
        characterCount: paragraphs.reduce((sum, item) => sum + item.text.length, 0),
        excludedCount: excludedCount + Math.max(
          0, Number(input.diagnostics?.excludedCount) || 0
        ),
        warnings: [...new Set(
          Array.isArray(input.diagnostics?.warnings) ? input.diagnostics.warnings : []
        )].slice(0, 20)
      },
      nodes,
      paragraphs
    };
    const outlineCount = structure.diagnostics.outlineEntryCount;
    structure.diagnostics.outlineCoverage = outlineCount
      ? Math.min(1, structure.diagnostics.matchedOutlineEntryCount / outlineCount)
      : null;
    if (outlineCount >= 3 && structure.diagnostics.outlineCoverage < 0.7) {
      structure.diagnostics.warnings.push('OUTLINE_COVERAGE_LOW');
    }
    return structure;
  }

  function structureSignature(structure) {
    return hash({
      adapterId: structure?.adapterId,
      nodes: flattenStructureNodes(structure?.nodes).map(node => [
        node.sectionId, node.parentSectionId, node.title, node.level, node.order
      ]),
      paragraphs: (structure?.paragraphs || []).map(item => [
        item.paragraphId, item.sectionId, hash(item.text)
      ])
    });
  }

  function reconcileArticleStructure(previous, next) {
    if (!previous) return next;
    if (structureSignature(previous) === structureSignature(next)) {
      return { ...next, revision: previous.revision };
    }
    return { ...next, revision: Math.max(1, Number(previous.revision) || 1) + 1 };
  }

  function resolveArticleStructureParagraph(structure, target = {}) {
    const paragraphs = Array.isArray(structure?.paragraphs) ? structure.paragraphs : [];
    const paragraphId = normalize(target?.paragraphId);
    if (paragraphId) {
      const byId = paragraphs.find(item => normalize(item?.paragraphId) === paragraphId);
      if (byId) return byId;
    }
    const sourceKey = normalize(target?.sourceKey);
    return sourceKey
      ? paragraphs.find(item => normalize(item?.sourceKey) === sourceKey) || null
      : null;
  }

  function toReviewParagraphRecords(structure) {
    return (Array.isArray(structure?.paragraphs) ? structure.paragraphs : [])
      .map(paragraph => ({
        ...paragraph,
        headingPath: (Array.isArray(paragraph?.headingPath) ? paragraph.headingPath : [])
          .map(heading => ({ ...heading })),
        anchor: paragraph?.anchor ? { ...paragraph.anchor } : paragraph?.anchor
      }));
  }

  return {
    ARTICLE_STRUCTURE_VERSION,
    buildArticleStructure,
    reconcileArticleStructure,
    structureSignature,
    flattenStructureNodes,
    resolveArticleStructureParagraph,
    toReviewParagraphRecords
  };
});
