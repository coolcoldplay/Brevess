(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const ARTICLE_STRUCTURE_VERSION = '3';
  const NAVIGABLE_ARTICLE_SECTION = /^(?:main|highlights?|summary|abstract|graphical abstract|keywords?|introduction|background|materials? and methods?|methods?|methodology|experimental procedures?|star\s*[★*]?\s*methods?|results?|findings?|discussion|conclusions?|concluding remarks?|limitations?|resource availability|data(?: and code)? availability(?: statement)?|code availability|references|bibliography|literature cited|appendix|extended data(?: figures?|tables?)?|supplement(?:al|ary)(?: information| materials?| data| figures?| tables?)?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|funding|conflicts? of interest(?: declaration)?|competing interests?|declaration of (?:competing )?interests?|ethics approval|institutional review board statement|informed consent statement|footnotes?)\b/i;
  const UTILITY_SECTION = /^(?:keywords?|abbreviations?|acknowledg(?:e)?ments?|author information|information\s*&\s*authors|information|info|authors?(?:['’]s?)?\s+contributions?|credit authorship contribution statement|generative ai statement|declaration of ai use|funding|conflicts? of interest(?:\s+declaration)?|competing interests?|declaration of (?:competing )?interests?|data availability(?:\s+statement)?|supplementary (?:materials?|data)|footnotes?|recommended articles?|related content|similar content(?:\s+being viewed by others)?|you may also like|recommended for you|cited by|article metrics?|metrics\s*&\s*citations|view options|publication history|license summary\*?|subjects|article views|altmetric|citations|figures|tables|media|share|accessibility(?:\s*&\s*keyboard shortcuts)?|download options|transcript|show full outline)$/i;

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function normalizeDisplay(value, fallback = '') {
    return String(value || fallback || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(line => line.replace(/[^\S\n]+/gu, ' ').trim())
      .filter(Boolean)
      .join('\n');
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

  function normalizeRecordType(item) {
    const type = normalize(item?.recordType);
    if (['figure-caption', 'table-caption', 'reference'].includes(type)) return type;
    if (item?.kind === 'figure-caption') return 'figure-caption';
    if (item?.kind === 'table-caption') return 'table-caption';
    if (item?.kind === 'reference') return 'reference';
    return 'body';
  }

  function normalizeSectionPath(value) {
    return (Array.isArray(value) ? value : []).map((item, index) => ({
      level: Math.min(6, Math.max(1, Number(item?.level) || 2)),
      sectionId: normalize(item?.sectionId || `section-${index + 1}`),
      title: normalize(item?.title),
      displayTitle: normalizeDisplay(item?.displayTitle, item?.title)
    })).filter(item => item.title);
  }

  function buildArticleStructure(input = {}) {
    const sourceHeadings = (Array.isArray(input.headings) ? input.headings : [])
      .map((item, index) => ({
        ...item,
        sourceKey: normalize(item?.sourceKey || `heading-${index + 1}`),
        parentSourceKey: normalize(item?.parentSourceKey),
        title: normalize(item?.title),
        displayTitle: normalizeDisplay(item?.displayTitle, item?.title),
        sectionKind: normalize(item?.sectionKind),
        level: Math.min(6, Math.max(1, Number(item?.level) || 2)),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
      }))
      .filter(item => item.title)
      .sort((first, second) => first.order - second.order);

    const nodes = [];
    const nodeBySourceKey = new Map();
    const stack = [];
    let excludedCount = 0;

    for (const item of sourceHeadings) {
      if (UTILITY_SECTION.test(item.title) &&
          !NAVIGABLE_ARTICLE_SECTION.test(item.title)) {
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
        ? [...parent.headingPath, {
            sectionId: parent.sectionId,
            title: parent.title,
            displayTitle: parent.displayTitle || parent.title
          }]
        : [];
      const sectionId = `sec-${hash([
        input.adapterId || 'generic',
        item.sourceKey,
        item.title,
        ancestry.map(entry => entry.title)
      ])}`;
      const path = [
        ...ancestry,
        {
          sectionId,
          title: item.title,
          displayTitle: item.displayTitle || item.title
        }
      ];
      const node = {
        nodeId: `node-${sectionId.slice(4)}`,
        sectionId,
        sourceKey: item.sourceKey,
        title: item.title,
        displayTitle: item.displayTitle || item.title,
        sectionKind: item.sectionKind || '',
        level,
        parentSectionId: parent?.sectionId || '',
        order: item.order,
        anchor: headingAnchor(item, path),
        headingPath: ancestry,
        sectionPath: path.map(entry => normalize(entry.title)),
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
    const typedRecords = (Array.isArray(input.paragraphs) ? input.paragraphs : [])
      .map((item, index) => ({
        ...item,
        sourceKey: normalize(item?.sourceKey || `paragraph-${index + 1}`),
        sourceIdentity: normalize(item?.sourceIdentity),
        headingSourceKey: normalize(item?.headingSourceKey),
        text: normalize(item?.text),
        displayText: normalizeDisplay(item?.displayText, item?.text),
        textHash: normalize(item?.textHash) || hash(normalize(item?.text)),
        recordType: normalizeRecordType(item),
        sectionTitle: normalize(item?.sectionTitle),
        displaySectionTitle: normalizeDisplay(
          item?.displaySectionTitle,
          item?.sectionTitle
        ),
        sectionPath: normalizeSectionPath(item?.sectionPath),
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
        const pathNodes = [];
        let current = node;
        while (current) {
          pathNodes.unshift(current);
          current = current.parentSectionId
            ? flatNodes.find(candidate => candidate.sectionId === current.parentSectionId)
            : null;
        }
        let headingPath = pathNodes.map(candidate => ({
          level: candidate.level,
          sectionId: candidate.sectionId,
          title: candidate.title,
          displayTitle: candidate.displayTitle || candidate.title
        }));
        if (!headingPath.length) headingPath = item.sectionPath;
        if (!headingPath.length && item.sectionTitle) {
          headingPath = [{
            level: 2,
            sectionId: `sec-${hash([item.sectionTitle, item.recordType])}`,
            title: item.sectionTitle,
            displayTitle: item.displaySectionTitle || item.sectionTitle
          }];
        }
        if (!headingPath.length) return [];
        const leaf = headingPath[headingPath.length - 1];
        const sectionId = node?.sectionId || leaf.sectionId;
        const sectionTitle = node?.title || leaf.title;
        const paragraphId = `p-${hash([
          headingPath.map(entry => normalize(entry.title).toLowerCase()),
          item.recordType,
          item.textHash,
          item.sourceIdentity || item.sourceKey
        ])}`;
        if (node && item.recordType === 'body') node.paragraphIds.push(paragraphId);
        return [{
          paragraphId,
          sourceKey: item.sourceKey,
          sourceIdentity: item.sourceIdentity || item.sourceKey,
          textHash: item.textHash,
          recordType: item.recordType,
          sectionId,
          sectionTitle,
          displaySectionTitle: node?.displayTitle ||
            item.displaySectionTitle || sectionTitle,
          sectionKind: item.sectionKind || 'article',
          headingLevel: node?.level || leaf.level,
          headingPath,
          kind: item.kind || 'paragraph',
          text: item.text,
          displayText: item.displayText || item.text,
          order: item.order,
          anchor: paragraphAnchor(item, headingPath)
        }];
      });

    const paragraphs = typedRecords.filter(item => item.recordType === 'body');
    const countTyped = type => typedRecords.filter(item => item.recordType === type).length;

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
        recordCount: typedRecords.length,
        bodyParagraphCount: paragraphs.length,
        figureCaptionCount: countTyped('figure-caption'),
        tableCaptionCount: countTyped('table-caption'),
        referenceCount: countTyped('reference'),
        characterCount: paragraphs.reduce((sum, item) => sum + item.text.length, 0),
        typedCharacterCount: typedRecords.reduce((sum, item) => sum + item.text.length, 0),
        excludedCount: excludedCount + Math.max(
          0, Number(input.diagnostics?.excludedCount) || 0
        ),
        warnings: [...new Set(
          Array.isArray(input.diagnostics?.warnings) ? input.diagnostics.warnings : []
        )].slice(0, 20)
      },
      nodes,
      paragraphs,
      typedRecords
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
        node.sectionId, node.parentSectionId, node.title, node.displayTitle,
        node.level, node.order
      ]),
      typedRecords: (structure?.typedRecords || structure?.paragraphs || []).map(item => [
        item.paragraphId, item.sectionId, item.recordType || 'body',
        item.textHash || hash(item.text)
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
