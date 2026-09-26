(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const RESEARCH_EVIDENCE_VERSION = '2';
  const TYPE_ALIASES = Object.freeze({
    b: 'background', background: 'background',
    k: 'known_mechanism', known_mechanism: 'known_mechanism',
    e: 'prior_evidence', prior_evidence: 'prior_evidence',
    x: 'knowledge_gap', knowledge_gap: 'knowledge_gap',
    g: 'rationale', rationale: 'rationale',
    r: 'result', result: 'result',
    q: 'question', question: 'question',
    h: 'hypothesis', hypothesis: 'hypothesis',
    a: 'author_aim', author_aim: 'author_aim'
  });
  const ROLES = new Set([
    'context', 'direct_evidence', 'indirect_evidence', 'association', 'intervention',
    'necessity', 'sufficiency', 'rescue', 'boundary', 'author_statement', 'unknown'
  ]);
  const DIRECTNESS = new Set([
    'same_cell_same_region', 'same_system', 'adjacent_system', 'external_system',
    'conceptual', 'not_applicable', 'unknown'
  ]);
  const ORIGINS = new Set(['author_explicit', 'brevess_reconstructed', 'legacy_unclassified']);
  const CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown']);
  const VERIFICATION = new Set(['verified', 'evidence_insufficient', 'ambiguous', 'stale']);
  const SECTION_PRIORITY = Object.freeze({
    abstract: 0, summary: 0, introduction: 1, background: 1,
    results: 2, result: 2, discussion: 3, conclusions: 3, conclusion: 3,
    figure: 4, figure_caption: 4, legend: 4
  });
  // A publisher's neutral Main section is usable note evidence, not a Results label.
  // Keep the broader body scope opt-in so other research tasks retain their input.
  const NOTE_SECTION_PRIORITY = Object.freeze({ ...SECTION_PRIORITY, main: 2, methods: 4 });

  function clean(value, maximum = 1600) {
    return String(value || '').normalize('NFKC')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
      .replace(/<[^>]*>/gu, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
      .replace(/\s+/gu, ' ').trim().slice(0, maximum);
  }

  function token(value) {
    return clean(value, 120).toLowerCase().replace(/[\s-]+/gu, '_');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function stableHash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function normalizeSourceRef(value) {
    if (!value || typeof value !== 'object') return null;
    const paragraphId = clean(value.paragraphId || value.paragraph_id, 240);
    const sourceIdentity = clean(value.sourceIdentity || value.source_identity, 360);
    const sourceKey = clean(value.sourceKey || value.source_key, 360);
    const textHash = clean(value.textHash || value.text_hash, 160);
    const quote = clean(value.quote, 360);
    if (!paragraphId && !sourceIdentity && !sourceKey && !quote) return null;
    return {
      paragraphId,
      sourceIdentity,
      sourceKey,
      textHash,
      quote,
      citationRefs: (Array.isArray(value.citationRefs || value.citation_refs)
        ? value.citationRefs || value.citation_refs : [])
        .map(item => clean(item, 80)).filter(Boolean).slice(0, 16),
      sectionPath: (Array.isArray(value.sectionPath || value.section_path)
        ? value.sectionPath || value.section_path : [])
        .map(item => clean(typeof item === 'string' ? item : item?.title, 180))
        .filter(Boolean).slice(0, 12),
      documentHash: clean(value.documentHash || value.document_hash, 160)
    };
  }

  function normalizeResearchEvidenceAtom(value) {
    if (!value || typeof value !== 'object') return null;
    const type = TYPE_ALIASES[token(value.type || value.atomType || value.atom_type)];
    const statement = clean(value.statement || value.text, 1200);
    if (!type || !statement) return null;
    const sourceRefs = (Array.isArray(value.sourceRefs || value.source_refs)
      ? value.sourceRefs || value.source_refs : [])
      .map(normalizeSourceRef).filter(Boolean).slice(0, 12);
    const verificationStatus = VERIFICATION.has(token(value.verificationStatus || value.verification_status))
      ? token(value.verificationStatus || value.verification_status)
      : (sourceRefs.length ? 'verified' : 'evidence_insufficient');
    if (!sourceRefs.length && verificationStatus === 'verified') return null;
    const originValue = token(value.origin);
    const roleValue = token(value.evidenceRole || value.evidence_role);
    const directnessValue = token(value.directness);
    const confidenceValue = token(value.confidence);
    const evidenceId = clean(value.evidenceId || value.evidence_id, 80) ||
      `${(Object.keys(TYPE_ALIASES).find(key => TYPE_ALIASES[key] === type && key.length === 1) || 'e').toUpperCase()}-${stableHash(`${type}|${statement}|${sourceRefs[0]?.sourceIdentity || ''}`)}`;
    return deepFreeze({
      evidenceId,
      type,
      statement,
      sourceRefs,
      evidenceRole: ROLES.has(roleValue) ? roleValue : 'unknown',
      directness: DIRECTNESS.has(directnessValue) ? directnessValue : 'unknown',
      origin: ORIGINS.has(originValue) ? originValue : 'brevess_reconstructed',
      confidence: CONFIDENCE.has(confidenceValue) ? confidenceValue : 'unknown',
      verificationStatus
    });
  }

  function normalizeResearchEvidenceSet(value) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
      const atom = normalizeResearchEvidenceAtom(raw);
      if (!atom) continue;
      const identity = atom.sourceRefs.map(ref => ref.sourceIdentity || ref.paragraphId || ref.sourceKey).join('|');
      const key = `${atom.type}|${atom.statement.toLowerCase()}|${identity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(atom);
      if (result.length >= 160) break;
    }
    return deepFreeze(result);
  }

  function normalizedSectionKind(record) {
    const explicit = token(record?.sectionKind || record?.recordType);
    const title = clean(record?.sectionTitle || record?.section || '', 240).toLowerCase();
    if (/abstract|summary|摘要/u.test(`${explicit} ${title}`)) return 'abstract';
    if (/introduction|background|引言|背景/u.test(`${explicit} ${title}`)) return 'introduction';
    if (/result|finding|结果/u.test(`${explicit} ${title}`)) return 'results';
    if (/discussion|conclusion|讨论|结论/u.test(`${explicit} ${title}`)) return 'discussion';
    if (/figure|legend|caption|图注/u.test(`${explicit} ${title}`)) return 'figure';
    if (/method|protocol|materials|方法/u.test(`${explicit} ${title}`)) return 'methods';
    return explicit || 'other';
  }

  function normalizeEvidenceRecord(record, documentHash, originalIndex, captionSource = false, noteBody = false) {
    if (!record || record.isTranslated || record.translated || record.presentationOnly) return null;
    const text = clean(record.text || record.canonicalText, 12000);
    if (!text) return null;
    const explicitKind = token(record.sectionKind);
    const sectionKind = captionSource ? 'figure' : noteBody && ['main', 'methods'].includes(explicitKind)
      ? explicitKind : normalizedSectionKind(record);
    if (!Object.hasOwn(noteBody ? NOTE_SECTION_PRIORITY : SECTION_PRIORITY, sectionKind)) return null;
    const paragraphId = clean(record.paragraphId, 240);
    const sourceIdentity = clean(record.sourceIdentity || record.sourceKey || paragraphId, 360);
    if (!paragraphId && !sourceIdentity) return null;
    return {
      paragraphId,
      sourceIdentity,
      sourceKey: clean(record.sourceKey || paragraphId, 360),
      textHash: clean(record.textHash, 160) || stableHash(text),
      sectionKind,
      sectionTitle: clean(record.sectionTitle || record.section, 240),
      sectionPath: (Array.isArray(record.sectionPath || record.headingPath)
        ? record.sectionPath || record.headingPath : [])
        .map(item => clean(typeof item === 'string' ? item : item?.title, 180)).filter(Boolean).slice(0, 12),
      text,
      documentHash: clean(documentHash, 160),
      originalIndex
    };
  }

  function publicEvidenceRecord(record, maximumText = 12000) {
    return {
      paragraphId: clean(record.paragraphId, 240),
      sourceIdentity: clean(record.sourceIdentity, 360),
      sourceKey: clean(record.sourceKey, 360),
      textHash: clean(record.textHash, 160),
      sectionKind: ['main', 'methods'].includes(record.sectionKind) ? record.sectionKind : normalizedSectionKind(record),
      sectionTitle: clean(record.sectionTitle, 240),
      sectionPath: (Array.isArray(record.sectionPath) ? record.sectionPath : [])
        .map(item => clean(typeof item === 'string' ? item : item?.title, 180))
        .filter(Boolean).slice(0, 12),
      text: clean(record.text, maximumText),
      documentHash: clean(record.documentHash, 160)
    };
  }

  function selectBalancedEvidenceRecords(records, maximum, noteBody = false) {
    const priority = noteBody ? NOTE_SECTION_PRIORITY : SECTION_PRIORITY;
    const seen = new Set();
    const buckets = new Map();
    records.forEach((record, index) => {
      const duplicateKey = `${record.sourceIdentity}|${record.textHash}`;
      if (!record.text || seen.has(duplicateKey)) return;
      seen.add(duplicateKey);
      const sectionKind = noteBody && ['main', 'methods'].includes(record.sectionKind)
        ? record.sectionKind : normalizedSectionKind(record);
      if (!Object.hasOwn(priority, sectionKind)) return;
      if (!buckets.has(sectionKind)) buckets.set(sectionKind, []);
      buckets.get(sectionKind).push({ ...record, sectionKind, originalIndex: record.originalIndex ?? index });
    });
    const kinds = [...buckets.keys()].sort((left, right) =>
      priority[left] - priority[right]);
    const cursors = Object.fromEntries(kinds.map(kind => [kind, 0]));
    const selected = [];
    let used = 0;
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const kind of kinds) {
        const bucket = buckets.get(kind);
        const record = bucket[cursors[kind]];
        if (!record) continue;
        remaining = true;
        cursors[kind] += 1;
        const base = publicEvidenceRecord(record, 12000);
        const available = Math.max(0, maximum - used - 1);
        if (available < 320) continue;
        let serialized = JSON.stringify(base);
        let accepted = base;
        if (serialized.length > available) {
          const overhead = serialized.length - base.text.length;
          const textBudget = Math.max(0, available - overhead - 8);
          if (textBudget < 160) continue;
          accepted = publicEvidenceRecord(record, textBudget);
          serialized = JSON.stringify(accepted);
        }
        if (serialized.length > available) continue;
        used += serialized.length + 1;
        selected.push({ ...accepted, originalIndex: record.originalIndex });
      }
    }
    return selected.sort((left, right) =>
      priority[left.sectionKind] - priority[right.sectionKind] ||
      left.originalIndex - right.originalIndex);
  }

  const HTML_FINDINGS_POLICY_ID = 'html-basic-main-findings-v1';

  function captionFirstSelection(records, maximum, noteBody = false) {
    const selected = [];
    let used = 0;
    for (const record of records.filter(item => item.captionSource)) {
      if (record.captionTooLong) continue;
      const candidate = { ...publicEvidenceRecord(record), sectionKind: 'figure' };
      const size = JSON.stringify(candidate).length + 1;
      if (used + size > maximum) continue;
      selected.push(candidate); used += size;
    }
    return selected.concat(selectBalancedEvidenceRecords(
      records.filter(record => !record.captionSource), Math.max(0, maximum - used), noteBody
    ));
  }

  function evidenceDocumentFromRecords(
    records, documentHash, maximum, totalRecordCount, title = '', captionIds = null, noteBody = false
  ) {
    const normalizedTitle = clean(title, 1000);
    const titleRecord = JSON.stringify({ documentTitle: normalizedTitle });
    const selected = captionIds ? captionFirstSelection(records,
      Math.max(0, maximum - titleRecord.length - 1), noteBody) : selectBalancedEvidenceRecords(
        records, Math.max(4000, maximum - titleRecord.length - 1), noteBody);
    const publicRecords = selected.map(({ originalIndex, ...record }) => record);
    const stableText = [titleRecord, ...publicRecords.map(record => JSON.stringify(record))]
      .join('\n');
    const completeCaptionIds = captionIds?.filter(id =>
      publicRecords.some(record => record.paragraphId === id)) || [];
    const missingCaptionIds = captionIds?.filter(id => !completeCaptionIds.includes(id)) || [];
    return deepFreeze({
      version: RESEARCH_EVIDENCE_VERSION,
      title: normalizedTitle,
      documentHash: clean(documentHash, 160),
      records: publicRecords,
      stableText,
      signature: stableHash(`${RESEARCH_EVIDENCE_VERSION}|${captionIds ? `${HTML_FINDINGS_POLICY_ID}|` : ''}${stableText}`),
      characterCount: stableText.length,
      truncated: publicRecords.length < totalRecordCount,
      ...(noteBody ? { evidencePurpose: 'literature-note', sourceKind: 'html-canonical' } : {}),
      ...(captionIds ? {
        noteEvidencePolicyId: HTML_FINDINGS_POLICY_ID, sourceKind: 'html-canonical',
        captionCoverage: { complete: captionIds.length > 0 && missingCaptionIds.length === 0,
          allParagraphIds: captionIds, completeParagraphIds: completeCaptionIds,
          missingParagraphIds: missingCaptionIds }
      } : {})
    });
  }

  function buildResearchEvidenceDocument(snapshot, options = {}) {
    const source = Array.isArray(snapshot?.paragraphs) ? snapshot.paragraphs : [];
    const policy = options.noteEvidencePolicy;
    const noteBody = options.evidencePurpose === 'literature-note' && snapshot?.sourceKind === 'html-canonical';
    const captionFirst = snapshot?.sourceKind === 'html-canonical' &&
      policy?.id === HTML_FINDINGS_POLICY_ID && policy.sourceKind === 'html-canonical' &&
      policy.maxSources === 32 && policy.captionFirst === true;
    const maximum = Math.min(captionFirst ? 128000 : Infinity,
      Math.max(4000, Number(options.maxCharacters) || 36000));
    const records = source.map((record, index) => {
      if (captionFirst && record?.documentHash && record.documentHash !== snapshot.documentHash) {
        const error = new Error('Research evidence document identity is inconsistent');
        error.code = 'RESEARCH_EVIDENCE_IDENTITY_CONFLICT'; throw error;
      }
      const captionSource = captionFirst && token(record?.recordType || record?.kind) === 'figure_caption';
      const normalized = normalizeEvidenceRecord(record, snapshot?.documentHash, index, captionSource, noteBody);
      if (normalized && captionSource) {
        normalized.captionSource = true;
        normalized.captionTooLong = clean(record.text || record.canonicalText, 12001).length > 12000;
      }
      return normalized;
    }).filter(Boolean);
    if (captionFirst) {
      const ids = new Set();
      for (const record of records) {
        if (!record.paragraphId || ids.has(record.paragraphId)) {
          const error = new Error('Research evidence paragraph identity is ambiguous');
          error.code = 'RESEARCH_EVIDENCE_IDENTITY_CONFLICT'; throw error;
        }
        ids.add(record.paragraphId);
      }
    }
    return evidenceDocumentFromRecords(
      records, snapshot?.documentHash, maximum, records.length, snapshot?.title,
      captionFirst ? records.filter(record => record.captionSource).map(record => record.paragraphId) : null, noteBody
    );
  }

  function compactResearchEvidenceDocument(document, options = {}) {
    const source = Array.isArray(document?.records) ? document.records : [];
    const noteBody = document?.evidencePurpose === 'literature-note' && document.sourceKind === 'html-canonical';
    const captionIds = document?.noteEvidencePolicyId === HTML_FINDINGS_POLICY_ID &&
      document.sourceKind === 'html-canonical' && Array.isArray(document.captionCoverage?.allParagraphIds)
      ? document.captionCoverage.allParagraphIds : null;
    const maximum = Math.min(captionIds ? 36000 : Infinity,
      Math.max(4000, Number(options.maxCharacters) || 18000));
    const records = source.map((record, index) => ({
      ...publicEvidenceRecord(record), originalIndex: index,
      ...(captionIds ? { captionSource: captionIds.includes(record.paragraphId) } : {})
    })).filter(record => record.text && (record.paragraphId || record.sourceIdentity));
    return evidenceDocumentFromRecords(
      records, document?.documentHash, maximum, records.length, document?.title, captionIds, noteBody
    );
  }

  return {
    RESEARCH_EVIDENCE_VERSION,
    normalizeResearchEvidenceAtom,
    normalizeResearchEvidenceSet,
    buildResearchEvidenceDocument,
    compactResearchEvidenceDocument
  };
});
