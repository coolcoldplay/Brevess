/*
 * Adapted from llm-for-zotero 3.8.27 at commit
 * f8dbbd863b021368c07efe0f61c67f3503d79bc9 (AGPL-3.0-or-later).
 * See THIRD_PARTY_NOTICES.md for provenance and modifications.
 */
(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_MIN_BOUNDARY_CHARS = 180;
  const DEFAULT_TARGET_CHARS = 360;
  const DEFAULT_HARD_CAP_CHARS = 800;
  const DEFAULT_MAX_WAIT_MS = 450;
  const ARTICLE_CHAT_MAX_EVIDENCE_PER_BLOCK = 128;

  function scanMarkdown(text) {
    let lineStart = 0;
    let fenceMarker = '';
    let lastBoundary = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== '\n') continue;
      const line = text.slice(lineStart, index).replace(/\r$/, '');
      const fence = line.match(/^\s{0,3}(```+|~~~+)/);
      if (fence) {
        const marker = fence[1][0];
        if (!fenceMarker) fenceMarker = marker;
        else if (fenceMarker === marker) fenceMarker = '';
      } else if (!fenceMarker && /^\s*$/.test(line)) {
        lastBoundary = index + 1;
      }
      lineStart = index + 1;
    }
    return { lastBoundary, fenceOpen: Boolean(fenceMarker) };
  }

  function hasIncompleteTable(text) {
    const lines = text.trimEnd().split(/\r?\n/);
    if (lines.length < 2) return false;
    const last = lines.at(-1).trim();
    const previous = lines.at(-2).trim();
    const tableLike = line => line.startsWith('|') || line.endsWith('|');
    const delimiterLike = line => /^\|?\s*:?-{2,}/.test(line);
    return tableLike(previous) && (delimiterLike(last) ? !/\|\s*$/.test(last) : false);
  }

  function canFinalizeMarkdown(text) {
    if (!text) return false;
    const scanned = scanMarkdown(text.endsWith('\n') ? text : `${text}\n`);
    return !scanned.fenceOpen && !hasIncompleteTable(text);
  }

  function createMarkdownBlockStreamCoalescer(options) {
    if (!options || typeof options.onBlock !== 'function') {
      throw new TypeError('onBlock callback is required');
    }
    const minBoundaryChars = options.minBoundaryChars ?? DEFAULT_MIN_BOUNDARY_CHARS;
    const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
    const hardCapChars = options.hardCapChars ?? DEFAULT_HARD_CAP_CHARS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const setTimerFn = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimerFn = options.clearTimer || (timer => clearTimeout(timer));
    let pendingText = '';
    let fullText = '';
    let timer = null;
    let cancelled = false;

    function clearPendingTimer() {
      if (timer === null) return;
      clearTimerFn(timer);
      timer = null;
    }

    function emitPrefix(end, reason) {
      if (end <= 0) return false;
      const block = pendingText.slice(0, end);
      pendingText = pendingText.slice(end);
      clearPendingTimer();
      options.onBlock(block, reason);
      return true;
    }

    function flushComplete(reason) {
      if (!pendingText || cancelled) {
        clearPendingTimer();
        return false;
      }
      const { lastBoundary } = scanMarkdown(pendingText);
      const thresholdReached = lastBoundary >= minBoundaryChars ||
        pendingText.length >= targetChars || pendingText.length >= hardCapChars;
      return lastBoundary > 0 && thresholdReached
        ? emitPrefix(lastBoundary, reason)
        : false;
    }

    function scheduleTimer() {
      if (timer !== null || !pendingText || maxWaitMs <= 0) return;
      timer = setTimerFn(() => {
        timer = null;
        flushComplete('timer');
      }, maxWaitMs);
    }

    return {
      pushText(delta) {
        if (cancelled || !delta) return;
        pendingText += String(delta);
        fullText += String(delta);
        if (!flushComplete('boundary')) scheduleTimer();
      },

      flushNow(reason = 'event') {
        return flushComplete(reason);
      },

      finish() {
        if (cancelled || !pendingText) {
          clearPendingTimer();
          return false;
        }
        flushComplete('boundary');
        if (!pendingText || !canFinalizeMarkdown(pendingText)) {
          clearPendingTimer();
          return false;
        }
        return emitPrefix(pendingText.length, 'final');
      },

      cancel() {
        cancelled = true;
        pendingText = '';
        clearPendingTimer();
      },

      getFullText() {
        return fullText;
      },

      hasPending() {
        return Boolean(pendingText);
      }
    };
  }

  function invalidStreamResponse(message) {
    const error = new Error(message || 'Article chat stream record is invalid');
    error.code = 'INVALID_RESPONSE';
    return error;
  }

  function normalizeValue(value, maximum = 4000) {
    return String(value || '').normalize('NFKC').replace(/\0/g, '').trim().slice(0, maximum);
  }

  function normalizeNarrativeValue(value, maximum = 4000) {
    return String(value || '').normalize('NFC').replace(/\0/g, '').trim().slice(0, maximum);
  }

  function stableFingerprint(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let result = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      result = Math.imul(result ^ text.charCodeAt(index), 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function markerFollowsAnswerText(markdown, marker) {
    const escaped = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`, 'gu');
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const lineStart = markdown.lastIndexOf('\n', Math.max(0, match.index - 1)) + 1;
      const prefix = markdown.slice(lineStart, match.index)
        .replace(/[`*_>#|\[\]()~\\-]/g, '').trim();
      if (/[\p{L}\p{N}]/u.test(prefix)) return true;
    }
    return false;
  }

  function tableLineCells(value) {
    // Match popup.parseArticleChatMarkdownTableRow's column boundaries. Evidence
    // scanning happens after slicing to the columns the renderer actually shows.
    let line = String(value || '').trim();
    if (!line.includes('|')) return null;
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
    const cells = [];
    let cell = '';
    let code = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '\\' && index + 1 < line.length && ['|', '\\', '`'].includes(line[index + 1])) {
        cell += line[++index];
        continue;
      }
      if (character === '`') code = !code;
      if (character === '|' && !code) { cells.push(cell.trim()); cell = ''; }
      else cell += character;
    }
    cells.push(cell.trim());
    return cells.length >= 2 ? cells : null;
  }

  function tableInlineLinkLength(text, start) {
    // The popup renders an entire link as one token; markers inside its label or
    // destination are plain link text, not inline evidence buttons.
    if (text[start] === '[' && text[start + 1] !== '[') {
      let labelEnd = -1;
      for (let index = start + 1; index < text.length; index += 1) {
        if (text[index] === '\\') { index += 1; continue; }
        if (text[index] === ']' && text[index + 1] === '(') { labelEnd = index; break; }
      }
      if (labelEnd > start + 1) {
        let depth = 0;
        for (let index = labelEnd + 2; index < text.length; index += 1) {
          if (/\s/.test(text[index])) break;
          if (text[index] === '\\') { index += 1; continue; }
          if (text[index] === '(') depth += 1;
          else if (text[index] === ')') {
            if (depth > 0) depth -= 1;
            else return index > labelEnd + 2 ? index - start + 1 : 0;
          }
        }
      }
    }
    const suffix = text.slice(start);
    return suffix.match(/^<https?:\/\/[^\s<>]+>/i)?.[0].length ||
      suffix.match(/^https?:\/\/[^\s<>"'`]+/i)?.[0].length || 0;
  }

  function tableEvidenceText(value) {
    // Code and escaped brackets cannot provide a row citation. Existing block
    // normalization bounds this scan to 64 * 1024 characters.
    const line = String(value || '').trim();
    let visible = '';
    for (let index = 0; index < line.length; index += 1) {
      const linkLength = tableInlineLinkLength(line, index);
      if (line[index] === '\\' && index + 1 < line.length) {
        visible += /[|[\]`\\]/.test(line[index + 1]) ? ' ' : line[index + 1];
        index += 1;
      } else if (linkLength) {
        visible += ' ';
        index += linkLength - 1;
      } else if (line[index] === '`') {
        let end = index + 1;
        while (line[end] === '`') end += 1;
        const ticks = line.slice(index, end);
        let close = line.indexOf(ticks, end);
        while (close >= 0 && (line[close - 1] === '`' || line[close + ticks.length] === '`')) {
          close = line.indexOf(ticks, close + ticks.length);
        }
        if (close >= 0) {
          visible += ' ';
          index = close + ticks.length - 1;
        } else {
          visible += ticks;
          index = end - 1;
        }
      } else {
        visible += line[index];
      }
    }
    return visible;
  }

  function tableMetadataRowIsBound(header, cells, metadata) {
    const sourceUrl = String(metadata?.sourceUrl || '');
    if (!/^https?:\/\//.test(sourceUrl) || !Array.isArray(metadata?.authors)) return false;
    if (cells.some(cell => /[`\\]/.test(cell))) return false;
    const fieldNames = {
      author: ['author', 'authors', 'name', '作者', '作者姓名', '姓名'],
      affiliation: ['affiliation', 'affiliations', 'institution', 'institutions', '机构', '单位', '所属机构'],
      corresponding: ['corresponding author', 'corresponding', '通讯作者'],
      source: ['source', 'source url', 'reference', '来源']
    };
    const text = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    const fields = header.map(value => Object.keys(fieldNames).find(field =>
      fieldNames[field].includes(text(value).toLowerCase())));
    if (fields.some(field => !field) || new Set(fields).size !== fields.length || !fields.includes('author')) return false;
    let linked = false;
    const values = cells.map(cell => text(cell.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>/g,
      (match, label, url, autoUrl) => {
        if ((url || autoUrl) !== sourceUrl) return match;
        linked = true;
        return !label || /^(?:source|来源|原文|原文链接|link|source url)$/i.test(label) ? '' : label;
      }
    )));
    if (!linked || values.length !== fields.length) return false;
    const authorName = values[fields.indexOf('author')];
    if (!authorName) return false;
    return metadata.authors.some(author => text(author.name) === authorName && fields.every((field, index) => {
      const value = values[index];
      if (field === 'author') return value === text(author.name);
      if (field === 'source') return !value;
      if (field === 'affiliation') {
        const affiliations = (Array.isArray(author.affiliations) ? author.affiliations : []).map(text);
        return Boolean(value) && (affiliations.includes(value) ||
          value.split(/\s*[;；]\s*/).every(part => affiliations.includes(part)));
      }
      return author.corresponding === true
        ? /^(?:yes|true|是|通讯作者)$/i.test(value)
        : /^(?:unknown|not specified|未确认|未说明|不详)$/i.test(value);
    }));
  }

  function validateTableRowEvidence(markdown, blockId, evidenceMarkers, publicationMetadata) {
    const lines = markdown.split(/\r?\n/);
    let fence = null;
    let header = null;
    const delimiter = row => row && row.every(cell => /^:?-{3,}:?$/.test(cell));
    for (let index = 0; index < lines.length; index += 1) {
      const row = tableLineCells(lines[index]);
      const fenceMatch = (!header || !row) && lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence.marker &&
            fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
        continue;
      }
      if (fenceMatch) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        header = null;
        continue;
      }
      const next = !header && tableLineCells(lines[index + 1]);
      if (!header && row && delimiter(next) && row.length === next.length) {
        header = row;
        index += 1; // Header and delimiter are not factual data rows.
        continue;
      }
      if (!header || !row) { header = null; continue; }
      // Within an existing table every consecutive pipe row is body, including
      // repeated separators. Overflow cells are not displayed by the popup.
      const visibleCells = row.slice(0, header.length);
      const cited = visibleCells.map(tableEvidenceText).some(cell => [...cell.matchAll(/\[\[(\d{1,3})\]\]/g)]
        .some(match => evidenceMarkers.has(match[1]))) ||
        tableMetadataRowIsBound(header, visibleCells, publicationMetadata);
      if (!cited) {
        const error = invalidStreamResponse('Article chat table data row lacks an evidence citation');
        error.details = { type: 'TABLE_ROW_UNCITED', blockId, lineNumber: index + 1 };
        throw error;
      }
    }
  }

  function normalizeAnswerEvidence(value, snapshot) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw invalidStreamResponse('Article chat evidence must be an object');
    }
    const marker = normalizeValue(value.marker, 12).replace(/^\[\[|\]\]$/g, '');
    if (!/^\d{1,3}$/.test(marker)) {
      throw invalidStreamResponse('Article chat evidence marker is invalid');
    }
    const evidence = {
      marker,
      paragraphId: normalizeValue(value.paragraph_id || value.paragraphId, 160),
      sourceKey: normalizeValue(value.source_key || value.sourceKey, 160),
      textHash: normalizeValue(value.text_hash || value.textHash, 160),
      quote: normalizeNarrativeValue(value.quote, 2400),
      sectionPath: (Array.isArray(value.section_path || value.sectionPath)
        ? value.section_path || value.sectionPath : [])
        .slice(-12).map(item => normalizeValue(
          typeof item === 'string' ? item : item?.title, 300
        )).filter(Boolean),
      sectionTitle: normalizeValue(value.section_title || value.sectionTitle, 300),
      documentRevision: Number(snapshot?.revision) || 0
    };
    const verification = typeof shared.verifyArticleChatEvidence === 'function'
      ? shared.verifyArticleChatEvidence(evidence, snapshot)
      : { status: 'missing', candidateCount: 0, reason: 'VERIFIER_UNAVAILABLE', target: null };
    return { ...evidence, verification };
  }

  function validateArticleChatAnswerBlock(value, snapshot, options = {}) {
    const blockId = normalizeValue(value?.block_id || value?.blockId, 160);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(blockId)) {
      throw invalidStreamResponse('Article chat block id is invalid');
    }
    const markdown = normalizeNarrativeValue(value?.markdown, 64 * 1024);
    if (!markdown || !canFinalizeMarkdown(markdown)) {
      throw invalidStreamResponse('Article chat block contains incomplete Markdown');
    }
    const rawEvidence = Array.isArray(value?.evidence) ? value.evidence : [];
    if (rawEvidence.length > ARTICLE_CHAT_MAX_EVIDENCE_PER_BLOCK) {
      throw invalidStreamResponse('Article chat block contains too many evidence citations');
    }
    const evidence = rawEvidence.map(item => normalizeAnswerEvidence(item, snapshot));
    if (options.requireExactEvidence && evidence.some(item =>
      item.verification?.status !== 'verified' || !item.verification.target?.quoteSpan)) {
      throw invalidStreamResponse('Selected-text citations must quote one exact source span');
    }
    const evidenceMarkers = new Set(evidence.map(item => item.marker));
    if (evidenceMarkers.size !== evidence.length) {
      throw invalidStreamResponse('Article chat evidence markers must be unique inside a block');
    }
    const markdownMarkers = new Set(
      [...markdown.matchAll(/\[\[(\d{1,3})\]\]/g)].map(match => match[1])
    );
    if ([...markdownMarkers].some(marker => !evidenceMarkers.has(marker)) ||
        evidence.some(item => !markdownMarkers.has(item.marker))) {
      throw invalidStreamResponse('Article chat evidence markers do not match the block');
    }
    if (evidence.some(item => !markerFollowsAnswerText(markdown, item.marker))) {
      throw invalidStreamResponse('Article chat evidence marker is not placed after answer text');
    }
    if (options.requireTableRowEvidence) {
      validateTableRowEvidence(markdown, blockId, evidenceMarkers, options.tablePublicationMetadata);
    }
    return { type: 'answer_block', blockId, markdown, evidence };
  }

  function bindUnambiguousPriorEvidence(value, blocks) {
    const evidence = Array.isArray(value.evidence) ? [...value.evidence] : [];
    const provided = new Set(evidence.map(item => String(item?.marker || '')
      .replace(/^\[\[|\]\]$/g, '')));
    const referenced = new Set([...String(value.markdown || '').matchAll(/\[\[(\d{1,3})\]\]/g)]
      .map(match => match[1]));
    for (const marker of referenced) {
      if (provided.has(marker)) continue;
      const prior = blocks.flatMap(block => block.evidence || [])
        .filter(item => item.marker === marker);
      const identities = new Set(prior.map(item => JSON.stringify([
        item.paragraphId, item.sourceKey, item.textHash, item.quote
      ])));
      // Some models use article-wide citation numbering in later answer blocks.
      // Reuse only an already verified, unambiguous binding from THIS turn.
      // Unknown, conflicting, or unverified markers still fail normal validation.
      if (prior.length && identities.size === 1 &&
          prior.every(item => item.verification?.status === 'verified' &&
            item.verification.target?.quoteSpan &&
            item.verification.target.paragraphId === item.paragraphId &&
            item.verification.target.sourceKey === item.sourceKey &&
            item.verification.target.textHash === item.textHash)) {
        evidence.push({ ...prior[0] });
      }
    }
    return { ...value, evidence };
  }

  function createArticleChatNdjsonParser(options = {}) {
    const cloneRecord = value => JSON.parse(JSON.stringify(value));
    const snapshot = options.snapshot || { revision: 0, paragraphs: [] };
    const maximumBufferChars = Math.max(
      4096, Math.min(1024 * 1024, Number(options.maximumBufferChars) || 256 * 1024)
    );
    const blocks = [];
    const selectedSources = new Map((options.selectedCitationSources || [])
      .map(source => [String(source.id || ''), { ...source }]));
    function bindSelectedSources(value) {
      const sourceIds = [...new Set([...String(value?.markdown || '')
        .matchAll(/\[\[(S\d+)\]\]/g)].map(match => match[1]))];
      if (!sourceIds.length) return value;
      let markdown = String(value.markdown);
      const numericReferences = new Set([...markdown.matchAll(/\[\[(\d{1,3})\]\]/g)]
        .map(match => match[1]));
      // Fixed selection handles carry their own trusted source binding. Some
      // providers also recopy unused evidence metadata; it is not a citation.
      // Keep every actually referenced numeric source under the normal strict
      // validator, and never replace it with an unrelated fixed handle.
      const evidence = (Array.isArray(value.evidence) ? value.evidence : [])
        .filter(item => numericReferences.has(String(item?.marker || '')
          .replace(/^\[\[|\]\]$/g, ''))).map(item => ({ ...item }));
      const reserved = new Set([
        ...[...markdown.matchAll(/\[\[(\d{1,3})\]\]/g)].map(match => match[1]),
        ...evidence.map(item => String(item.marker || ''))
      ]);
      for (const id of sourceIds) {
        const source = selectedSources.get(id);
        if (!source) throw invalidStreamResponse('Unknown selected-source citation handle');
        let number = 1;
        while (reserved.has(String(number))) number += 1;
        if (number > 999) throw invalidStreamResponse('Too many citation markers');
        const marker = String(number);
        reserved.add(marker);
        markdown = markdown.replaceAll(`[[${id}]]`, `[[${marker}]]`);
        evidence.push({ marker, paragraph_id: source.paragraph_id,
          source_key: source.source_key, text_hash: source.text_hash, quote: source.quote });
      }
      return { ...value, markdown, evidence };
    }
    const blockIds = new Map();
    const blockFingerprints = new Set();
    let buffer = '';
    let summary = '';
    let final = null;
    let usage = null;

    function emit(record) {
      try { options.onRecord?.(cloneRecord(record)); } catch { /* UI progress must not break parsing. */ }
    }

    function processRecord(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidStreamResponse();
      }
      if (value.type === 'answer_block') {
        const block = validateArticleChatAnswerBlock(
          bindUnambiguousPriorEvidence(bindSelectedSources(value), blocks), snapshot, options
        );
        const fingerprint = stableFingerprint([
          block.markdown,
          block.evidence.map(item => [
            item.marker, item.paragraphId, item.sourceKey, item.textHash, item.quote
          ])
        ]);
        if (blockIds.has(block.blockId)) {
          if (blockIds.get(block.blockId) !== fingerprint) {
            throw invalidStreamResponse('Article chat cannot replace an accepted block');
          }
          return null;
        }
        blockIds.set(block.blockId, fingerprint);
        if (blockFingerprints.has(fingerprint)) return null;
        blockFingerprints.add(fingerprint);
        blocks.push(block);
        try { options.onBlock?.(cloneRecord(block)); } catch { /* UI progress must not break parsing. */ }
        emit(block);
        return cloneRecord(block);
      }
      if (value.type === 'turn_summary') {
        const normalized = normalizeNarrativeValue(value.summary, 2000);
        if (!normalized) throw invalidStreamResponse('Article chat turn summary is empty');
        summary = normalized;
        const record = { type: 'turn_summary', summary };
        emit(record);
        return record;
      }
      if (value.type === 'usage') {
        usage = {
          inputTokens: Math.max(0, Number(value.input_tokens || value.inputTokens) || 0),
          outputTokens: Math.max(0, Number(value.output_tokens || value.outputTokens) || 0),
          cacheHitTokens: Math.max(0, Number(value.cache_hit_tokens || value.cacheHitTokens) || 0)
        };
        const record = { type: 'usage', usage };
        emit(record);
        return record;
      }
      if (value.type === 'final') {
        const status = value.status === 'truncated' ? 'truncated' : 'completed';
        final = { type: 'final', status };
        emit(final);
        return final;
      }
      throw invalidStreamResponse('Article chat stream record type is unsupported');
    }

    function processLine(line) {
      const text = String(line || '').trim();
      if (!text) return null;
      if (/^```(?:jsonl?|ndjson)?\s*$/i.test(text) || text === '```') return null;
      let value;
      try { value = JSON.parse(text); } catch {
        throw invalidStreamResponse('Article chat stream line is malformed JSON');
      }
      return processRecord(value);
    }

    function compatibleJsonRoots(value) {
      const source = String(value || '').trim()
        .replace(/^```(?:jsonl?|ndjson)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      if (!source || source.length > maximumBufferChars) return [];
      try {
        return [JSON.parse(source)];
      } catch {
        const roots = [];
        let start = -1;
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = 0; index < source.length; index += 1) {
          const character = source[index];
          if (start < 0) {
            if (/\s/.test(character)) continue;
            if (character !== '{' && character !== '[') return [];
            start = index;
            depth = 1;
            continue;
          }
          if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
            continue;
          }
          if (character === '"') {
            quoted = true;
          } else if (character === '{' || character === '[') {
            depth += 1;
          } else if (character === '}' || character === ']') {
            depth -= 1;
            if (depth < 0) return [];
            if (depth === 0) {
              try { roots.push(JSON.parse(source.slice(start, index + 1))); } catch { return []; }
              start = -1;
            }
          }
        }
        return start < 0 && !quoted ? roots : [];
      }
    }

    function compatibleRecords(root) {
      if (Array.isArray(root)) return root;
      if (!root || typeof root !== 'object') return [];
      if (root.type) return [root];
      if (Array.isArray(root.records)) return root.records;
      return [];
    }

    return {
      push(value) {
        buffer += String(value || '');
        if (buffer.length > maximumBufferChars) {
          throw invalidStreamResponse('Article chat NDJSON buffer exceeded its limit');
        }
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary).replace(/\r$/, '');
          buffer = buffer.slice(boundary + 1);
          processLine(line);
        }
      },
      finish() {
        const pending = buffer.trim();
        buffer = '';
        if (!pending) return true;
        try {
          const value = JSON.parse(pending);
          processRecord(value);
          return true;
        } catch (error) {
          if (error?.code === 'INVALID_RESPONSE') throw error;
          return false;
        }
      },
      consumeCompatiblePayload(value) {
        const roots = compatibleJsonRoots(value);
        if (!roots.length) return false;
        const records = roots.flatMap(compatibleRecords);
        if (!records.length) return false;
        records.forEach(processRecord);
        return Boolean(final && blocks.length);
      },
      discardPending() {
        const discarded = buffer.length;
        buffer = '';
        return discarded;
      },
      clearFinalRecord() {
        final = null;
      },
      hasPending() { return Boolean(buffer); },
      snapshot() {
        return {
          blocks: blocks.map(cloneRecord),
          summary,
          usage: usage ? { ...usage } : null,
          final: final ? { ...final } : null,
          pendingCharacters: buffer.length
        };
      }
    };
  }

  return {
    ARTICLE_CHAT_MAX_EVIDENCE_PER_BLOCK,
    createMarkdownBlockStreamCoalescer,
    createBlockStreamCoalescer: createMarkdownBlockStreamCoalescer,
    validateArticleChatAnswerBlock,
    createArticleChatNdjsonParser
  };
});
