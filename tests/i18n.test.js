const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeInterfaceLanguage,
  translateInterfaceText
} = require('../core/i18n.js');

test('normalizes the global language and translates known interface text', () => {
  assert.equal(normalizeInterfaceLanguage('en-US'), 'en');
  assert.equal(normalizeInterfaceLanguage('zh-CN'), 'zh-CN');
  assert.equal(translateInterfaceText('  分析模式  ', 'en'), '  Analysis modes  ');
  assert.equal(translateInterfaceText('用户自定义类别', 'en'), '用户自定义类别');
});
