(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const STRUCTURAL_ABBREVIATIONS = new Set([
    'fig', 'figure', 'figs', 'table', 'tables', 'panel', 'panels',
    'section', 'sections', 'supp', 'supplement', 'supplementary',
    'appendix', 'appendices', 'ref', 'refs', 'reference', 'references',
    'eq', 'equation', 'equations'
  ]);
  const INITIAL_STOP_WORDS = new Set([
    'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of',
    'on', 'or', 'the', 'to', 'via', 'with'
  ]);
  const REAGENT_OR_METADATA = /(?:\banti-|antibod(?:y|ies)\b|\bbeads?\b|\bcatalog(?:ue)?\b|\bcat\.?\s*no\b|\blot\s*(?:no\.?|number)\b|\bclone\b|\brrid\b|\bmiltenyi\b|\bbiotec\b|\bthermo fisher\b|\bsigma(?:-aldrich)?\b|\babcam\b)/i;
  const DESCRIPTOR_ONLY = /^(?:cluster|group|class|subtype|subset|population|sample|batch)\s*(?:no\.?\s*)?[A-Za-z0-9.-]+$/i;
  const GLOBAL_ABBREVIATION_MEMORY_KEY = 'sciGlobalAbbreviationMemoryV1';
  const GLOBAL_ABBREVIATION_SCHEMA_VERSION = 1;
  const MAX_GLOBAL_ABBREVIATION_ENTRIES = 5000;

  function normalizeSpace(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function plainScientificText(value) {
    return normalizeSpace(String(value || '').replace(/<\/?(?:sup|sub)>/gi, ''));
  }

  function abbreviationKey(value) {
    return plainScientificText(value)
      .replace(/[^A-Za-z0-9\u0370-\u03ff]/g, '')
      .toLowerCase();
  }

  function isSafeUserAbbreviation(value) {
    const abbreviation = plainScientificText(value);
    return abbreviation.length >= 1 &&
      abbreviation.length <= 30 &&
      !/\s/.test(abbreviation) &&
      !STRUCTURAL_ABBREVIATIONS.has(abbreviation.toLowerCase()) &&
      /^[A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff+./-]*$/.test(abbreviation);
  }

  function abbreviationPairKey(abbreviation, fullName) {
    return `${abbreviationKey(abbreviation)}\u0000${plainScientificText(fullName).toLowerCase()}`;
  }

  function normalizeChineseMeaning(value) {
    const meaning = plainScientificText(value).slice(0, 240);
    return /[\u3400-\u9fff]/u.test(meaning) ? meaning : '';
  }

  function normalizeAbbreviationTimestamp(value, fallback = '') {
    const timestamp = String(value || '').trim();
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      return new Date(timestamp).toISOString();
    }
    return fallback;
  }

  function normalizeUserAbbreviationEntry(value = {}, defaults = {}) {
    const abbreviation = plainScientificText(value.abbreviation);
    const fullName = plainScientificText(value.fullName).slice(0, 240);
    if (!isSafeUserAbbreviation(abbreviation) ||
        fullName.length < 2 ||
        abbreviationKey(fullName) === abbreviationKey(abbreviation)) {
      return null;
    }
    const now = normalizeAbbreviationTimestamp(defaults.now) || new Date().toISOString();
    const addedAt = normalizeAbbreviationTimestamp(value.addedAt, now);
    const updatedAt = normalizeAbbreviationTimestamp(value.updatedAt, addedAt);
    const entry = {
      abbreviation,
      fullName,
      supportCount: Math.min(
        100000,
        Math.max(1, Math.floor(Number(value.supportCount) || 1))
      ),
      addedAt,
      updatedAt
    };
    const meaningZh = normalizeChineseMeaning(value.meaningZh);
    if (meaningZh) entry.meaningZh = meaningZh;
    const paragraphId = String(value.paragraphId || '').slice(0, 500);
    const sourceKey = String(value.sourceKey || paragraphId || '').slice(0, 500);
    const navigationRevision = Math.max(
      0,
      Math.floor(Number(value.navigationRevision) || 0)
    );
    if (paragraphId) entry.paragraphId = paragraphId;
    if (sourceKey) entry.sourceKey = sourceKey;
    if (navigationRevision) entry.navigationRevision = navigationRevision;
    return entry;
  }

  function normalizeGlobalAbbreviationMemory(value = {}) {
    const source = Array.isArray(value) ? value :
      (Array.isArray(value?.entries) ? value.entries : []);
    const store = new Map();
    source.slice(0, MAX_GLOBAL_ABBREVIATION_ENTRIES * 2).forEach(item => {
      const normalizedEntry = normalizeUserAbbreviationEntry(item);
      if (!normalizedEntry) return;
      const entry = {
        abbreviation: normalizedEntry.abbreviation,
        fullName: normalizedEntry.fullName,
        supportCount: normalizedEntry.supportCount,
        addedAt: normalizedEntry.addedAt,
        updatedAt: normalizedEntry.updatedAt,
        ...(normalizedEntry.meaningZh
          ? { meaningZh: normalizedEntry.meaningZh }
          : {})
      };
      const key = abbreviationPairKey(entry.abbreviation, entry.fullName);
      const existing = store.get(key);
      if (!existing) {
        store.set(key, entry);
        return;
      }
      existing.supportCount = Math.min(
        100000,
        existing.supportCount + entry.supportCount
      );
      if (Date.parse(entry.updatedAt) > Date.parse(existing.updatedAt)) {
        existing.updatedAt = entry.updatedAt;
        if (entry.meaningZh) existing.meaningZh = entry.meaningZh;
      } else if (!existing.meaningZh && entry.meaningZh) {
        existing.meaningZh = entry.meaningZh;
      }
    });
    const entries = [...store.values()]
      .sort((left, right) =>
        left.abbreviation.localeCompare(
          right.abbreviation,
          'en',
          { sensitivity: 'base', numeric: true }
        ) ||
        right.supportCount - left.supportCount ||
        left.fullName.localeCompare(right.fullName, 'zh-CN')
      )
      .slice(0, MAX_GLOBAL_ABBREVIATION_ENTRIES);
    return {
      schemaVersion: GLOBAL_ABBREVIATION_SCHEMA_VERSION,
      entries
    };
  }

  function isCandidateAbbreviation(value) {
    const abbreviation = plainScientificText(value);
    if (abbreviation.length < 2 || abbreviation.length > 20 ||
        /\s/.test(abbreviation) ||
        STRUCTURAL_ABBREVIATIONS.has(abbreviation.toLowerCase())) {
      return false;
    }
    if (!/^[A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff+./-]*$/.test(abbreviation)) {
      return false;
    }
    if (/^[A-Za-z][a-z]+\d*-(?:KO|KI|WT|OE)$/i.test(abbreviation)) return false;
    if (/^CD\d[\w.-]*[+-]$/i.test(abbreviation)) return false;
    const uppercaseCount = (abbreviation.match(/[A-Z\u0391-\u03a9]/g) || []).length;
    const hasDigit = /\d/.test(abbreviation);
    const hasCompoundSeparator = /[-/+]/.test(abbreviation);
    return uppercaseCount >= 2 ||
      (uppercaseCount >= 1 && (hasDigit || hasCompoundSeparator));
  }

  function expansionWords(value) {
    return plainScientificText(value)
      .replace(/^[,;:，；：\s]+|[,;:，；：\s]+$/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function expansionInitials(value, omitStops = false) {
    return expansionWords(value)
      .filter(word => !omitStops || !INITIAL_STOP_WORDS.has(word.toLowerCase()))
      .map(word => (word.match(/[A-Za-z\u0370-\u03ff]/) || [''])[0])
      .join('')
      .toLowerCase();
  }

  function isSubsequence(needle, haystack) {
    let cursor = 0;
    for (const character of haystack) {
      if (character === needle[cursor]) cursor += 1;
      if (cursor >= needle.length) return true;
    }
    return false;
  }

  function abbreviationForms(value) {
    const key = abbreviationKey(value);
    if (!key) return [];
    const forms = [key];
    if (key.length > 3 && key.endsWith('s')) forms.push(key.slice(0, -1));
    return forms;
  }

  function alignedAbbreviationForm(abbreviation, expansion) {
    const normalizedFull = plainScientificText(expansion)
      .replace(/[^A-Za-z0-9\u0370-\u03ff]/g, '')
      .toLowerCase();
    const firstFullLetter = (normalizedFull.match(/[A-Za-z\u0370-\u03ff]/) || [''])[0];
    if (!normalizedFull || !firstFullLetter) return '';
    return abbreviationForms(abbreviation).find(form => {
      const firstShortLetter = (form.match(/[A-Za-z\u0370-\u03ff]/) || [''])[0];
      if (!firstShortLetter || firstShortLetter !== firstFullLetter) return false;
      const shortDigits = form.match(/\d/g) || [];
      if (shortDigits.some(digit => !normalizedFull.includes(digit))) return false;
      return isSubsequence(form, normalizedFull);
    }) || '';
  }

  function invalidEnglishExpansion(abbreviation, expansion) {
    const full = plainScientificText(expansion);
    if (/[()[\]{}]/.test(full) || /[;；]/.test(full)) return true;
    if (REAGENT_OR_METADATA.test(full) || DESCRIPTOR_ONLY.test(full)) return true;
    const words = expansionWords(full);
    if (words.length < 2 || words.length > 16) return true;
    const firstWordKey = abbreviationKey(words[0]);
    const shortKey = abbreviationKey(abbreviation);
    return Boolean(firstWordKey && shortKey && (
      firstWordKey === shortKey ||
      (shortKey.length >= 4 && firstWordKey.startsWith(shortKey))
    ));
  }

  function expansionScore(abbreviation, expansion) {
    const short = abbreviationKey(abbreviation);
    const full = plainScientificText(expansion);
    if (!short || !full || full.length < 4 || full.length > 180) return -1;
    if (isCandidateAbbreviation(full) ||
        full.toLowerCase() === plainScientificText(abbreviation).toLowerCase()) {
      return -1;
    }
    if (/[\u3400-\u9fff]/u.test(full)) {
      const chineseLength = (full.match(/[\u3400-\u9fff]/gu) || []).length;
      return chineseLength >= 2 && chineseLength <= 60 ? 12 : -1;
    }
    if (invalidEnglishExpansion(abbreviation, full)) return -1;
    const alignedForm = alignedAbbreviationForm(abbreviation, full);
    if (!alignedForm) return -1;

    const initials = expansionInitials(full, false);
    const compactInitials = expansionInitials(full, true);
    let score = 10;
    if (initials === alignedForm) score += 10;
    if (compactInitials === alignedForm) score += 11;
    if (initials && (
      alignedForm.startsWith(initials) || initials.startsWith(alignedForm)
    )) score += 2;
    return score;
  }

  function cleanExpansion(value) {
    return plainScientificText(value)
      .replace(/^(?:and|or|the|a|an|using|with|whereas|while|called)\s+/i, '')
      .replace(/^(?:我们|本研究|该研究|作者|研究人员)(?:使用|采用|通过|将|把)?/u, '')
      .replace(/^[,;:，；：\s]+|[,;:，；：\s]+$/g, '');
  }

  function bestExpansionSuffix(prefix, abbreviation) {
    const clean = cleanExpansion(prefix);
    const chinese = clean.match(
      /([\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9+\-/\s]{1,59})$/u
    );
    if (chinese) {
      const value = cleanExpansion(chinese[1]);
      if (expansionScore(abbreviation, value) >= 0) {
        return { expansion: value, score: 12 };
      }
    }
    const words = expansionWords(clean);
    let best = null;
    for (let count = 2; count <= Math.min(16, words.length); count += 1) {
      const expansion = cleanExpansion(words.slice(-count).join(' '));
      const score = expansionScore(abbreviation, expansion);
      if (score < 0) continue;
      if (!best || score > best.score ||
          (score === best.score && expansion.length < best.expansion.length)) {
        best = { expansion, score };
      }
    }
    return best;
  }

  function recordCandidate(store, abbreviation, expansion, score, sourceIndex) {
    const short = plainScientificText(abbreviation);
    const full = cleanExpansion(expansion);
    if (!isCandidateAbbreviation(short) || expansionScore(short, full) < 0) return;
    const key = short.toUpperCase();
    const existing = store.get(key);
    const candidate = {
      abbreviation: short,
      fullName: full,
      score: Number(score) || 0,
      count: 1,
      sourceIndex: Math.max(0, Number(sourceIndex) || 0)
    };
    if (!existing) {
      store.set(key, candidate);
      return;
    }
    if (existing.fullName.toLowerCase() === full.toLowerCase()) {
      existing.count += 1;
      if (candidate.score > existing.score) existing.score = candidate.score;
      return;
    }
    if (candidate.score > existing.score ||
        (candidate.score === existing.score && full.length > existing.fullName.length)) {
      store.set(key, { ...candidate, count: existing.count + 1 });
    } else {
      existing.count += 1;
    }
  }

  function extractFromText(store, rawText, sourceIndex) {
    const text = plainScientificText(rawText);
    if (!text) return;

    const forward = /([^.!?。！？;；\n]{4,220}?)\s*[\(（]([A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff+./-]{1,19})[\)）]/g;
    for (const match of text.matchAll(forward)) {
      const abbreviation = match[2];
      if (!isCandidateAbbreviation(abbreviation)) continue;
      const best = bestExpansionSuffix(match[1], abbreviation);
      if (best) {
        recordCandidate(store, abbreviation, best.expansion, best.score + 2, sourceIndex);
      }
    }

    const reverse = /\b([A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff+./-]{1,19})\s*[\(（]([^()（）\n]{4,180})[\)）]/g;
    for (const match of text.matchAll(reverse)) {
      const abbreviation = match[1];
      const expansion = cleanExpansion(match[2]);
      const score = expansionScore(abbreviation, expansion);
      if (score >= 0) {
        recordCandidate(store, abbreviation, expansion, score + 1, sourceIndex);
      }
    }

    const named = /([^.!?。！？;；\n]{4,180}?),?\s+(?:abbreviated as|abbreviated|hereafter|简称为|简称)\s+([A-Za-z\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff+./-]{1,19})\b/gi;
    for (const match of text.matchAll(named)) {
      const abbreviation = match[2];
      const best = bestExpansionSuffix(match[1], abbreviation);
      if (best) {
        recordCandidate(store, abbreviation, best.expansion, best.score + 3, sourceIndex);
      }
    }
  }

  function escapeRegularExpression(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsLiteralAbbreviation(value, abbreviation) {
    const short = plainScientificText(abbreviation);
    if (!short) return false;
    const tokenCharacter = 'A-Za-z0-9\\u0370-\\u03ff';
    const pattern = new RegExp(
      `(^|[^${tokenCharacter}])${escapeRegularExpression(short)}` +
      `(?=$|[^${tokenCharacter}])`
    );
    return pattern.test(plainScientificText(value));
  }

  function locateFirstOccurrence(paragraphs, abbreviation, fallbackIndex) {
    const source = Array.isArray(paragraphs) ? paragraphs : [];
    let sourceIndex = source.findIndex(paragraph =>
      containsLiteralAbbreviation(
        paragraph?.text || paragraph?.displayText || '',
        abbreviation
      )
    );
    if (sourceIndex < 0) {
      const candidateIndex = Math.max(0, Number(fallbackIndex) || 0);
      sourceIndex = candidateIndex < source.length ? candidateIndex : -1;
    }
    const paragraph = sourceIndex >= 0 ? source[sourceIndex] : null;
    return {
      sourceIndex,
      paragraphId: String(paragraph?.paragraphId || ''),
      sourceKey: String(
        paragraph?.sourceKey || paragraph?.paragraphId || paragraph?.sourceIdentity || ''
      ),
      navigationRevision: Math.max(0, Number(paragraph?.navigationRevision) || 0)
    };
  }

  function extractArticleAbbreviations(paragraphs = []) {
    const source = Array.isArray(paragraphs) ? paragraphs : [];
    const store = new Map();
    source.forEach((paragraph, index) => {
      extractFromText(store, paragraph?.text || paragraph?.displayText || '', index);
    });
    return [...store.values()]
      .map(({ score, sourceIndex, ...entry }) => ({
        ...entry,
        ...locateFirstOccurrence(source, entry.abbreviation, sourceIndex)
      }))
      .sort((first, second) => first.abbreviation.localeCompare(
        second.abbreviation,
        'en',
        { sensitivity: 'base', numeric: true }
      ));
  }

  return {
    GLOBAL_ABBREVIATION_MEMORY_KEY,
    GLOBAL_ABBREVIATION_SCHEMA_VERSION,
    abbreviationKey,
    isCandidateAbbreviation,
    expansionScore,
    extractArticleAbbreviations,
    normalizeGlobalAbbreviationMemory
  };
});
