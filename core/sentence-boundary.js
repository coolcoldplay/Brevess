(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ABBREVIATIONS = new Set([
    'fig', 'figs', 'eq', 'eqs', 'ref', 'refs', 'dr', 'mr', 'mrs', 'ms',
    'prof', 'vs', 'no', 'nos', 'vol', 'vols', 'approx', 'dept', 'inc',
    'st', 'al', 'e.g', 'i.e'
  ]);

  function isProtectedPeriod(text, index) {
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    if (/\d/.test(previous) && /\d/.test(next)) return true;

    const before = text.slice(0, index);
    const tokenMatch = before.match(/([A-Za-z](?:[A-Za-z.]*)?)$/);
    const token = tokenMatch ? tokenMatch[1].toLowerCase() : '';
    if (ABBREVIATIONS.has(token)) return true;

    const nextWord = text.slice(index + 1).match(/^\s*([A-Za-z])/);
    if (/^[a-z]$/i.test(token) && nextWord && /[a-z]/.test(nextWord[1])) return true;
    return false;
  }

  function isSentenceBoundary(text, index) {
    const character = text[index];
    if ('。！？!?\n'.includes(character)) return true;
    return character === '.' && !isProtectedPeriod(text, index);
  }

  function findScientificSentenceBounds(value, matchStart, matchEnd) {
    const text = String(value || '');
    const safeStart = Math.max(0, Math.min(text.length, Number(matchStart) || 0));
    const safeEnd = Math.max(safeStart, Math.min(text.length, Number(matchEnd) || safeStart));
    let start = 0;
    for (let index = safeStart - 1; index >= 0; index -= 1) {
      if (isSentenceBoundary(text, index)) {
        start = index + 1;
        break;
      }
    }
    while (start < safeStart && /\s/.test(text[start])) start += 1;

    let end = text.length;
    for (let index = safeEnd; index < text.length; index += 1) {
      if (!isSentenceBoundary(text, index)) continue;
      end = index + 1;
      while (end < text.length && /["'’”）)\]]/.test(text[end])) end += 1;
      break;
    }
    while (end > safeEnd && /\s/.test(text[end - 1])) end -= 1;
    return { start, end };
  }

  return { findScientificSentenceBounds };
});
