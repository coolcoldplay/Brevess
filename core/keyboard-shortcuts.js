(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const KEYBOARD_SHORTCUT_DEFINITIONS = Object.freeze([
    Object.freeze({ actionId: 'figures', label: '进入解图模块', group: '模块切换', defaultKey: 'F' }),
    Object.freeze({ actionId: 'navigation', label: '打开导航模块', group: '模块切换', defaultKey: 'G' }),
    Object.freeze({ actionId: 'analysis', label: '打开亮文模块', group: '模块切换', defaultKey: 'A' }),
    Object.freeze({ actionId: 'highlights', label: '打开摘句模块', group: '模块切换', defaultKey: 'H' }),
    Object.freeze({ actionId: 'chat', label: '打开问答模块', group: '模块切换', defaultKey: 'Q' }),
    Object.freeze({ actionId: 'zotero', label: '导出到 Zotero', group: '导出与本地工作区', defaultKey: 'Z' }),
    Object.freeze({ actionId: 'ppt', label: '导出 PPT 材料包', group: '导出与本地工作区', defaultKey: 'P' }),
    Object.freeze({ actionId: 'scanLocal', label: '扫描本地并修复', group: '导出与本地工作区', defaultKey: 'R' }),
    Object.freeze({ actionId: 'saveLocal', label: '保存至本地', group: '导出与本地工作区', defaultKey: 'S' }),
    Object.freeze({ actionId: 'deleteLocal', label: '删除本地该网页内容', group: '导出与本地工作区', defaultKey: 'D' }),
    Object.freeze({ actionId: 'exportJson', label: '导出 JSON', group: '导出与本地工作区', defaultKey: 'E' }),
    Object.freeze({ actionId: 'importJson', label: '导入 JSON', group: '导出与本地工作区', defaultKey: 'I' }),
    Object.freeze({ actionId: 'settings', label: '打开设置', group: '其他', defaultKey: 'T' }),
    Object.freeze({ actionId: 'collapseFigurePanels', label: '折叠所有 Figure Panel', group: '解图模块', defaultKey: '0' })
  ]);

  const DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze(Object.fromEntries(
    KEYBOARD_SHORTCUT_DEFINITIONS.map(definition => [
      definition.actionId,
      definition.defaultKey
    ])
  ));

  function normalizeKeyboardShortcutKey(value, fallback = '') {
    const normalized = String(value ?? '').normalize('NFKC').trim().toUpperCase();
    if (!normalized) return '';
    return /^[A-Z0-9]$/.test(normalized) ? normalized : fallback;
  }

  function normalizeKeyboardShortcuts(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value : {};
    return Object.fromEntries(KEYBOARD_SHORTCUT_DEFINITIONS.map(definition => {
      const hasSavedValue = Object.prototype.hasOwnProperty.call(
        source,
        definition.actionId
      );
      return [
        definition.actionId,
        hasSavedValue
          ? normalizeKeyboardShortcutKey(
            source[definition.actionId],
            definition.defaultKey
          )
          : definition.defaultKey
      ];
    }));
  }

  function findKeyboardShortcutConflicts(value) {
    const normalized = normalizeKeyboardShortcuts(value);
    const byKey = new Map();
    KEYBOARD_SHORTCUT_DEFINITIONS.forEach(definition => {
      const key = normalized[definition.actionId];
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(definition.actionId);
    });
    return [...byKey.entries()]
      .filter(([, actionIds]) => actionIds.length > 1)
      .map(([key, actionIds]) => ({ key, actionIds: [...actionIds] }));
  }

  return {
    KEYBOARD_SHORTCUT_DEFINITIONS,
    DEFAULT_KEYBOARD_SHORTCUTS,
    normalizeKeyboardShortcutKey,
    normalizeKeyboardShortcuts,
    findKeyboardShortcutConflicts
  };
});
