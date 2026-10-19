const assert = require('node:assert/strict');
const vm = require('node:vm');

// Parse an actual function expression; do not include declarations between it
// and a distant marker function in a reduced VM/browser fixture.
function functionSource(source, name) {
  const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\(`, 'gm'))];
  assert.equal(matches.length, 1, `${name} has exactly one production declaration`);
  const start = matches[0].index;
  const endings = /}/g;
  endings.lastIndex = start;
  let ending;
  while ((ending = endings.exec(source))) {
    const candidate = source.slice(start, ending.index + 1);
    try {
      new vm.Script(`(${candidate})`);
      return candidate;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  assert.fail(`${name} has no complete function body`);
}

module.exports = { functionSource };
