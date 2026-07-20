const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeBuiltInRegexRules } = require('../core/regex-policy.js');

test('removes ambiguous standalone causal cues from previously saved built-in rules', () => {
  const stored = {
    causality: {
      isBuiltIn: true,
      patterns: ['because', 'since', 'as', 'as a result', 'led to']
    }
  };
  const sanitized = sanitizeBuiltInRegexRules(stored);
  assert.deepEqual(sanitized.causality.patterns, ['because', 'as a result', 'led to']);
  assert.deepEqual(stored.causality.patterns, ['because', 'since', 'as', 'as a result', 'led to']);
});

test('does not rewrite a user-created causality rule', () => {
  const stored = {
    causality: { isBuiltIn: false, patterns: ['as', 'custom relation'] }
  };
  assert.deepEqual(sanitizeBuiltInRegexRules(stored).causality.patterns,
    ['as', 'custom relation']);
});
