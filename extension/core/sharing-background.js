(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessSharingBackground = api;
})(globalThis, function () {
  'use strict';
  // No session/storage/network reads and no collaboration route registration.
  // Existing session/mapping keys remain untouched for future versions.
  const disabled = () => Promise.resolve({ok:false,error:{code:'CLOUD_FEATURE_UNAVAILABLE',message:'本版本未启用云协作。'}});
  return { createBridge: () => ({handle:disabled}), install: () => ({handle:disabled}) };
});
