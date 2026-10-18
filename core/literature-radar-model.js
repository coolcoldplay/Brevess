(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function() {
  'use strict';
  const DAY = 86400000;
  const RADAR_DATABASE = 'brevess-literature-radar-v1';
  const radarError = (code, message = code) => Object.assign(new Error(message), { code });
  const clone = value => structuredClone(value);
  const day = at => new Date(at).toISOString().slice(0, 10);
  function validateRadarConfig(value) {
    const fail = () => { throw radarError('RADAR_CONFIG', '请填写名称与 PubMed 检索式，并选择有效的回溯范围和频率。'); };
    if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
        typeof value.query !== 'string' || !value.query.trim() || value.query.length > 4000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.query) ||
        value.source !== 'pubmed' || !Number.isInteger(value.intervalHours) || value.intervalHours < 0 || value.intervalHours > 720 ||
        ![1, 7, 30, 90].includes(value.baselineDays) || typeof value.enabled !== 'boolean') fail();
    return { name: value.name.trim(), query: value.query.trim(), source: value.source,
      intervalHours: value.intervalHours, baselineDays: value.baselineDays, enabled: value.enabled };
  }
  function radarScanWindow(revision, at) {
    const endDay = day(at);
    const startDay = revision.lastSuccessAt
      ? day(revision.lastSuccessAt - 7 * DAY)
      : day(at - (revision.baselineDays - 1) * DAY);
    return { startDay: revision.windowStart && startDay < revision.windowStart ? revision.windowStart : startDay, endDay };
  }
  function radarRevision(radar) { return radar.revisions[radar.revisions.length - 1]; }
  function radarPaperTime(paper) { return paper.createdDay ? Date.parse(paper.createdDay) : paper.firstSeenAt; }
  function validateRadarState(value) {
    const fail = () => { throw radarError('RADAR_STATE_INVALID', '文献雷达本地数据版本或结构异常；原数据已保留，未覆盖。'); };
    if (!value || value.schema !== 1 || !Array.isArray(value.radars) || value.radars.length > 50) fail();
    const ids = new Set();
    for (const radar of value.radars) {
      if (!radar || typeof radar.id !== 'string' || !/^radar-[a-zA-Z0-9-]+$/.test(radar.id) || ids.has(radar.id) ||
          !Number.isSafeInteger(radar.editVersion) || radar.editVersion < 1 || !Array.isArray(radar.revisions) || !radar.revisions.length) fail();
      ids.add(radar.id);
      try { validateRadarConfig(radar); } catch { fail(); }
      radar.revisions.forEach((revision, i) => {
        if (revision.number !== i + 1 || typeof revision.query !== 'string' || !Array.isArray(revision.articles) ||
            ![1, 7, 30, 90].includes(revision.baselineDays) || !Array.isArray(revision.warnings)) fail();
        const papers = new Set();
        for (const paper of revision.articles) {
          if (!paper || !/^\d+$/.test(paper.id) || papers.has(paper.id) || typeof paper.title !== 'string' ||
              typeof paper.isBaseline !== 'boolean' || typeof paper.read !== 'boolean') fail();
          papers.add(paper.id);
        }
      });
    }
    if (value.active != null && (typeof value.active.owner !== 'string' || !Number.isFinite(value.active.expiresAt))) fail();
    return value;
  }
  function emptyRadarState() { return { schema: 1, radars: [], active: null }; }
  return { DAY, RADAR_DATABASE, radarError, radarClone: clone, radarDay: day, validateRadarConfig,
    radarScanWindow, radarRevision, radarPaperTime, validateRadarState, emptyRadarState };
});
