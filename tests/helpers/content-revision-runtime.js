const vm = require('node:vm');

const REVISION_MARKER =
  'document.documentElement.dataset.sciLlmContentRevision';
const MAX_REVISION_STATEMENT_LENGTH = 512;

function extractContentRevisionAssignment(source) {
  const script = String(source);
  const markerIndex = script.indexOf(REVISION_MARKER);
  if (markerIndex < 0) throw new Error('CONTENT_REVISION_ASSIGNMENT_MISSING');
  const statementStart = script.lastIndexOf('\n', markerIndex - 1) + 1;
  const statementEnd = script.indexOf(';', markerIndex);
  if (
    statementEnd < 0 ||
    statementEnd - statementStart + 1 > MAX_REVISION_STATEMENT_LENGTH
  ) {
    throw new Error('CONTENT_REVISION_ASSIGNMENT_INVALID');
  }
  return script.slice(statementStart, statementEnd + 1);
}

function executeContentRevisionAssignment(source) {
  const dataset = {};
  const document = { documentElement: { dataset } };
  vm.runInNewContext(
    extractContentRevisionAssignment(source),
    { document },
    {
      timeout: 100,
      contextCodeGeneration: { strings: false, wasm: false }
    }
  );
  return dataset.sciLlmContentRevision;
}

module.exports = { executeContentRevisionAssignment };
