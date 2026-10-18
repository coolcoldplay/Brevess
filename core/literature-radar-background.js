(function(root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? Object.assign({}, require('./literature-radar-store.js'), require('./literature-radar-pubmed.js'), require('./literature-radar-service.js')) : root.BrevessRadar);
  if (common) module.exports = api;
  Object.assign(root.BrevessRadar ||= {}, api);
})(globalThis, function(m) {
  'use strict';
  const RADAR_ALARM = 'brevess-literature-radar-tick-v1';
  const installed = new WeakMap();
  function installRadarBackground({ chromeApi = globalThis.chrome, service, keepAlive = task => task, onError = error => console.warn('[literature-radar]', error.code || error.message) } = {}) {
    if (!chromeApi?.alarms?.onAlarm) return { available: false, ready: Promise.resolve() };
    if (installed.has(chromeApi)) return installed.get(chromeApi);
    if (!service) {
      const store = m.createRadarStore();
      service = m.createRadarService({ store, adapters: { pubmed: m.createPubMedRadarAdapter() } });
    }
    const tick = () => keepAlive(service.checkDue()).catch(onError);
    const ensure = async () => {
      const alarm = await chromeApi.alarms.get(RADAR_ALARM);
      if (!alarm) await chromeApi.alarms.create(RADAR_ALARM, { periodInMinutes: 1 });
      await tick();
    };
    // Register listeners synchronously at worker evaluation time; Chrome dispatches after this point.
    chromeApi.alarms.onAlarm.addListener(alarm => alarm.name === RADAR_ALARM ? tick() : undefined);
    chromeApi.runtime.onStartup.addListener(() => ensure().catch(onError));
    chromeApi.runtime.onInstalled.addListener(() => ensure().catch(onError));
    const runtime = { available: true, ready: ensure().catch(onError) };
    installed.set(chromeApi, runtime); return runtime;
  }
  return { RADAR_ALARM, installRadarBackground };
});
