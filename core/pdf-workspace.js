(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PDF_READER_PATH = 'pdf-reader.html';
  const PDF_MINERU_SETTINGS_KEY = 'sciPdfMineruSettingsV1';
  const PDF_MINERU_USAGE_KEY = 'sciPdfMineruUsageV1';
  const PDF_MINERU_AGENT_BASE = 'https://mineru.net/api/v1/agent';
  const PDF_MINERU_PRECISE_BASE = 'https://mineru.net/api/v4';
  const PDF_MINERU_PRIORITY_PAGE_QUOTA = 2000;
  const PDF_MINERU_MAX_FILE_BYTES = 200 * 1024 * 1024;

  function normalizePdfSourceUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function buildLocalPdfWorkspaceUrl(fileName, contentHash) {
    const hash = String(contentHash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return '';
    const leafName = String(fileName || '').normalize('NFKC')
      .split(/[\\/]/u).at(-1) || '';
    const safeName = leafName
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!safeName) return '';
    return `file:///brevess-local-pdf/${hash}/${encodeURIComponent(safeName)}`;
  }

  function withLocalPdfWorkspaceSource(readerUrl, sourceUrl) {
    try {
      const reader = new URL(String(readerUrl || ''));
      const source = new URL(String(sourceUrl || ''));
      if (!/(?:^|\/)pdf-reader\.html$/iu.test(reader.pathname) ||
          source.protocol !== 'file:' || source.host || source.username ||
          source.password || source.search || source.hash ||
          !/^\/brevess-local-pdf\/[a-f0-9]{64}\/[^/]{1,720}$/u.test(source.pathname)) {
        return '';
      }
      reader.searchParams.set('source', source.href);
      return reader.href;
    } catch (_) {
      return '';
    }
  }

  function isPdfReaderUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /(?:^|\/)pdf-reader\.html$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function isLikelyPdfUrl(value, title = '') {
    const source = normalizePdfSourceUrl(value);
    if (!source || isPdfReaderUrl(source)) return false;
    try {
      const url = new URL(source);
      const path = decodeURIComponent(url.pathname || '');
      if (/\.pdf$/i.test(path)) return true;
      if (/(?:^|\/)pdf(?:\/|$)/i.test(path)) return true;
      const candidates = [
        url.searchParams.get('file'),
        url.searchParams.get('url'),
        url.searchParams.get('download')
      ].filter(Boolean);
      if (candidates.some(candidate => /\.pdf(?:$|[?#])/i.test(candidate))) return true;
      if (['format', 'type', 'output'].some(key =>
        /^pdf$/i.test(String(url.searchParams.get(key) || '').trim()))) return true;
    } catch (_) {
      return false;
    }
    return /\.pdf(?:\s*[-–—|]\s*.+)?$/i.test(String(title || '').trim());
  }

  function createPdfReaderUrl(runtimeGetUrl, sourceUrl, title = '') {
    const source = normalizePdfSourceUrl(sourceUrl);
    if (!source || typeof runtimeGetUrl !== 'function') return '';
    const url = new URL(runtimeGetUrl(PDF_READER_PATH));
    url.searchParams.set('source', source);
    const normalizedTitle = String(title || '').normalize('NFKC').trim().slice(0, 500);
    if (normalizedTitle) url.searchParams.set('title', normalizedTitle);
    return url.href;
  }

  function normalizeMineruPdfSettings(value = {}) {
    const mode = value.mode === 'precise' ? 'precise' : 'agent';
    const language = /^[a-z_]{2,24}$/i.test(String(value.language || ''))
      ? String(value.language) : 'ch';
    return {
      mode,
      token: String(value.token || '').trim().slice(0, 4096),
      quotaUserId: String(value.quotaUserId || '').trim().slice(0, 256),
      language,
      isOcr: value.isOcr === true,
      enableTable: value.enableTable !== false,
      enableFormula: value.enableFormula !== false
    };
  }

  function planOriginalPdfTextEnhancement(settings, nativeSnapshot = {}) {
    const normalized = normalizeMineruPdfSettings(settings);
    const snapshot = nativeSnapshot && typeof nativeSnapshot === 'object'
      ? nativeSnapshot : {};
    const structure = snapshot.structure && typeof snapshot.structure === 'object'
      ? snapshot.structure : {};
    const phase = String(snapshot.phase || '').trim();
    const coverage = structure?.diagnostics?.textCoverage &&
      typeof structure.diagnostics.textCoverage === 'object'
      ? structure.diagnostics.textCoverage
      : snapshot.textCoverage && typeof snapshot.textCoverage === 'object'
        ? snapshot.textCoverage : null;
    const coverageSignals = [];
    if (typeof coverage?.terminal === 'boolean') coverageSignals.push(coverage.terminal);
    if (typeof coverage?.checkedComplete === 'boolean') {
      coverageSignals.push(coverage.checkedComplete);
    }
    if (coverage?.pendingPages !== undefined && coverage?.pendingPages !== null &&
        Number.isFinite(Number(coverage.pendingPages))) {
      coverageSignals.push(Number(coverage.pendingPages) === 0);
    }
    const nativeIndexComplete = coverageSignals.length
      ? coverageSignals.every(Boolean)
      : phase === 'text-ready' || phase === 'partial-index';
    const metadataCandidates = [snapshot.pageMetadata, snapshot.pages, structure.pages];
    const metadata = metadataCandidates.find(value => Array.isArray(value) && value.length) ||
      metadataCandidates.find(Array.isArray) || [];
    const pageCount = Math.max(0, Math.floor(
      Number(snapshot.pageCount) ||
      Number(structure?.diagnostics?.textCoverage?.totalPages) ||
      metadata.length
    ));
    const lowTextPageNumbers = [...new Set(metadata.flatMap((page, index) => {
      if (page?.textStatus === 'failed' ||
          (page?.textStatus === 'empty' && page?.ocrCandidate === false)) return [];
      const rawCharCount = page?.charCount;
      const charCount = rawCharCount === null || rawCharCount === ''
        ? Number.NaN : Number(rawCharCount);
      if (!Number.isFinite(charCount) || charCount < 0 || charCount >= 30) return [];
      const pageNumber = Math.floor(Number(page?.pageNumber) || index + 1);
      return pageNumber >= 1 && (!pageCount || pageNumber <= pageCount) ? [pageNumber] : [];
    }))].sort((left, right) => left - right);
    const paragraphs = Array.isArray(structure.paragraphs)
      ? structure.paragraphs : (Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : null);
    const diagnosticParagraphCount = structure?.diagnostics?.paragraphCount ??
      snapshot?.diagnostics?.paragraphCount;
    const paragraphCountKnown = Boolean(paragraphs) ||
      (diagnosticParagraphCount !== null && diagnosticParagraphCount !== '' &&
        Number.isFinite(Number(diagnosticParagraphCount)) && Number(diagnosticParagraphCount) >= 0);
    const paragraphCount = paragraphs ? paragraphs.length
      : paragraphCountKnown ? Math.floor(Number(diagnosticParagraphCount)) : 0;
    const explicitlyBlank = metadata.length > 0 && metadata.every(page =>
      page?.textStatus === 'empty' && page?.ocrCandidate === false);
    const emptyNativeIndex = pageCount > 0 && paragraphCountKnown && paragraphCount === 0 &&
      !explicitlyBlank;
    const requiresCoordinateOcr = nativeIndexComplete &&
      (lowTextPageNumbers.length > 0 || emptyNativeIndex);
    const effectiveSettings = requiresCoordinateOcr
      ? { ...normalized, mode: 'precise', isOcr: true }
      : { ...normalized };
    const blocked = requiresCoordinateOcr && !effectiveSettings.token;
    return {
      effectiveSettings,
      nativeIndexComplete,
      requiresCoordinateOcr,
      preserveOriginalPdf: true,
      lowTextPageNumbers,
      reason: !nativeIndexComplete
        ? 'native-index-incomplete'
        : requiresCoordinateOcr
          ? (lowTextPageNumbers.length ? 'low-text-pages' : 'empty-native-index')
          : 'native-text-sufficient',
      blocked,
      blockCode: blocked ? 'PDF_OCR_PRECISE_TOKEN_REQUIRED' : ''
    };
  }

  function hasPdfByteSignature(value) {
    let bytes = value;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    if (!bytes || typeof bytes.length !== 'number' || bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2d;
  }

  function mineruUsageDay(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeMineruUsageLedger(value = {}, day = mineruUsageDay()) {
    const normalizedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))
      ? String(day) : mineruUsageDay();
    if (String(value?.day || '') !== normalizedDay) {
      return { day: normalizedDay, pagesUsed: 0, taskIds: [] };
    }
    const taskIds = [...new Set((Array.isArray(value?.taskIds) ? value.taskIds : [])
      .map(item => String(item || '').trim().slice(0, 160))
      .filter(Boolean))].slice(-500);
    return {
      day: normalizedDay,
      pagesUsed: Math.max(0, Math.floor(Number(value?.pagesUsed) || 0)),
      taskIds
    };
  }

  function recordMineruUsage(value, input = {}) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(input.day || ''))
      ? String(input.day) : mineruUsageDay();
    const ledger = normalizeMineruUsageLedger(value, day);
    const taskId = String(input.taskId || '').trim().slice(0, 160);
    const pages = Math.max(0, Math.floor(Number(input.pages) || 0));
    if (!taskId || !pages || ledger.taskIds.includes(taskId)) return ledger;
    return {
      day: ledger.day,
      pagesUsed: ledger.pagesUsed + pages,
      taskIds: [...ledger.taskIds, taskId].slice(-500)
    };
  }

  function normalizeMineruQuotaData(value) {
    const source = value?.data && typeof value.data === 'object' ? value.data : value;
    if (!source || typeof source !== 'object') return null;
    const user = Number(source.user_left_quota);
    const total = Number(source.total_left_quota);
    const userLeftQuota = Number.isFinite(user) ? Math.max(0, Math.floor(user)) : null;
    const totalLeftQuota = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null;
    if (userLeftQuota === null && totalLeftQuota === null) return null;
    return { userLeftQuota, totalLeftQuota };
  }

  const SCIENCE_SYMBOLS = Object.freeze({
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
    mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
    Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', pm: '±', mp: '∓', leq: '≤', geq: '≥', neq: '≠',
    approx: '≈', sim: '∼', degree: '°', infty: '∞', rightarrow: '→',
    leftarrow: '←', leftrightarrow: '↔'
  });
  const SUPERSCRIPT = Object.freeze({
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
    n: 'ⁿ', i: 'ⁱ'
  });
  const SUBSCRIPT = Object.freeze({
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎'
  });

  function scriptCharacters(value, table, prefix) {
    const source = String(value || '').replace(/\s+/g, '');
    if (!source || [...source].some(character => !table[character])) {
      if (!source) return '';
      return prefix === '^' ? `<sup>${source}</sup>` : `<sub>${source}</sub>`;
    }
    return [...source].map(character => table[character]).join('');
  }

  function scientificFormatGroup(_match, content) {
    const source = String(content || '').trim();
    const atoms = source.split(/\s+/).filter(Boolean);
    return atoms.length >= 2 && atoms.every(atom => atom.length === 1)
      ? atoms.join('') : source;
  }

  function scientificAccent(_match, letter, accent) {
    const marks = { '`': '\u0300', "'": '\u0301', '^': '\u0302', '"': '\u0308', '~': '\u0303' };
    return `${letter}${marks[accent] || ''}`.normalize('NFC');
  }

  function normalizeScientificInline(value) {
    return String(value || '').normalize('NFC')
      .replace(/\\(?:mathrm|mathsf|mathbf|mathtt|mathit|mathcal|textrm|textbf|textit|operatorname|text)\s*\{([^{}]*)\}/g, scientificFormatGroup)
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1\u2044$2')
      .replace(/\\(?:bar|overline)\s*\{?([A-Za-z0-9])\}?/g, '$1\u0304')
      .replace(/\\hat\s*\{?([A-Za-z0-9])\}?/g, '$1\u0302')
      .replace(/\\tilde\s*\{?([A-Za-z0-9])\}?/g, '$1\u0303')
      .replace(/\\dot\s*\{?([A-Za-z0-9])\}?/g, '$1\u0307')
      .replace(/\\vec\s*\{?([A-Za-z0-9])\}?/g, '$1\u20d7')
      .replace(/\\(?:left|right|middle)\b/g, '')
      .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b/g, '\u00b0')
      .replace(/\\([A-Za-z]+)\b/g, (match, name) => SCIENCE_SYMBOLS[name] || match)
      .replace(/\^\s*\{([^{}]{1,12})\}/g, (_, content) =>
        scriptCharacters(content, SUPERSCRIPT, '^'))
      .replace(/_\s*\{([^{}]{1,12})\}/g, (_, content) =>
        scriptCharacters(content, SUBSCRIPT, '_'))
      .replace(/\^([+\-−0-9])/g, (_, content) =>
        scriptCharacters(content, SUPERSCRIPT, '^'))
      .replace(/_([+\-−0-9])/g, (_, content) =>
        scriptCharacters(content, SUBSCRIPT, '_'))
      .replace(/\^(?:\\circ|°)/g, '°')
      .replace(/\\[,;:!]/g, ' ')
      .replace(/\\(?:quad|qquad)\b/g, ' ')
      .replace(/\\(?:mathrm|mathsf|mathbf|mathtt|mathit|mathcal|textrm|textbf|textit|operatorname|text)\b/g, '')
      .replace(/\\(?:sin|cos|tan|log|ln|exp|min|max)\b/g, match => match.slice(1))
      .replace(/\\cdot\b/g, '\u00b7')
      .replace(/\\%/g, '%')
      // OCR commonly moves a TeX accent after the accented letter when a
      // word is split (for example Page\\` s), while intact names keep the
      // normal prefix form (Bi\\`eche). Restore both without exposing TeX.
      .replace(/([A-Za-z])\\([`'\^"~])\s+(?=[A-Za-z])/g,
        (_match, letter, accent) => scientificAccent(_match, letter, accent))
      .replace(/\\([`'\^"~])\s*([A-Za-z])/g,
        (_match, accent, letter) => scientificAccent(_match, letter, accent))
      .replace(/\\([_$&#%{}])/g, '$1')
      .replace(/\$([^$\n]+)\$/g, '$1')
      .replace(/\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:mathrm|mathsf|mathbf|mathtt|mathit|mathcal|textrm|textbf|textit|operatorname|text)\s*\{([^{}]*)\}/g, scientificFormatGroup)
      .replace(/\{([^{}]*)\}/g, '$1')
      .replace(/Figure360(?=\b|>)/gi, 'Figure 360')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodePdfHtmlEntities(value) {
    const named = Object.freeze({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
    });
    return String(value || '').replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
      (match, entity) => {
        if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
        const hexadecimal = entity[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point) : match;
      });
  }

  const LEGACY_TEX_RUN = /\\(?:bar|overline)\s*\{\s*([^{}\n]{1,120}?)\s*\}|\{\\tt\s+([^{}^_\n]{1,120})\}|\^\s*\{\s*(?:\\tt\s+)?([^{}\n]{1,40}?)\s*\}|_\s*\{\s*([^{}\n]{1,40}?)\s*\}/y;
  const PDF_INLINE_HTML_SCRIPT = /<(sup|sub)\b[^>]{0,120}>([^<\n]{1,120})<\/\1\s*>/iy;
  const PDF_INLINE_CODE = /`([^`\n]{1,240})`/y;
  const PDF_INLINE_LINK = /\[([^\]\n]{1,240})\]\(([^)\s]{1,2048})(?:\s+["'][^"'\n]{0,240}["'])?\)/y;
  const PDF_INLINE_TAG = /<[^>\n]{0,240}>/y;
  const PDF_ALLOWED_TEX_COMMAND = /\\(frac|mathbf|mathrm|mathsf|mathtt|mathit|mathcal|textrm|textbf|textit|operatorname|text|hat|circ)\b/y;

  function matchPdfInlineAt(pattern, source, cursor) {
    pattern.lastIndex = cursor;
    return pattern.exec(source);
  }

  function pushPdfInlineToken(tokens, type, text, extra = {}) {
    const decoded = decodePdfHtmlEntities(String(text || ''));
    if (!decoded) return;
    const previous = tokens.at(-1);
    if (type === 'text' && previous?.type === 'text') {
      previous.text += decoded;
      return;
    }
    tokens.push({ type, text: decoded, ...extra });
  }

  function safePdfInlineHref(value) {
    const href = String(value || '');
    try {
      const parsed = new URL(href, 'https://brevess.invalid/');
      return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? href : '';
    } catch (_) {
      return '';
    }
  }

  function legacyScientificToken(match) {
    if (match[1] !== undefined) return { type: 'overline', text: match[1] };
    if (match[2] !== undefined) return { type: 'text', text: scientificFormatGroup('', match[2]) };
    if (match[3] !== undefined) return { type: 'sup', text: match[3] };
    return { type: 'sub', text: match[4] };
  }

  function readPdfMarkdownSpan(source, cursor) {
    const marker = source[cursor];
    if (marker !== '*' && marker !== '_') return null;
    const doubled = source[cursor + 1] === marker;
    const delimiter = doubled ? marker.repeat(2) : marker;
    const contentStart = cursor + delimiter.length;
    const limit = Math.min(source.length, contentStart + 240 + delimiter.length);
    let search = contentStart;
    while (search < limit) {
      if (source[search] === '\\') {
        search += 2;
        continue;
      }
      if (!doubled && source.startsWith(marker.repeat(2), search)) {
        const nestedEnd = source.indexOf(marker.repeat(2), search + 2);
        if (nestedEnd < 0 || nestedEnd + 2 > limit) return null;
        search = nestedEnd + 2;
        continue;
      }
      if (source.startsWith(delimiter, search)) {
        const content = source.slice(contentStart, search);
        if (!content || content.includes('\n')) return null;
        return {
          type: doubled ? 'strong' : 'em',
          content,
          length: search + delimiter.length - cursor
        };
      }
      search += 1;
    }
    return null;
  }

  function readPdfLegacyFallback(source, cursor) {
    const prefixes = [
      ['\\overline{', 10], ['\\bar{', 5], ['{\\tt ', 5],
      ['^{', 2], ['_{', 2]
    ];
    const prefix = prefixes.find(([value]) => source.startsWith(value, cursor));
    if (!prefix) return null;
    const payloadStart = cursor + prefix[1];
    const newline = source.indexOf('\n', payloadStart);
    const semicolon = source.indexOf(';', payloadStart);
    const boundedEnd = Math.min(source.length, payloadStart + 4096);
    const closing = source.indexOf('}', payloadStart);
    const hasBoundedClosing = closing >= 0 && closing < boundedEnd &&
      (newline < 0 || closing < newline) &&
      (semicolon < 0 || closing < semicolon);
    return {
      payload: hasBoundedClosing ? source.slice(payloadStart, closing) : '',
      length: hasBoundedClosing ? closing + 1 - cursor : prefix[1]
    };
  }

  function readBoundedTexGroup(source, cursor, options = {}) {
    if (source[cursor] !== '{') return null;
    const maxLength = Math.max(1, Math.min(512, Number(options.maxLength) || 120));
    const maxDepth = Math.max(1, Math.min(4, Number(options.maxDepth) || 2));
    let depth = 0;
    const limit = Math.min(source.length, cursor + maxLength + 2);
    for (let index = cursor; index < limit; index += 1) {
      if (source[index] === '\n') return null;
      if (source[index] === '{') {
        depth += 1;
        if (depth > maxDepth) return null;
      } else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          return {
            content: source.slice(cursor + 1, index),
            length: index + 1 - cursor
          };
        }
      }
    }
    return null;
  }

  function readAllowedTexCommand(source, cursor) {
    const commandMatch = matchPdfInlineAt(PDF_ALLOWED_TEX_COMMAND, source, cursor);
    if (!commandMatch) return null;
    const command = commandMatch[1];
    if (command === 'circ') {
      return { type: 'text', text: '°', length: commandMatch[0].length };
    }
    let groupCursor = cursor + commandMatch[0].length;
    while (source[groupCursor] === ' ' && groupCursor - cursor < 8) groupCursor += 1;
    const first = readBoundedTexGroup(source, groupCursor, {
      maxLength: command === 'frac' ? 80 : 120,
      maxDepth: 2
    });
    if (!first) return null;
    const firstTokens = markdownInlineTokens(first.content);
    const firstText = firstTokens.map(token => token.text).join('');
    if (command === 'frac') {
      let secondCursor = groupCursor + first.length;
      while (source[secondCursor] === ' ' && secondCursor - groupCursor < 8) secondCursor += 1;
      const second = readBoundedTexGroup(source, secondCursor, {
        maxLength: 80,
        maxDepth: 2
      });
      if (!second) return null;
      const secondText = markdownInlineTokens(second.content)
        .map(token => token.text).join('');
      return {
        type: 'text',
        text: `${firstText}/${secondText}`,
        length: secondCursor + second.length - cursor
      };
    }
    const type = ['mathbf', 'textbf'].includes(command) ? 'strong'
      : ['mathit', 'textit'].includes(command) ? 'em' : 'text';
    const text = command === 'hat' ? `${firstText}\u0302`.normalize('NFC') : firstText;
    const transparent = ['mathrm', 'mathsf', 'mathtt', 'mathcal', 'textrm',
      'operatorname', 'text'].includes(command);
    return {
      type,
      text,
      ...(transparent ? { tokens: firstTokens } : {}),
      length: groupCursor + first.length - cursor
    };
  }

  function unwrapTexFallbackGroup(value) {
    const source = String(value || '').trimStart();
    if (!source.startsWith('{')) return { payload: source, rest: '' };
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          return {
            payload: source.slice(1, index),
            rest: source.slice(index + 1)
          };
        }
      }
    }
    return { payload: source.slice(1), rest: '' };
  }

  function readAllowedTexFallback(source, cursor) {
    const commandMatch = matchPdfInlineAt(PDF_ALLOWED_TEX_COMMAND, source, cursor);
    if (!commandMatch) return null;
    const payloadStart = cursor + commandMatch[0].length;
    const semicolon = source.indexOf(';', payloadStart);
    const newline = source.indexOf('\n', payloadStart);
    const boundary = [semicolon, newline, source.length, payloadStart + 4096]
      .filter(index => index >= payloadStart)
      .reduce((minimum, index) => Math.min(minimum, index), source.length);
    const segment = source.slice(payloadStart, boundary);
    const first = unwrapTexFallbackGroup(segment);
    let text = first.payload;
    if (commandMatch[1] === 'frac') {
      const second = unwrapTexFallbackGroup(first.rest);
      text = `${first.payload}/${second.payload}`;
    }
    return {
      type: 'text',
      text,
      length: boundary - cursor
    };
  }

  function findPdfDollarClose(source, cursor) {
    const limit = Math.min(source.length, cursor + 242);
    for (let index = cursor + 1; index < limit; index += 1) {
      if (source[index] === '\n') return -1;
      if (source[index] === '\\') {
        index += 1;
        continue;
      }
      if (source[index] === '$') return index;
    }
    return -1;
  }

  function looksLikeScientificMathRun(value) {
    const source = String(value || '').trim();
    if (!source || source.length > 240) return false;
    return /^(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+$/.test(source) ||
      /\\[A-Za-z]+|\^\s*(?:\{|[+\-−0-9])|_\s*(?:\{|[+\-−0-9])|[≤≥≈±×]|(?:^|\s)[A-Za-z]\s*[<=>]\s*[+\-−]?\d/.test(source);
  }

  function markdownInlineTokens(value) {
    const source = String(value || '').normalize('NFC');
    const tokens = [];
    let plain = '';
    let cursor = 0;
    const flushPlain = () => {
      pushPdfInlineToken(tokens, 'text', plain);
      plain = '';
    };
    const consume = (match, token) => {
      flushPlain();
      if (token) pushPdfInlineToken(tokens, token.type, token.text, token.extra);
      cursor += match[0].length;
    };

    while (cursor < source.length) {
      let match = matchPdfInlineAt(/\\([`'\^"~])\s+(?=[A-Za-z])/y, source, cursor);
      if (match && /[A-Za-z]$/.test(plain)) {
        const letter = plain.at(-1);
        plain = plain.slice(0, -1) + scientificAccent('', letter, match[1]);
        cursor += match[0].length;
        continue;
      }
      match = matchPdfInlineAt(/\\([`'\^"~])([A-Za-z])/y, source, cursor);
      if (match && /[A-Za-z]$/.test(plain)) {
        plain += scientificAccent('', match[2], match[1]);
        cursor += match[0].length;
        continue;
      }
      const escaped = source[cursor] === '\\' &&
        /[\\`*_{}\[\]()#+.!$-]/.test(source[cursor + 1] || '');
      if (escaped) {
        plain += source[cursor + 1];
        cursor += 2;
        continue;
      }
      match = matchPdfInlineAt(PDF_INLINE_HTML_SCRIPT, source, cursor);
      if (match) {
        consume(match, { type: match[1].toLowerCase(), text: match[2] });
        continue;
      }
      match = matchPdfInlineAt(/\^\{\s*\\circ\s*\}/y, source, cursor);
      if (match) {
        consume(match, { type: 'text', text: '°' });
        continue;
      }
      match = matchPdfInlineAt(LEGACY_TEX_RUN, source, cursor);
      if (match) {
        consume(match, legacyScientificToken(match));
        continue;
      }
      const legacyFallback = readPdfLegacyFallback(source, cursor);
      if (legacyFallback) {
        flushPlain();
        if (legacyFallback.payload) {
          pushPdfInlineToken(tokens, 'text', legacyFallback.payload.replace(/\\tt\s*/g, ''));
        }
        cursor += legacyFallback.length;
        continue;
      }
      const allowedCommand = readAllowedTexCommand(source, cursor);
      if (allowedCommand) {
        flushPlain();
        if (Array.isArray(allowedCommand.tokens)) {
          allowedCommand.tokens.forEach(token =>
            pushPdfInlineToken(tokens, token.type, token.text,
              token.href ? { href: token.href } : {})
          );
        } else {
          pushPdfInlineToken(tokens, allowedCommand.type, allowedCommand.text);
        }
        cursor += allowedCommand.length;
        continue;
      }
      const allowedFallback = readAllowedTexFallback(source, cursor);
      if (allowedFallback) {
        flushPlain();
        pushPdfInlineToken(tokens, 'text', allowedFallback.text);
        cursor += allowedFallback.length;
        continue;
      }
      match = matchPdfInlineAt(PDF_INLINE_CODE, source, cursor);
      if (match) {
        consume(match, { type: 'code', text: match[1] });
        continue;
      }
      const markdownSpan = readPdfMarkdownSpan(source, cursor);
      if (markdownSpan) {
        flushPlain();
        const content = markdownInlineTokens(markdownSpan.content)
          .map(token => token.text).join('');
        pushPdfInlineToken(tokens, markdownSpan.type, content);
        cursor += markdownSpan.length;
        continue;
      }
      match = matchPdfInlineAt(PDF_INLINE_LINK, source, cursor);
      if (match) {
        const href = safePdfInlineHref(match[2]);
        consume(match, href
          ? { type: 'link', text: match[1], extra: { href } }
          : { type: 'text', text: match[1] });
        continue;
      }
      match = matchPdfInlineAt(/\^([+\-−0-9])/y, source, cursor);
      if (match) {
        consume(match, { type: 'sup', text: match[1] });
        continue;
      }
      match = matchPdfInlineAt(/_([+\-−0-9])/y, source, cursor);
      if (match) {
        consume(match, { type: 'sub', text: match[1] });
        continue;
      }
      match = matchPdfInlineAt(/<\/?(?:sup|sub)\b[^>\n]{0,120}>/iy, source, cursor);
      if (match) {
        consume(match, null);
        continue;
      }
      match = matchPdfInlineAt(PDF_INLINE_TAG, source, cursor);
      if (match) {
        consume(match, { type: 'text', text: ' ' });
        continue;
      }
      match = matchPdfInlineAt(/\\tt(?=\s|[A-Z0-9])/y, source, cursor);
      if (match) {
        consume(match, null);
        continue;
      }
      match = matchPdfInlineAt(/\\(?:bar|overline)(?=\s|[A-Z0-9]|$)/y, source, cursor);
      if (match) {
        consume(match, null);
        continue;
      }
      if (source[cursor] === '$') {
        const closing = findPdfDollarClose(source, cursor);
        const content = closing >= 0 ? source.slice(cursor + 1, closing) : '';
        if (closing >= 0 && looksLikeScientificMathRun(content)) {
          flushPlain();
          markdownInlineTokens(content).forEach(token =>
            pushPdfInlineToken(tokens, token.type, token.text,
              token.href ? { href: token.href } : {}));
          cursor = closing + 1;
        } else {
          plain += '$';
          cursor += 1;
        }
        continue;
      }
      match = matchPdfInlineAt(/\\([A-Za-z]+)\b/y, source, cursor);
      if (match && SCIENCE_SYMBOLS[match[1]]) {
        consume(match, { type: 'text', text: SCIENCE_SYMBOLS[match[1]] });
        continue;
      }
      plain += source[cursor];
      cursor += 1;
    }
    flushPlain();
    return tokens.filter(token => token.text);
  }

  function cleanMarkdownInline(value) {
    return decodePdfHtmlEntities(normalizeScientificInline(value))
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\\([#*_`[\]()])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseMarkdownImage(line) {
    const source = String(line || '').trim();
    const markdown = source.match(
      /^!\[([^\]]*)\]\(\s*<?([^>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)$/
    );
    if (markdown) {
      return {
        alt: cleanMarkdownInline(markdown[1]),
        source: String(markdown[2] || '').trim()
      };
    }
    const html = source.match(
      /^<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*?(?:\balt=["']([^"']*)["'])?[^>]*\/?>$/i
    );
    if (!html) return null;
    return {
      alt: cleanMarkdownInline(html[2]),
      source: String(html[1] || '').trim()
    };
  }

  function markdownToPdfBlocks(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n')
      .replace(/<table\b[\s\S]*?<\/table>/gi,
        tableHtml => `\n${tableHtml.replace(/\s*\n\s*/g, ' ')}\n`)
      .split('\n');
    const blocks = [];
    let paragraph = [];
    let code = [];
    let list = [];
    let listOrdered = false;
    let table = null;
    let inFence = false;

    function flushParagraph() {
      const markdownText = paragraph.join(' ');
      const text = cleanMarkdownInline(markdownText);
      paragraph = [];
      if (text) {
        const block = { type: 'paragraph', text };
        if (markdownText !== text) block.markdown = markdownText;
        blocks.push(block);
      }
    }

    function flushList() {
      if (!list.length) return;
      blocks.push({
        type: 'list',
        ordered: listOrdered,
        items: list.map(item => {
          const source = typeof item === 'string' ? item : item.text;
          const text = cleanMarkdownInline(source);
          return {
            text,
            ...(text !== source ? { markdown: source } : {}),
            ...(Number(item?.depth) > 0 ? { depth: Number(item.depth) } : {}),
            ...(Number.isSafeInteger(item?.ordinal) && item.ordinal > 0
              ? { ordinal: item.ordinal }
              : {})
          };
        }).filter(item => item.text)
      });
      list = [];
      listOrdered = false;
    }

    function tableCells(line) {
      return String(line || '').trim().replace(/^\||\|$/g, '')
        .split('|').map(cell => cell.trim());
    }

    function flushTable() {
      if (!table) return;
      blocks.push({ type: 'table', header: table.header, rows: table.rows });
      table = null;
    }

    function flushCode() {
      const text = code.join('\n').trim();
      code = [];
      if (text) blocks.push({ type: 'code', text });
    }

    function parseHtmlTable(line) {
      const source = String(line || '').trim();
      if (!/^<table\b[\s\S]*<\/table>$/i.test(source)) return null;
      const rows = [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(row => {
          const cells = [...row[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
            .map(cell => ({ kind: cell[1].toLowerCase(), text: cleanMarkdownInline(cell[2]) }))
            .filter(cell => cell.text);
          return cells;
        }).filter(row => row.length);
      if (!rows.length) return null;
      const firstIsHeader = rows[0].some(cell => cell.kind === 'h');
      return {
        type: 'table',
        header: firstIsHeader ? rows[0].map(cell => cell.text) : [],
        rows: (firstIsHeader ? rows.slice(1) : rows).map(row => row.map(cell => cell.text))
      };
    }

    lines.forEach(rawLine => {
      const line = String(rawLine || '');
      if (/^\s*```/.test(line)) {
        if (inFence) flushCode();
        else {
          flushParagraph();
          flushList();
        }
        inFence = !inFence;
        return;
      }
      if (inFence) {
        code.push(line);
        return;
      }
      const htmlTable = parseHtmlTable(line);
      if (htmlTable) {
        flushParagraph();
        flushList();
        flushTable();
        blocks.push(htmlTable);
        return;
      }
      if (table) {
        if (line.trim() && line.includes('|')) {
          table.rows.push(tableCells(line));
          return;
        }
        flushTable();
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph();
        flushList();
        const text = cleanMarkdownInline(heading[2]);
        if (text) {
          const block = {
            type: 'heading',
            level: Math.min(6, Math.max(1, heading[1].length)),
            text
          };
          if (heading[2] !== text) block.markdown = heading[2];
          blocks.push(block);
        }
        return;
      }
      const image = parseMarkdownImage(line);
      if (image) {
        flushParagraph();
        flushList();
        if (image.source) blocks.push({ type: 'image', ...image });
        return;
      }
      if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'divider' });
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        flushTable();
        return;
      }
      const tableSeparator = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
      if (tableSeparator) {
        if (paragraph.length === 1 && paragraph[0].includes('|')) {
          table = { header: tableCells(paragraph[0]), rows: [] };
          paragraph = [];
        }
        return;
      }
      const listItem = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
      if (listItem) {
        flushParagraph();
        const ordered = /^\d/.test(listItem[2]);
        if (list.length && ordered !== listOrdered) flushList();
        listOrdered = ordered;
        const indentation = String(listItem[1] || '').replace(/\t/g, '  ').length;
        const orderedMarker = /^([0-9]{1,6})[.)]$/.exec(listItem[2]);
        const ordinal = orderedMarker ? Number(orderedMarker[1]) : null;
        list.push({
          text: listItem[3].trim(),
          depth: Math.floor(indentation / 2),
          ...(Number.isSafeInteger(ordinal) && ordinal > 0 ? { ordinal } : {})
        });
        return;
      }
      flushList();
      const quote = line.match(/^\s*>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        const text = cleanMarkdownInline(quote[1]);
        if (text) blocks.push({ type: 'blockquote', text, markdown: quote[1] });
        return;
      }
      paragraph.push(line.trim());
    });
    flushParagraph();
    flushList();
    flushTable();
    if (inFence) flushCode();
    return blocks.map((block, index) => ({
      ...block,
      id: `pdf-block-${index + 1}`
    }));
  }

  function renderPdfListBlock(documentRef, block, appendInline) {
    const list = documentRef.createElement(block?.ordered ? 'ol' : 'ul');
    (block?.items || []).forEach(item => {
      const listItem = documentRef.createElement('li');
      if (block.ordered && Number.isSafeInteger(item?.ordinal) && item.ordinal > 0) {
        listItem.value = item.ordinal;
      }
      if (typeof appendInline === 'function') {
        appendInline(listItem, item?.markdown || item?.text || '');
      } else {
        listItem.textContent = String(item?.text || '');
      }
      list.appendChild(listItem);
    });
    return list;
  }

  function isPdfFigureCaptionText(value) {
    return /^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?fig(?:ure)?\.?\s*[s]?\d+/i
      .test(String(value || '').normalize('NFKC').trim());
  }

  function isPdfTableCaptionText(value) {
    return /^(?:(?:supplement(?:ary|al)?|extended\s+data)\s+)?table\.?\s*[s]?\d+/i
      .test(String(value || '').normalize('NFKC').trim());
  }

  function isPdfNonOutlineCaptionText(value) {
    return isPdfFigureCaptionText(value) || isPdfTableCaptionText(value);
  }

  function associatePdfFigureCaptions(blocks, options = {}) {
    const input = Array.isArray(blocks) ? blocks : [];
    const maxDistance = Math.max(1, Math.min(
      40,
      Number(options.maxDistance) || 16
    ));
    const imageIndices = [];
    const captions = [];
    input.forEach((block, index) => {
      if (block?.type === 'image') imageIndices.push(index);
      // MinerU emits Figure titles inconsistently: regular papers often use a
      // paragraph, while supplemental PDFs commonly promote every Figure Sx
      // title to a Markdown heading. Both forms describe the same semantic
      // caption and must participate in image pairing.
      if ((block?.type === 'paragraph' || block?.type === 'heading') &&
          isPdfFigureCaptionText(block.text)) {
        captions.push({ index, text: String(block.text || '').trim() });
      }
    });
    const assignedImages = new Set();
    const pairs = [];

    // MinerU may place a multi-column caption several blocks before or after
    // its image. When the counts align, document order is the strongest cue.
    if (imageIndices.length === captions.length) {
      captions.forEach((caption, ordinal) => {
        const imageIndex = imageIndices[ordinal];
        assignedImages.add(imageIndex);
        pairs.push({ imageIndex, captionIndex: caption.index, caption: caption.text });
      });
    }

    captions.forEach(caption => {
      if (pairs.some(pair => pair.captionIndex === caption.index)) return;
      const candidate = imageIndices
        .filter(index =>
          !assignedImages.has(index) &&
          Math.abs(index - caption.index) <= maxDistance
        )
        .sort((left, right) => {
          const distance = Math.abs(left - caption.index) -
            Math.abs(right - caption.index);
          if (distance) return distance;
          // A caption immediately following an image is the common case.
          const leftPenalty = left <= caption.index ? 0 : 1;
          const rightPenalty = right <= caption.index ? 0 : 1;
          return leftPenalty - rightPenalty || left - right;
        })[0];
      if (!Number.isInteger(candidate)) return;
      assignedImages.add(candidate);
      pairs.push({
        imageIndex: candidate,
        captionIndex: caption.index,
        caption: caption.text
      });
    });
    return pairs.sort((left, right) => left.imageIndex - right.imageIndex);
  }

  function isExplicitPanelLegendText(value) {
    const text = String(value || '').normalize('NFKC').trim();
    return /^\((?:[A-Z](?:\s*[-‐-―−]\s*[A-Z])?(?:(?:\s*[,;&]\s*|\s+(?:and|or|to)\s+)[A-Z](?:\s*[-‐-―−]\s*[A-Z])?)*)\)\s*/i
      .test(text);
  }

  const PDF_CAPTION_CONTINUATION_PATTERNS = Object.freeze([
    /^(?:[*†‡§]\s*)?p\s*[<=>≤≥]/i,
    /^n\s*=/i,
    /^scale bars?\b/i,
    /^p[ -]?values?\b/i,
    /^values?\s+(?:(?:are|were)\s+)?(?:(?:presented|shown|expressed|reported)\s+as\s+)?(?:mean|median)\b/i,
    /^error bars?\s+(?:show|shown|indicate|represent|denote)(?:ed|s)?\s+(?:the\s+)?(?:s\.?(?:e\.?)?m\.?|s\.?(?:d\.?)?|standard (?:error|deviation)|confidence intervals?|interquartile range)\b/i,
    /^data (?:are|were)\s+(?:(?:presented|shown|expressed|reported)\s+as\s+)?(?:mean|median)\b/i
  ]);

  function isPdfCaptionContinuationText(value) {
    const text = cleanMarkdownInline(value).trim()
      .replace(/^\\+(?=\*?p\s*[<=>≤≥])/i, '');
    return PDF_CAPTION_CONTINUATION_PATTERNS.some(pattern => pattern.test(text));
  }

  function pdfBlockSignature(block) {
    return JSON.stringify({
      type: String(block?.type || ''),
      text: String(block?.text || ''),
      markdown: String(block?.markdown || ''),
      source: String(block?.source || ''),
      items: Array.isArray(block?.items)
        ? block.items.map(item => String(item?.text || '')) : []
    });
  }

  function pdfBlockIdentity(block) {
    const explicitId = String(block?.id || '').trim();
    if (explicitId) return explicitId;
    const signature = pdfBlockSignature(block);
    let hash = 0x811c9dc5;
    for (let index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `pdf-block-legacy-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function buildPdfFigureSemanticCaptions(blocks, pairs) {
    const input = Array.isArray(blocks) ? blocks : [];
    const sourcePairs = Array.isArray(pairs) ? pairs : associatePdfFigureCaptions(input);
    return sourcePairs.map(pair => {
      const parts = [String(pair.caption || '').trim()].filter(Boolean);
      const panelBlockIndices = [];
      const consumedBlockIndices = [];
      const consumedBlockIds = [];
      const consumedBlocks = [];
      let cursor = pair.captionIndex + 1;
      while (cursor < input.length && consumedBlockIndices.length < 80) {
        const block = input[cursor];
        if (!block) break;
        if (block.type === 'image' ||
            ((block.type === 'heading' || block.type === 'paragraph') &&
              isPdfFigureCaptionText(block.text))) break;
        if (block.type === 'heading') break;
        if (block.type === 'paragraph' && (
          isExplicitPanelLegendText(block.text) ||
          isPdfCaptionContinuationText(block.text)
        )) {
          parts.push(String(block.text || '').trim());
          if (isExplicitPanelLegendText(block.text)) panelBlockIndices.push(cursor);
          consumedBlockIndices.push(cursor);
          consumedBlockIds.push(pdfBlockIdentity(block));
          consumedBlocks.push({
            id: pdfBlockIdentity(block),
            signature: pdfBlockSignature(block)
          });
          cursor += 1;
          continue;
        }
        const listItems = block.type === 'list' && Array.isArray(block.items)
          ? block.items.filter(item => String(item?.text || '').trim()) : [];
        if (listItems.length && listItems.every(item =>
          isExplicitPanelLegendText(item?.text) ||
          isPdfCaptionContinuationText(item?.text))) {
          block.items.forEach(item => {
            if (isExplicitPanelLegendText(item?.text) ||
                isPdfCaptionContinuationText(item?.text)) parts.push(item.text);
          });
          if (listItems.some(item => isExplicitPanelLegendText(item?.text))) {
            panelBlockIndices.push(cursor);
          }
          consumedBlockIndices.push(cursor);
          consumedBlockIds.push(pdfBlockIdentity(block));
          consumedBlocks.push({
            id: pdfBlockIdentity(block),
            signature: pdfBlockSignature(block)
          });
          cursor += 1;
          continue;
        }
        break;
      }
      return {
        ...pair,
        caption: parts.join('\n'),
        panelBlockIndices,
        consumedBlockIndices,
        consumedBlockIds,
        consumedBlocks
      };
    });
  }

  const PDF_MAJOR_SECTION_TITLES = /^(?:graphical\s+abstract|highlights|in\s+brief|abstract|summary|introduction|background|results?(?:\s+and\s+discussion)?|discussion(?:\s+and\s+conclusions?)?|conclusions?(?:\s+and\s+(?:outlook|perspectives?))?|materials?\s+and\s+(?:methods?|experimental\s+procedures?)|methods?\s+and\s+materials?|methods?|experimental\s+(?:section|procedures?)|star\s+methods?|limitations?(?:\s+of\s+the\s+study)?|acknowledg(?:e)?ments?|author\s+contributions?|declaration\s+of\s+(?:interests?|competing\s+interest)|conflicts?\s+of\s+interest|data(?:\s+and\s+code)?\s+availability(?:\s+statement)?|resource\s+availability|references?(?:\s+and\s+notes)?|supplement(?:al|ary)\s+(?:information|materials?))$/i;
  const PDF_COMMON_SUBSECTION_TITLES = /^(?:key\s+resources?\s+table|lead\s+contact|materials?\s+availability|data\s+and\s+code\s+availability|experimental\s+model\s+and\s+(?:subject|study\s+participant)\s+details|method\s+details|quantification\s+and\s+statistical\s+analysis|statistical\s+analysis|outcomes?|study\s+design|animals?|human\s+participants?|cell\s+culture|western\s+blot(?:ting)?|immunofluorescence|image\s+analysis|behavioral\s+tests?)$/i;
  const PDF_NESTED_SECTION_PARENT_TITLES = /^(?:outcomes?|statistical\s+analysis|quantification\s+and\s+statistical\s+analysis)$/i;
  const PDF_METHOD_GROUP_TITLES = /^(?:key\s+resources?\s+table|experimental\s+model\s+and\s+(?:subject|study\s+participant)\s+details|method\s+details|quantification\s+and\s+statistical\s+analysis|statistical\s+analysis)$/i;
  const PDF_RUN_IN_METHOD_HEADING = /^(.{3,96}?\([A-Z][A-Z0-9/+\-]{1,12}\))\s+((?:The|This|These|Those|A|An|Mice|Patients|Animals|To|For|In|As)\b[\s\S]+)$/;
  const PDF_DOCUMENT_FRONT_MATTER_NOISE = /^(?:open\s+access|copyright|keywords?|article\s+type|original\s+(?:article|research)|review\s+article)$/i;
  const PDF_RUNNING_HEADER_TEXT = /^(?:accepted\s+manuscript|article\s+in\s+press|cell\s*press|(?:[\p{L}\p{N}&:+\-]+(?:\s+[\p{L}\p{N}&:+\-]+){0,7}\s+)?(?:article|short\s+article|review))$/iu;

  function stripPdfHeadingNumbering(value) {
    return repairPdfReflowText(value)
      .replace(/^\s*(?:section\s+)?\d+(?:\.\d+)*(?:[.)])?\s+/i, '')
      .replace(/^\s*[IVXLC]+[.)]\s+/i, '')
      .replace(/^\s*[A-Z][.)]\s+/, '')
      .replace(/[\s:：.]+$/, '')
      .trim();
  }

  function pdfHeadingNumberDepth(value) {
    const text = repairPdfReflowText(value);
    const match = text.match(/^\s*(?:section\s+)?(\d+(?:\.\d+)*)(?:[.)])?\s+/i);
    return match ? match[1].split('.').length : 0;
  }

  function isPdfMajorSectionTitle(value) {
    return PDF_MAJOR_SECTION_TITLES.test(stripPdfHeadingNumbering(value));
  }

  function isPdfCommonSubsectionTitle(value) {
    return PDF_COMMON_SUBSECTION_TITLES.test(stripPdfHeadingNumbering(value));
  }

  function isPdfMethodGroupTitle(value) {
    return PDF_METHOD_GROUP_TITLES.test(stripPdfHeadingNumbering(value));
  }

  function splitPdfRunInMethodHeading(value) {
    const text = repairPdfReflowText(value);
    const match = text.match(PDF_RUN_IN_METHOD_HEADING);
    if (!match || /[.!?;:]$/.test(match[1])) return null;
    return { heading: match[1].trim(), body: match[2].trim() };
  }

  function pdfMethodOutlineLevels(blocks) {
    const levels = new Map();
    (Array.isArray(blocks) ? blocks : []).forEach(block => {
      if (block?.type !== 'list') return;
      (Array.isArray(block.items) ? block.items : []).forEach(item => {
        const text = repairPdfReflowText(item?.text);
        if (!text) return;
        const key = comparablePdfHeading(text);
        const depth = Math.max(0, Number(item?.depth) || 0);
        if (isPdfMethodGroupTitle(text)) levels.set(key, 3);
        else if (depth > 0 && !levels.has(key)) levels.set(key, 4);
      });
    });
    return levels;
  }

  function isPdfRunningHeaderText(value) {
    const text = repairPdfReflowText(value);
    if (/https?:\/\/|\bdoi\s*:|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(text)) return true;
    // Generic labels such as "Review" and "Cell Press Article" are page
    // furniture only when they are short. A legitimate paper title can also
    // end in "review" and must never be discarded for that reason.
    return text.length <= 56 && PDF_RUNNING_HEADER_TEXT.test(text);
  }

  function pdfPreferredDocumentTitleIndex(blocks) {
    const candidates = (Array.isArray(blocks) ? blocks : []).flatMap((block, index) => {
      const text = repairPdfReflowText(block?.text);
      if (block?.type !== 'heading' || Number(block.level) !== 1 || !text ||
          PDF_DOCUMENT_FRONT_MATTER_NOISE.test(text) ||
          isPdfNonOutlineCaptionText(text) || isPdfMajorSectionTitle(text) ||
          isPdfRunningHeaderText(text)) return [];
      return [{ index, text, comparable: comparablePdfHeading(text) }];
    }).slice(0, 6);
    if (!candidates.length) return -1;
    const first = candidates[0];
    const second = candidates[1];
    if (!second || first.comparable === second.comparable) return first.index;
    // MinerU frequently promotes the journal masthead (for example, "Cell
    // Metabolism" or "Science") to H1 immediately before the real title.
    // Prefer the following, substantially richer H1 without penalizing short
    // but legitimate paper titles that are repeated verbatim later.
    if (first.text.length <= 56 && second.text.length >= first.text.length + 12) {
      return second.index;
    }
    return first.index;
  }

  function normalizePdfDocumentBlocks(blocks, semanticCaptions) {
    const input = Array.isArray(blocks) ? blocks : [];
    const consumedBlockIds = new Set((Array.isArray(semanticCaptions)
      ? semanticCaptions : []).flatMap(caption =>
      Array.isArray(caption?.consumedBlockIds) ? caption.consumedBlockIds : []
    ));
    const consumedBlockKeyCounts = new Map();
    (Array.isArray(semanticCaptions)
      ? semanticCaptions : []).flatMap(caption =>
      Array.isArray(caption?.consumedBlocks) ? caption.consumedBlocks : []
    ).forEach(block => {
      const key = `${block.id}\u0000${block.signature}`;
      consumedBlockKeyCounts.set(key, (consumedBlockKeyCounts.get(key) || 0) + 1);
    });
    const inputIdCounts = new Map();
    input.forEach(block => {
      const id = pdfBlockIdentity(block);
      inputIdCounts.set(id, (inputIdCounts.get(id) || 0) + 1);
    });
    const methodOutlineLevels = pdfMethodOutlineLevels(input);
    const preferredTitleIndex = pdfPreferredDocumentTitleIndex(input);
    let documentTitleSeen = false;
    let documentTitle = '';
    let previousHeadingLevel = 1;
    let currentMajorSection = '';
    let currentMethodGroup = '';
    let currentMethodParent = '';
    let currentNestedParent = '';
    let previousHeadingOutputIndex = -1;
    let bodySincePreviousHeading = true;
    const output = [];

    function appendHeading(block, text, level) {
      const safeLevel = documentTitleSeen && previousHeadingOutputIndex >= 0
        ? Math.min(level, previousHeadingLevel + 1)
        : level;
      output.push({ ...block, type: 'heading', text, level: safeLevel });
      previousHeadingLevel = safeLevel;
      previousHeadingOutputIndex = output.length - 1;
      bodySincePreviousHeading = false;
    }

    input.forEach((block, index) => {
      if (!block || typeof block !== 'object') return;
      const blockId = pdfBlockIdentity(block);
      const blockKey = `${blockId}\u0000${pdfBlockSignature(block)}`;
      const matchedCount = consumedBlockKeyCounts.get(blockKey) || 0;
      if (matchedCount > 0) {
        consumedBlockKeyCounts.set(blockKey, matchedCount - 1);
        return;
      }
      if (inputIdCounts.get(blockId) === 1 && consumedBlockIds.has(blockId)) return;
      const text = repairPdfReflowText(block.text);
      if (block.type === 'paragraph' && text && !isPdfFigureCaptionText(text)) {
        if (isPdfMajorSectionTitle(text)) {
          currentMajorSection = stripPdfHeadingNumbering(text).toUpperCase();
          currentMethodGroup = '';
          currentMethodParent = '';
          currentNestedParent = '';
          appendHeading(block, text, 2);
          return;
        }
        const nextText = String(input[index + 1]?.text || '').trim();
        if (isPdfCommonSubsectionTitle(text) && nextText && currentMajorSection) {
          if (isPdfMethodGroupTitle(text)) {
            currentMethodGroup = stripPdfHeadingNumbering(text).toUpperCase();
          }
          currentNestedParent = PDF_NESTED_SECTION_PARENT_TITLES.test(
            stripPdfHeadingNumbering(text)
          ) ? text : '';
          currentMethodParent = '';
          appendHeading(block, text, 3);
          return;
        }
        if (/STAR\s+METHODS/i.test(currentMajorSection)) {
          const runIn = splitPdfRunInMethodHeading(text);
          if (runIn) {
            const listedLevel = methodOutlineLevels.get(comparablePdfHeading(runIn.heading));
            const level = listedLevel || (currentMethodParent ? 5 : (currentMethodGroup ? 4 : 3));
            if (level === 4) currentMethodParent = runIn.heading;
            appendHeading(block, runIn.heading, level);
            output.push({ ...block, text: runIn.body });
            bodySincePreviousHeading = true;
            return;
          }
        }
        output.push(text !== block.text ? { ...block, text } : block);
        bodySincePreviousHeading = true;
        return;
      }
      if (block.type !== 'heading') {
        output.push(text && text !== block.text ? { ...block, text } : block);
        if (block.type !== 'divider') bodySincePreviousHeading = true;
        return;
      }
      if (isPdfNonOutlineCaptionText(text)) {
        output.push({ ...block, type: 'paragraph', text });
        bodySincePreviousHeading = true;
        return;
      }
      if (PDF_DOCUMENT_FRONT_MATTER_NOISE.test(text)) return;
      if (isPdfRunningHeaderText(text)) return;
      if (!documentTitleSeen && preferredTitleIndex >= 0 && index !== preferredTitleIndex &&
          (index < preferredTitleIndex || Number(block.level) === 1)) return;
      let level = Math.max(1, Math.min(6, Number(block.level) || 2));
      if (!documentTitleSeen) {
        level = 1;
        documentTitleSeen = true;
        documentTitle = comparablePdfHeading(text);
        currentMajorSection = '';
        currentMethodGroup = '';
        currentMethodParent = '';
        currentNestedParent = '';
      } else if (documentTitle && comparablePdfHeading(text) === documentTitle) {
        // Keep the duplicate marker until the reflow-cleaning pass. MinerU
        // commonly repeats the title at the start of page 2, followed by a
        // second author/affiliation block; the cleaner needs this boundary to
        // discard that repeated front matter without losing the next section.
        output.push({ ...block, type: 'heading', text, level: 1 });
        previousHeadingOutputIndex = output.length - 1;
        bodySincePreviousHeading = false;
        return;
      } else if (isPdfMajorSectionTitle(text)) {
        level = 2;
        currentMajorSection = stripPdfHeadingNumbering(text).toUpperCase();
        currentMethodGroup = '';
        currentMethodParent = '';
        currentNestedParent = '';
      } else if (Number(block.level) === 1) {
        level = 2;
        currentMajorSection = `CUSTOM:${stripPdfHeadingNumbering(text).toUpperCase()}`;
        currentMethodGroup = '';
        currentMethodParent = '';
        currentNestedParent = '';
      } else if (pdfHeadingNumberDepth(text) === 1) {
        level = 2;
        currentMajorSection = `CUSTOM:${stripPdfHeadingNumbering(text).toUpperCase()}`;
        currentMethodGroup = '';
        currentMethodParent = '';
        currentNestedParent = '';
      } else if (pdfHeadingNumberDepth(text) > 1) {
        const numberedDepth = pdfHeadingNumberDepth(text);
        level = Math.max(3, Math.min(6, numberedDepth + 1));
        if (!currentMajorSection) currentMajorSection = 'CUSTOM:NUMBERED';
      } else if (currentMajorSection && !/STAR\s+METHODS/i.test(currentMajorSection) &&
          isPdfCommonSubsectionTitle(text)) {
        level = 3;
        currentNestedParent = PDF_NESTED_SECTION_PARENT_TITLES.test(
          stripPdfHeadingNumbering(text)
        ) ? text : '';
      } else if (/STAR\s+METHODS/i.test(currentMajorSection)) {
        if (isPdfMethodGroupTitle(text)) {
          level = 3;
          currentMethodGroup = stripPdfHeadingNumbering(text).toUpperCase();
          currentMethodParent = '';
        } else if (currentMethodGroup) {
          const listedLevel = methodOutlineLevels.get(comparablePdfHeading(text));
          if (listedLevel === 4) {
            level = 4;
            currentMethodParent = text;
          } else {
            const previousHeading = output[previousHeadingOutputIndex];
            level = currentMethodParent || (
              previousHeading?.type === 'heading' &&
              Number(previousHeading.level) === 4 && !bodySincePreviousHeading
            ) ? 5 : 4;
            if (level === 4) currentMethodParent = text;
          }
        } else {
          level = 3;
        }
      } else if (currentMajorSection) {
        const numberedDepth = pdfHeadingNumberDepth(text);
        if ((currentMajorSection === 'INTRODUCTION' ||
             currentMajorSection.startsWith('CUSTOM:')) && level === 2 &&
            !isPdfCommonSubsectionTitle(text)) {
          level = 2;
          currentMajorSection = `CUSTOM:${text.toUpperCase()}`;
        } else {
          level = numberedDepth > 1
            ? Math.max(3, Math.min(6, numberedDepth + 1))
            : currentNestedParent
              ? Math.max(4, Math.min(level + 1, 5))
              : Math.max(3, Math.min(level, 4));
        }
      } else {
        level = Math.max(2, Math.min(level, previousHeadingLevel + 1));
      }
      appendHeading(block, text, level);
    });
    return output;
  }

  const PDF_REFLOW_HIDDEN_FRONT_MATTER = /^(?:graphical\s+abstract|authors?|correspondence|article\s+information)$/i;
  const PDF_REFLOW_PANEL_DEBRIS = /^(?:[A-Z](?:\s+|\s*[,|;]\s*|$)){1,12}$/;
  const PDF_REFLOW_PAGE_DEBRIS = /^(?:article|cell\s+press|neuron|current\s+biology|nature|science|elsevier|\d+|or|see\s+online\s+for\s+appendix|[A-Z]{2},\s*(?:Canada|USA|UK|Australia))$/i;

  function isPdfSpacedUppercaseBanner(value) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 5) return false;
    const singleUppercase = words.filter(word => /^[A-Z]$/.test(word)).length;
    return singleUppercase >= 5 && singleUppercase / words.length >= 0.72;
  }

  function comparablePdfHeading(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/\\(?:mathrm|text|operatorname)/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
  }

  function repairPdfReflowText(value) {
    const text = String(value || '').normalize('NFKC').trim();
    if (/^star[^a-z0-9]*methods$/i.test(text)) return 'STAR METHODS';
    return text;
  }

  function repairPdfHeadingText(value) {
    let text = repairPdfReflowText(value)
      .replace(/\s*check\s*for\s*updates\s*/igu, ' ')
      .replace(/\s*checkfor\s+updates\s*/igu, ' ')
      .replace(/\s+/g, ' ').trim();
    const repeated = text.match(/^(.{3,240}?)(?:\s*)\1$/iu);
    if (repeated) text = repeated[1].trim();
    const numbered = text.match(/^\s*(?:section\s+)?(\d+(?:\.\d+)+[.)]?)\s+/i);
    if (numbered) {
      const repeatedNumberAt = text.indexOf(numbered[1], numbered[0].length);
      if (repeatedNumberAt > 0) text = text.slice(repeatedNumberAt).trim();
    }
    const duplicatedTail = text.match(/^(.*\b)([A-Za-z]{5,})\s+([A-Za-z]{3,})$/u);
    if (duplicatedTail && duplicatedTail[2].toLowerCase()
        .endsWith(duplicatedTail[3].toLowerCase())) {
      text = `${duplicatedTail[1]}${duplicatedTail[2]}`.trim();
    }
    return text;
  }

  function cleanPdfReflowBlocks(blocks) {
    const input = Array.isArray(blocks) ? blocks : [];
    const output = [];
    const headingFrequencies = new Map();
    input.forEach(block => {
      if (block?.type !== 'heading' || isPdfNonOutlineCaptionText(block.text)) return;
      const key = comparablePdfHeading(repairPdfHeadingText(block.text));
      if (key) headingFrequencies.set(key, (headingFrequencies.get(key) || 0) + 1);
    });
    let documentTitle = '';
    let hiddenFrontMatter = false;
    let skipDuplicateTitleMatter = false;
    let seenMajorSection = false;
    const emittedHeadings = new Set();

    input.forEach(block => {
      if (!block || typeof block !== 'object') return;
      const text = block.type === 'heading'
        ? repairPdfHeadingText(block.text)
        : repairPdfReflowText(block.text);
      const isHeading = block.type === 'heading';
      const comparable = comparablePdfHeading(text);

      if (!documentTitle && isHeading && Number(block.level) === 1 && text) {
        documentTitle = comparable;
      }

      if (hiddenFrontMatter) {
        if (!isHeading) return;
        hiddenFrontMatter = false;
      }
      if (isHeading && PDF_REFLOW_HIDDEN_FRONT_MATTER.test(text)) {
        hiddenFrontMatter = true;
        return;
      }

      if (skipDuplicateTitleMatter) {
        if (!isHeading || isPdfRunningHeaderText(text) || comparable === documentTitle) return;
        // Resume at the very next real heading, not only at a canonical major
        // section. Reviews often begin directly with a topic heading.
        skipDuplicateTitleMatter = false;
      }

      if (isHeading && documentTitle && comparable === documentTitle &&
          output.some(item => item.type === 'heading' &&
            comparablePdfHeading(item.text) === documentTitle)) {
        skipDuplicateTitleMatter = true;
        return;
      }

      if ((block.type === 'paragraph' || isHeading) &&
          (PDF_REFLOW_PANEL_DEBRIS.test(text) || PDF_REFLOW_PAGE_DEBRIS.test(text) ||
            isPdfRunningHeaderText(text) || isPdfSpacedUppercaseBanner(text))) {
        return;
      }
      if (isHeading && /^funding\s+information$/i.test(text) && !seenMajorSection &&
          Number(headingFrequencies.get(comparable) || 0) > 1) return;
      if (isHeading && comparable !== documentTitle &&
          Number(headingFrequencies.get(comparable) || 0) >= 3 &&
          !isPdfMajorSectionTitle(text)) return;
      if (isHeading && emittedHeadings.has(comparable) &&
          (isPdfMajorSectionTitle(text) || isPdfRunningHeaderText(text))) return;
      if (isHeading && !text) return;
      const previous = output.at(-1);
      if (isHeading && previous?.type === 'heading' &&
          Number(previous.level) === Number(block.level) &&
          !isPdfMajorSectionTitle(previous.text) && !isPdfMajorSectionTitle(text) &&
          !isPdfCommonSubsectionTitle(previous.text) &&
          !isPdfFigureCaptionText(previous.text) && !isPdfFigureCaptionText(text) &&
          (/(?:\b(?:and|or|of|for|with|via|to|in|on|by|from)|[-–—,:])$/iu.test(previous.text) ||
            /^\p{Ll}/u.test(text))) {
        const previousComparable = comparablePdfHeading(previous.text);
        const previousSource = previous.markdown || previous.text;
        previous.text = `${previous.text.replace(/\s+$/, '')} ${text}`.replace(/\s+/g, ' ').trim();
        if (previous.markdown || block.markdown) {
          previous.markdown = `${previousSource} ${block.markdown || text}`
            .replace(/\s+/g, ' ').trim();
        }
        if (Number.isSafeInteger(previous.pageNumber) &&
            Number.isSafeInteger(block.pageNumber) &&
            previous.pageNumber !== block.pageNumber) delete previous.pageNumber;
        emittedHeadings.delete(previousComparable);
        emittedHeadings.add(comparablePdfHeading(previous.text));
        return;
      }
      output.push(text && text !== block.text ? { ...block, text } : block);
      if (isHeading && isPdfMajorSectionTitle(text)) seenMajorSection = true;
      if (isHeading && comparable) emittedHeadings.add(comparable);
    });

    return output.filter((block, index) => {
      if (block?.type !== 'divider') return true;
      return index > 0 && index < output.length - 1 &&
        output[index - 1]?.type !== 'divider';
    });
  }

  function buildPdfFigureGroups(blocks, semanticCaptions, options = {}) {
    const input = Array.isArray(blocks) ? blocks : [];
    const captions = (Array.isArray(semanticCaptions)
      ? semanticCaptions : buildPdfFigureSemanticCaptions(input))
      .filter(pair => Number.isInteger(pair?.captionIndex))
      .sort((left, right) => left.captionIndex - right.captionIndex);
    if (!captions.length) return [];
    const maxEdgeDistance = Math.max(12, Math.min(
      240,
      Number(options.maxEdgeDistance) || 120
    ));
    const groups = captions.map((caption, index) => ({
      ...caption,
      groupIndex: index,
      imageIndices: [],
      anchorIndex: caption.captionIndex
    }));
    const imageIndices = input.flatMap((block, index) =>
      block?.type === 'image' ? [index] : []
    );
    imageIndices.forEach(imageIndex => {
      const ranked = groups.map(group => ({
        group,
        distance: Math.abs(group.captionIndex - imageIndex),
        // Most scientific captions follow their Figure. Prefer that direction
        // only as a tie-breaker; MinerU sometimes emits captions first.
        directionPenalty: imageIndex <= group.captionIndex ? 0 : 1
      })).sort((left, right) =>
        left.distance - right.distance ||
        left.directionPenalty - right.directionPenalty ||
        left.group.captionIndex - right.group.captionIndex
      );
      const nearest = ranked[0];
      if (!nearest) return;
      const outsideDocumentEdge = (
        imageIndex < groups[0].captionIndex ||
        imageIndex > groups.at(-1).captionIndex
      );
      if (outsideDocumentEdge && nearest.distance > maxEdgeDistance) return;
      nearest.group.imageIndices.push(imageIndex);
    });
    return groups.map(group => {
      if (!group.imageIndices.length && Number.isInteger(group.imageIndex)) {
        group.imageIndices.push(group.imageIndex);
      }
      group.imageIndices = [...new Set(group.imageIndices)].sort((a, b) => a - b);
      group.anchorIndex = Math.min(group.captionIndex, ...group.imageIndices);
      group.consumedBlockIndices = [...new Set([
        group.captionIndex,
        ...(group.consumedBlockIndices || group.panelBlockIndices || []),
        ...group.imageIndices
      ])].sort((a, b) => a - b);
      return group;
    }).filter(group => group.imageIndices.length);
  }

  function pdfDocumentTitle(blocks, fallback = '') {
    const headings = (Array.isArray(blocks) ? blocks : [])
      .filter(block => block?.type === 'heading' &&
        !isPdfNonOutlineCaptionText(block.text) &&
        !/^(?:cell\s+article|supplement(?:al|ary)\s+information)\b/i
          .test(String(block.text || '').trim()));
    const levelOne = headings.find(block => block.level === 1 && block.text.length >= 8);
    return String(levelOne?.text || headings[0]?.text || fallback || '')
      .normalize('NFKC').replace(/\.pdf(?:\s*[-‐-―].*)?$/i, '').trim();
  }

  function normalizeZipPath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) return '';
    return normalized;
  }

  function findZipEndRecord(view) {
    const minimum = 22;
    if (view.byteLength < minimum) return -1;
    const start = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - minimum; offset >= start; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function inflateZipEntry(bytes, method) {
    if (method === 0) return bytes.slice();
    if (method !== 8 || typeof DecompressionStream !== 'function') {
      throw new Error(method === 8
        ? 'PDF_ZIP_DECOMPRESSION_UNAVAILABLE'
        : 'PDF_ZIP_COMPRESSION_UNSUPPORTED');
    }
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractZipEntries(input, { maxEntries = 800, maxBytes = 180000000 } = {}) {
    const buffer = input instanceof ArrayBuffer
      ? input : input?.buffer?.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (!(buffer instanceof ArrayBuffer)) throw new Error('PDF_ZIP_INVALID');
    const view = new DataView(buffer);
    const endOffset = findZipEndRecord(view);
    if (endOffset < 0) throw new Error('PDF_ZIP_END_RECORD_MISSING');
    const entryCount = Math.min(maxEntries, view.getUint16(endOffset + 10, true));
    let cursor = view.getUint32(endOffset + 16, true);
    const decoder = new TextDecoder('utf-8');
    const entries = new Map();
    let extractedBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) {
        throw new Error('PDF_ZIP_CENTRAL_DIRECTORY_INVALID');
      }
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const nameBytes = new Uint8Array(buffer, cursor + 46, nameLength);
      const name = normalizeZipPath(decoder.decode(nameBytes));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (!name || name.endsWith('/')) continue;
      if (uncompressedSize > maxBytes || extractedBytes + uncompressedSize > maxBytes) {
        throw new Error('PDF_ZIP_TOO_LARGE');
      }
      if (view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('PDF_ZIP_LOCAL_HEADER_INVALID');
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
      const bytes = await inflateZipEntry(compressed, method);
      extractedBytes += bytes.byteLength;
      entries.set(name, bytes);
    }
    return entries;
  }

  function selectMineruMarkdownEntry(entries) {
    const names = [...(entries instanceof Map ? entries.keys() : [])];
    return names.find(name => /(?:^|\/)full\.md$/i.test(name)) ||
      names.find(name => /\.md$/i.test(name)) || '';
  }

  function mimeTypeForPdfAsset(name) {
    const extension = String(name || '').split('.').pop().toLowerCase();
    return {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      svg: 'image/svg+xml'
    }[extension] || 'application/octet-stream';
  }

  function resolveMineruAssetEntry(entries, markdownEntry, reference) {
    if (!(entries instanceof Map)) return '';
    const raw = String(reference || '').trim().replace(/^<|>$/g, '');
    if (!raw || /^(?:data:|blob:|https?:)/i.test(raw)) return '';
    const markdownDirectory = String(markdownEntry || '').includes('/')
      ? String(markdownEntry).replace(/\/[^/]*$/, '') : '';
    const joined = normalizeZipPath(
      `${markdownDirectory ? markdownDirectory + '/' : ''}${raw}`
    );
    if (joined && entries.has(joined)) return joined;
    const direct = normalizeZipPath(raw);
    if (direct && entries.has(direct)) return direct;
    const basename = direct.split('/').pop();
    return [...entries.keys()].find(name => name.split('/').pop() === basename) || '';
  }

  function encodePdfImageDataUrl(bytes, mimeType = 'image/png') {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!source.length) return '';
    let base64 = '';
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(source).toString('base64');
    } else {
      const chunkSize = 0x8000;
      let binary = '';
      for (let index = 0; index < source.length; index += chunkSize) {
        binary += String.fromCharCode(...source.subarray(index, index + chunkSize));
      }
      base64 = btoa(binary);
    }
    return `data:${String(mimeType || 'image/png')};base64,${base64}`;
  }

  async function buildRemotePdfImageCache(
    blocks,
    resolveUrl,
    fetchImpl = globalThis.fetch,
    options = {}
  ) {
    const maxBytes = Math.max(0, Math.min(
      96 * 1024 * 1024,
      Number(options.maxBytes) || 48 * 1024 * 1024
    ));
    const maxImages = Math.max(0, Math.min(500, Number(options.maxImages) || 400));
    const images = {};
    let cachedBytes = 0;
    let omittedImageCount = 0;
    const references = [...new Set(
      (Array.isArray(blocks) ? blocks : [])
        .filter(block => block?.type === 'image')
        .map(block => String(block.source || '').trim())
        .filter(Boolean)
    )];
    for (const reference of references) {
      if (Object.keys(images).length >= maxImages) {
        omittedImageCount += 1;
        continue;
      }
      const existing = String(options.existing?.[reference] || '');
      if (/^data:image\//i.test(existing)) {
        const byteLength = Math.floor((existing.split(',')[1]?.length || 0) * 0.75);
        if (cachedBytes + byteLength <= maxBytes) {
          images[reference] = existing;
          cachedBytes += byteLength;
        } else {
          omittedImageCount += 1;
        }
        continue;
      }
      try {
        const url = typeof resolveUrl === 'function' ? resolveUrl(reference) : reference;
        if (!/^https?:\/\//i.test(String(url || '')) || typeof fetchImpl !== 'function') {
          omittedImageCount += 1;
          continue;
        }
        const response = await fetchImpl(url);
        const declaredLength = Math.max(
          0, Number(response?.headers?.get?.('content-length')) || 0
        );
        if (!response?.ok || (declaredLength && cachedBytes + declaredLength > maxBytes)) {
          omittedImageCount += 1;
          continue;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || cachedBytes + bytes.byteLength > maxBytes) {
          omittedImageCount += 1;
          continue;
        }
        const headerMime = String(response.headers?.get?.('content-type') || '')
          .split(';', 1)[0].trim().toLowerCase();
        const inferredMime = mimeTypeForPdfAsset(reference);
        const mimeType = /^image\//i.test(headerMime) ? headerMime : inferredMime;
        if (!/^image\//i.test(mimeType)) {
          omittedImageCount += 1;
          continue;
        }
        const dataUrl = encodePdfImageDataUrl(bytes, mimeType);
        if (!dataUrl) {
          omittedImageCount += 1;
          continue;
        }
        images[reference] = dataUrl;
        cachedBytes += bytes.byteLength;
      } catch (_) {
        omittedImageCount += 1;
      }
    }
    return {
      images,
      cachedImageCount: Object.keys(images).length,
      omittedImageCount,
      cachedBytes
    };
  }

  function buildPersistablePdfImageCache(
    blocks,
    entries,
    markdownEntry,
    existing = {},
    options = {}
  ) {
    const maxBytes = Math.max(0, Math.min(
      96 * 1024 * 1024,
      Number(options.maxBytes) || 48 * 1024 * 1024
    ));
    const maxImages = Math.max(0, Math.min(500, Number(options.maxImages) || 400));
    const images = {};
    let cachedBytes = 0;
    let omittedImageCount = 0;
    const imageBlocks = (Array.isArray(blocks) ? blocks : [])
      .filter(block => block?.type === 'image' && String(block.source || '').trim());
    for (const block of imageBlocks) {
      const reference = String(block.source || '').trim();
      if (Object.keys(images).length >= maxImages) {
        omittedImageCount += 1;
        continue;
      }
      const restored = String(existing?.[reference] || '');
      if (/^data:image\//i.test(restored)) {
        const estimatedBytes = Math.floor((restored.split(',')[1]?.length || 0) * 0.75);
        if (cachedBytes + estimatedBytes <= maxBytes) {
          images[reference] = restored;
          cachedBytes += estimatedBytes;
        } else {
          omittedImageCount += 1;
        }
        continue;
      }
      const entry = resolveMineruAssetEntry(entries, markdownEntry, reference);
      const bytes = entry && entries instanceof Map ? entries.get(entry) : null;
      const byteLength = Number(bytes?.byteLength || bytes?.length) || 0;
      if (!entry || !byteLength || cachedBytes + byteLength > maxBytes) {
        omittedImageCount += 1;
        continue;
      }
      const dataUrl = encodePdfImageDataUrl(bytes, mimeTypeForPdfAsset(entry));
      if (!dataUrl) {
        omittedImageCount += 1;
        continue;
      }
      images[reference] = dataUrl;
      cachedBytes += byteLength;
    }
    return {
      images,
      cachedImageCount: Object.keys(images).length,
      omittedImageCount,
      cachedBytes
    };
  }

  return {
    PDF_READER_PATH,
    PDF_MINERU_SETTINGS_KEY,
    PDF_MINERU_USAGE_KEY,
    PDF_MINERU_AGENT_BASE,
    PDF_MINERU_PRECISE_BASE,
    PDF_MINERU_PRIORITY_PAGE_QUOTA,
    PDF_MINERU_MAX_FILE_BYTES,
    normalizePdfSourceUrl,
    buildLocalPdfWorkspaceUrl,
    withLocalPdfWorkspaceSource,
    isPdfReaderUrl,
    isLikelyPdfUrl,
    createPdfReaderUrl,
    normalizeMineruPdfSettings,
    planOriginalPdfTextEnhancement,
    hasPdfByteSignature,
    mineruUsageDay,
    normalizeMineruUsageLedger,
    recordMineruUsage,
    normalizeMineruQuotaData,
    cleanMarkdownInline,
    normalizeScientificInline,
    markdownInlineTokens,
    parseMarkdownImage,
    markdownToPdfBlocks,
    renderPdfListBlock,
    isPdfFigureCaptionText,
    isPdfTableCaptionText,
    associatePdfFigureCaptions,
    isExplicitPanelLegendText,
    isPdfCaptionContinuationText,
    buildPdfFigureSemanticCaptions,
    stripPdfHeadingNumbering,
    pdfHeadingNumberDepth,
    isPdfMajorSectionTitle,
    isPdfRunningHeaderText,
    normalizePdfDocumentBlocks,
    cleanPdfReflowBlocks,
    buildPdfFigureGroups,
    pdfDocumentTitle,
    normalizeZipPath,
    findZipEndRecord,
    extractZipEntries,
    selectMineruMarkdownEntry,
    mimeTypeForPdfAsset,
    resolveMineruAssetEntry,
    encodePdfImageDataUrl,
    buildRemotePdfImageCache,
    buildPersistablePdfImageCache
  };
});
