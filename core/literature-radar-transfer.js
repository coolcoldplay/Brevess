(function(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(
    common ? require('./literature-radar-model.js') : root.BrevessRadar,
    common ? require('./library-transfer.js') : root.BrevessLibraryTransfer
  );
  if (common) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function(m, t) {
  'use strict';
  const fail = t.transferError;
  const clone = t.clone;
  const RADAR_TRANSFER_KIND = 'radar';
  const ARTICLE_KEYS = [
    'id', 'title', 'journal', 'createdDay', 'publicationDate', 'authors', 'doi', 'url',
    'firstSeenAt', 'isBaseline', 'read', 'abstractSections', 'abstractStatus',
    'abstractCopyright', 'abstractSource', 'abstractError', 'abstractFetchedAt',
    'abstractAttemptAt'
  ];
  const REVISION_KEYS = [
    'number', 'query', 'baselineDays', 'createdAt', 'windowStart', 'baselineAt', 'lastSuccessAt',
    'lastAttemptAt', 'nextRetryAt', 'lastNewCount', 'warnings', 'queryTranslation', 'error'
  ];
  function normalizeQuery(value) {
    return t.normalize(value).toLowerCase();
  }
  function sanitizeArticle(article = {}) {
    const result = {};
    for (const key of ARTICLE_KEYS) if (article[key] !== undefined) result[key] = clone(article[key]);
    result.id = t.normalizePmid(article.id);
    result.title = t.sanitizeString(article.title, 4000);
    result.journal = t.sanitizeString(article.journal, 500);
    result.doi = t.sanitizeString(article.doi, 500);
    result.url = t.sanitizeString(article.url, 2000);
    result.authors = (Array.isArray(article.authors) ? article.authors : [])
      .map(author => t.sanitizeString(author, 200)).filter(Boolean).slice(0, 30);
    result.read = article.read === true;
    result.isBaseline = article.isBaseline === true;
    if (Array.isArray(article.abstractSections)) {
      result.abstractSections = article.abstractSections.slice(0, 40).map(section => ({
        label: t.sanitizeString(section?.label, 200),
        text: t.sanitizeString(section?.text, 30000)
      })).filter(section => section.text);
    }
    return result;
  }
  function sanitizeRevision(revision = {}, includeArticles = true) {
    const result = {};
    for (const key of REVISION_KEYS) if (revision[key] !== undefined) result[key] = clone(revision[key]);
    result.query = t.sanitizeString(revision.query, 4000);
    result.baselineDays = revision.baselineDays;
    result.warnings = t.sanitizeStringArray(revision.warnings, 20, 1200);
    result.articles = includeArticles
      ? (Array.isArray(revision.articles) ? revision.articles : []).slice(0, 5000).map(sanitizeArticle)
      : [];
    return result;
  }
  function sanitizeRadar(radar, includeRevisions = true) {
    const result = {
      id: radar.id,
      name: t.sanitizeString(radar.name, 120),
      source: radar.source,
      query: t.sanitizeString(radar.query, 4000),
      enabled: radar.enabled === true,
      intervalHours: radar.intervalHours,
      baselineDays: radar.baselineDays,
      editVersion: radar.editVersion,
      createdAt: radar.createdAt,
      updatedAt: radar.updatedAt,
      revisions: (Array.isArray(radar.revisions) ? radar.revisions : [])
        .map(revision => sanitizeRevision(revision, includeRevisions))
    };
    return result;
  }
  function payloadState(payload) {
    return { schema: 1, radars: payload.radars, active: null };
  }
  function validateRadarTransfer(bundle) {
    const value = t.validateEnvelope(bundle, { expectedKind: RADAR_TRANSFER_KIND });
    if (!t.plain(value.payload) || !Array.isArray(value.payload.radars) ||
        value.payload.radars.length > 50) throw fail('RADAR_TRANSFER_INVALID', 'radar transfer payload 无效。');
    try {
      m.validateRadarState(payloadState(value.payload));
    } catch (error) {
      throw fail('RADAR_TRANSFER_INVALID', error.message || 'radar transfer state 无效。', {
        causeCode: error.code || null
      });
    }
    for (const radar of value.payload.radars) {
      if (!Array.isArray(radar.revisions) || !radar.revisions.length ||
          radar.revisions.some(revision => !Array.isArray(revision.articles))) {
        throw fail('RADAR_TRANSFER_INVALID', 'radar revisions/articles 无效。');
      }
      for (const revision of radar.revisions) {
        for (const article of revision.articles) {
          if (typeof article.id !== 'string' || !/^\d{5,12}$/u.test(article.id) ||
              typeof article.title !== 'string') {
            throw fail('RADAR_TRANSFER_ARTICLE_INVALID', 'radar 论文身份无效。');
          }
        }
      }
    }
    return value;
  }
  function exportRadarTransfer(state, { radarIds = null, includeRevisions = true, now = Date.now } = {}) {
    m.validateRadarState(state);
    const selected = radarIds === null ? state.radars : (() => {
      const ids = new Set(radarIds);
      return state.radars.filter(radar => ids.has(radar.id));
    })();
    const at = typeof now === 'function' ? now() : now;
    return t.makeEnvelope({
      kind: RADAR_TRANSFER_KIND,
      generatedAt: new Date(at).toISOString(),
      source: { app: 'brevess', radarStateSchema: 1 },
      payload: { radars: selected.map(radar => sanitizeRadar(radar, includeRevisions)) }
    });
  }
  function radarMatch(state, incoming) {
    const query = normalizeQuery(incoming.query);
    return state.radars.find(radar => radar.source === incoming.source &&
      normalizeQuery(radar.query) === query && radar.baselineDays === incoming.baselineDays);
  }
  function mergeArticles(target, incoming, warnings) {
    const byId = new Map(target.map(article => [article.id, article]));
    for (const raw of incoming) {
      const article = sanitizeArticle(raw);
      const existing = byId.get(article.id);
      if (existing) {
        existing.read = existing.read === true || article.read === true;
        for (const [key, value] of Object.entries(article)) {
          if (existing[key] === undefined || existing[key] === null || existing[key] === '') existing[key] = value;
        }
        continue;
      }
      target.push(article);
      byId.set(article.id, article);
    }
    return warnings;
  }
  function mergeRadarTransfer(state, bundle, { now = Date.now } = {}) {
    const current = clone(state);
    m.validateRadarState(current);
    const value = validateRadarTransfer(bundle);
    const warnings = [], conflicts = [];
    const summary = { matched: 0, created: 0, articlesAdded: 0, articlesMerged: 0 };
    const usedIds = new Set(current.radars.map(radar => radar.id));
    for (const raw of value.payload.radars) {
      const incoming = sanitizeRadar(raw, true);
      const sameId = current.radars.find(radar => radar.id === incoming.id);
      if (sameId && normalizeQuery(sameId.query) !== normalizeQuery(incoming.query)) {
        conflicts.push({ type: 'radar-id-query-conflict', id: incoming.id });
        warnings.push(`RADAR_TRANSFER_QUERY_CONFLICT:${incoming.id}`);
        continue;
      }
      let target = radarMatch(current, incoming);
      if (!target) {
        let id = incoming.id;
        if (!id || usedIds.has(id)) id = `radar-${crypto.randomUUID()}`;
        usedIds.add(id);
        target = {
          ...incoming,
          id,
          editVersion: Math.max(1, Number(incoming.editVersion) || 1),
          revisions: incoming.revisions.map((revision, index) => ({
            ...revision,
            number: index + 1,
            query: incoming.query,
            baselineDays: incoming.baselineDays
          }))
        };
        current.radars.push(target);
        summary.created += 1;
        continue;
      }
      summary.matched += 1;
      if (target.enabled !== incoming.enabled || target.intervalHours !== incoming.intervalHours) {
        warnings.push(`RADAR_TRANSFER_CONFIG_PRESERVED:${target.id}`);
      }
      for (const revision of incoming.revisions) {
        let destination = target.revisions.find(row => row.number === revision.number);
        if (destination && normalizeQuery(destination.query) !== normalizeQuery(revision.query)) {
          conflicts.push({ type: 'radar-revision-query-conflict', id: target.id, revision: revision.number });
          warnings.push(`RADAR_TRANSFER_REVISION_CONFLICT:${target.id}:${revision.number}`);
          continue;
        }
        if (!destination) {
          revision.number = target.revisions.length + 1;
          revision.query = target.query;
          revision.baselineDays = target.baselineDays;
          revision.articles = [];
          target.revisions.push(revision);
        }
        destination = destination || target.revisions[target.revisions.length - 1];
        const before = destination.articles.length;
        mergeArticles(destination.articles, revision.articles, warnings);
        const added = destination.articles.length - before;
        summary.articlesAdded += added;
        summary.articlesMerged += revision.articles.length - added;
      }
      const at = typeof now === 'function' ? now() : now;
      target.updatedAt = new Date(at).toISOString();
    }
    m.validateRadarState(current);
    return { state: current, warnings: [...new Set(warnings)], conflicts, summary };
  }
  function createRadarTransferService({ store, now = Date.now, audit = () => {} } = {}) {
    if (!store?.read || !store?.transact) throw fail('RADAR_TRANSFER_STORE_REQUIRED');
    async function exportBundle(options = {}) {
      const state = await store.read();
      const bundle = exportRadarTransfer(state, { ...options, now: now() });
      try { audit({ action: 'export', kind: RADAR_TRANSFER_KIND, digest: bundle.integrity.digest, at: new Date(now()).toISOString() }); }
      catch (_) {}
      return bundle;
    }
    async function importBundle(bundle, { idempotencyKey, expectedTransferRevision } = {}) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
        throw fail('RADAR_TRANSFER_IDEMPOTENCY_REQUIRED', 'radar import 需要 8–160 字符 idempotencyKey。');
      }
      if (['__proto__', 'constructor', 'prototype'].includes(idempotencyKey)) {
        throw fail('RADAR_TRANSFER_IDEMPOTENCY_REQUIRED', 'idempotencyKey 不能使用原型属性名。');
      }
      if (expectedTransferRevision !== undefined &&
          (!Number.isSafeInteger(expectedTransferRevision) || expectedTransferRevision < 0)) {
        throw fail('RADAR_TRANSFER_REVISION_INVALID');
      }
      const validated = validateRadarTransfer(bundle);
      const bundleDigest = validated.integrity.digest;
      let auditRecord;
      const result = await store.transact(state => {
        const current = state || m.emptyRadarState();
        const transfer = current.transfer && typeof current.transfer === 'object'
          ? current.transfer
          : { revision: 0, audit: [], idempotency: {} };
        const cached = transfer.idempotency?.[idempotencyKey];
        if (cached && cached.digest === bundleDigest) {
          return { ...cached.result, idempotent: true };
        }
        if (expectedTransferRevision !== undefined && transfer.revision !== expectedTransferRevision) {
          throw fail('RADAR_TRANSFER_REVISION_CONFLICT', 'radar transfer revision 已变化。');
        }
        const merged = mergeRadarTransfer(current, validated, { now: now() });
        transfer.revision = (Number.isSafeInteger(transfer.revision) ? transfer.revision : 0) + 1;
        const receipt = {
          kind: RADAR_TRANSFER_KIND,
          digest: bundleDigest,
          transferRevision: transfer.revision,
          warnings: merged.warnings,
          conflicts: merged.conflicts,
          summary: merged.summary
        };
        transfer.idempotency ||= {};
        transfer.idempotency[idempotencyKey] = { digest: bundleDigest, result: receipt, at: now() };
        transfer.idempotency = Object.fromEntries(Object.entries(transfer.idempotency).slice(-32));
        transfer.audit = [...(Array.isArray(transfer.audit) ? transfer.audit : []), {
          action: 'import', kind: RADAR_TRANSFER_KIND, digest: bundleDigest,
          idempotencyHash: t.digest(idempotencyKey), at: new Date(now()).toISOString(), summary: merged.summary
        }].slice(-100);
        merged.state.transfer = transfer;
        m.validateRadarState(merged.state);
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, merged.state);
        auditRecord = { action: 'import', kind: RADAR_TRANSFER_KIND, digest: bundleDigest,
          transferRevision: transfer.revision, summary: merged.summary };
        return receipt;
      });
      try { if (auditRecord) audit(auditRecord); } catch (_) {}
      return result;
    }
    return { export: exportBundle, import: importBundle };
  }
  return {
    RADAR_TRANSFER_KIND,
    sanitizeArticle,
    sanitizeRevision,
    sanitizeRadar,
    validateRadarTransfer,
    exportRadarTransfer,
    mergeRadarTransfer,
    createRadarTransferService
  };
});
