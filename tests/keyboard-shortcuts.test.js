const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KEYBOARD_SHORTCUT_DEFINITIONS,
  DEFAULT_KEYBOARD_SHORTCUTS,
  normalizeKeyboardShortcutKey,
  normalizeKeyboardShortcuts,
  findKeyboardShortcutConflicts
} = require('../core/keyboard-shortcuts.js');

test('default shortcuts are unique and match every requested action', () => {
  assert.deepEqual(DEFAULT_KEYBOARD_SHORTCUTS, {
    figures: 'F',
    navigation: 'G',
    analysis: 'A',
    highlights: 'H',
    chat: 'Q',
    zotero: 'Z',
    ppt: 'P',
    scanLocal: 'R',
    saveLocal: 'S',
    deleteLocal: 'D',
    exportJson: 'E',
    importJson: 'I',
    settings: 'T',
    collapseFigurePanels: '0'
  });
  assert.equal(
    new Set(Object.values(DEFAULT_KEYBOARD_SHORTCUTS)).size,
    KEYBOARD_SHORTCUT_DEFINITIONS.length
  );
  assert.deepEqual(findKeyboardShortcutConflicts(DEFAULT_KEYBOARD_SHORTCUTS), []);
});

test('shortcut normalization accepts one letter or digit and preserves explicit disable', () => {
  assert.equal(normalizeKeyboardShortcutKey(' f '), 'F');
  assert.equal(normalizeKeyboardShortcutKey('０'), '0');
  assert.equal(normalizeKeyboardShortcutKey('F2', 'G'), 'G');
  const normalized = normalizeKeyboardShortcuts({
    figures: 'x',
    navigation: '',
    ppt: '7',
    unknown: 'K'
  });
  assert.equal(normalized.figures, 'X');
  assert.equal(normalized.navigation, '');
  assert.equal(normalized.ppt, '7');
  assert.equal(normalized.analysis, 'A');
  assert.equal(Object.hasOwn(normalized, 'unknown'), false);
});

test('shortcut conflicts report every action sharing one key', () => {
  assert.deepEqual(findKeyboardShortcutConflicts({
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    figures: 'P'
  }), [{
    key: 'P',
    actionIds: ['figures', 'ppt']
  }]);
});
