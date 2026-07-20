(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const HIGHLIGHT_DISTRIBUTION_VERSION = '1';

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function flatten(nodes) {
    if (typeof shared.flattenStructureNodes === 'function') {
      return shared.flattenStructureNodes(nodes);
    }
    const result = [];
    (Array.isArray(nodes) ? nodes : []).forEach(node => {
      result.push(node);
      result.push(...flatten(node.children));
    });
    return result;
  }

  function buildHighlightDistribution(structure = {}, occurrences = []) {
    const nodes = flatten(structure.nodes);
    const paragraphs = Array.isArray(structure.paragraphs) ? structure.paragraphs : [];
    const paragraphSection = new Map(
      paragraphs.map(item => [normalize(item.paragraphId), normalize(item.sectionId)])
    );
    const categoryMap = new Map();
    const rowMap = new Map(nodes.map(node => [
      normalize(node.sectionId),
      {
        sectionId: normalize(node.sectionId),
        title: normalize(node.title) || '未命名章节',
        level: Math.max(1, Number(node.level) || 1),
        order: Number(node.order) || 0,
        cells: {},
        total: 0
      }
    ]));
    const unresolved = [];

    (Array.isArray(occurrences) ? occurrences : []).forEach((item, index) => {
      const categoryId = normalize(item?.categoryId) || 'uncategorized';
      const category = categoryMap.get(categoryId) || {
        categoryId,
        name: normalize(item?.categoryName) || categoryId,
        color: normalize(item?.color) || '#D9D6CE',
        count: 0
      };
      category.count += 1;
      categoryMap.set(categoryId, category);

      const sectionId = normalize(item?.sectionId) ||
        paragraphSection.get(normalize(item?.paragraphId)) || '';
      const occurrence = {
        ...item,
        highlightId: normalize(item?.highlightId) || `highlight-${index + 1}`,
        categoryId,
        categoryName: category.name,
        color: category.color,
        sectionId
      };
      const row = rowMap.get(sectionId);
      if (!row) {
        unresolved.push(occurrence);
        return;
      }
      const cell = row.cells[categoryId] || { count: 0, items: [] };
      cell.count += 1;
      cell.items.push(occurrence);
      row.cells[categoryId] = cell;
      row.total += 1;
    });

    const categories = [...categoryMap.values()];
    const rows = [...rowMap.values()]
      .filter(row => row.total > 0)
      .sort((first, second) => first.order - second.order);

    return {
      version: HIGHLIGHT_DISTRIBUTION_VERSION,
      categories,
      rows,
      unresolved,
      totalHighlights: (Array.isArray(occurrences) ? occurrences : []).length
    };
  }

  return {
    HIGHLIGHT_DISTRIBUTION_VERSION,
    buildHighlightDistribution
  };
});
