const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(
  __dirname, '../scripts/verify-native-figure-targeted-live.mjs'
), 'utf8');

test('native targeted verifier keeps its default image Panel mode and gates text synthesis explicitly', () => {
  assert.match(script, /args\.indexOf\('--synthesis-source-dir'\)/);
  assert.match(script, /const synthesisMode = Boolean\(synthesisSourceDir\)/);
  assert.match(script, /if\(synthesisMode\)[\s\S]*compileFigureSynthesisPrompt/);
  assert.match(script, /else\{[\s\S]*validateFigurePanelBatch/);
  assert.match(script, /const images = tiles\.map/);
});

test('two-Figure native synthesis is text-only, ephemeral, bounded, and production-validated', () => {
  assert.match(script, /model:'gpt-5\.6-sol',reasoningEffort:'high',ephemeral:true/);
  assert.match(script, /userPrompt:compiled\.userPrompt,images:\[\],maxOutputTokens:30000/);
  assert.match(script, /hardNativeTurnCap:2,automaticRetries:0/);
  assert.match(script, /setTimeout\(\(\)=>\{send\([\s\S]*300000\)/);
  assert.match(script, /assertExactPartition\(raw,m\.plan\)/);
  assert.match(script, /validateFigureSynthesis\(raw,m\.requestInput,m\.panelEvidence/);
  assert.match(script, /repairResponse:false,requireCompletePanels:true/);
  assert.match(script, /realNativeTurns\+=1;assert\.ok\(report\.realNativeTurns<=2\)/);
});

test('native synthesis preserves all Panel hashes and writes DOM-compatible artifacts', () => {
  assert.match(script, /panelFileSha256:sha\(panelBytes\)/);
  assert.match(script, /panelHashes:Object\.fromEntries/);
  assert.match(script, /outputPanelHashes=Object\.fromEntries/);
  assert.match(script, /assert\.deepEqual\(result\.outputPanelHashes,result\.panelHashes\)/);
  assert.match(script, /fresh-panels-normalized-redacted\.json/);
  assert.match(script, /synthesis-normalized-redacted\.json/);
  assert.match(script, /reasoningAcceptedAsAnswer:false/);
  assert.match(script, /priorSynthesisAnswersIncluded:false/);
  assert.match(script, /effectiveModelReportedByBridge:false/);
});
