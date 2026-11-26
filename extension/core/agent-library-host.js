// Service-worker MCP host for browser-wide reads. Project operations continue
// to use the visible workbench and its existing task-specific approval scope.
(function (root) {
  'use strict';
  function createAgentLibraryHost(queryLocal) {
    const names = ['query_global_library', 'read_library_catalog'];
    let reader, catalog;
    function services() {
      if (!reader) {
        catalog = root.BrevessLibraryCatalog.createLibraryCatalogStore();
        reader = root.BrevessWorkbenchLibrary.createCatalogLibraryReader({
          adapter: {queryLibrary: queryLocal}, catalogStore: catalog,
          importStore: root.BrevessWorkbenchLibraryImport.createLibraryImportStore(),
          radarStore: root.BrevessRadar.createRadarStore()
        });
      }
      return {globalLibraryReader: reader, catalogActions: {read: () => catalog.read()}};
    }
    const host = {name: 'BREVESS', async execute(name, args, {signal} = {}) {
      if (name === 'brevess.status') return {ready:true, module:'library', projectId:null, revision:null, writeScope:null};
      if (name === 'brevess.capabilities') return {contractVersion:1, operations:root.BrevessWorkbenchOperations.WORKBENCH_OPERATIONS.filter(o => names.includes(o.name)), legacyOperations:[]};
      if (!names.includes(name)) throw Object.assign(new Error('请在一个课题工作台中选择目标后再执行此操作。'), {code:'WORKBENCH_CONTEXT_REQUIRED'});
      const result = await root.BrevessLibraryCatalogMcp.execute(name, args || {}, {...services(), signal});
      return result.data;
    }};
    root.BrevessMcpHost = host;
    return {status: () => root.BrevessMcpBridge.status(), command: async action => {
      const bridge = root.BrevessMcpBridge;
      if (action === 'disconnect') return bridge.disconnect();
      if (action === 'check') return bridge.probe();
      return bridge.connect();
    }};
  }
  Object.assign(root.SciLLM ||= {}, {createAgentLibraryHost});
})(globalThis);
