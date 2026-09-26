const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptFile = path.join(__dirname, '..', 'scripts', 'verify-typesafe-highlighting.mjs');
const source = fs.readFileSync(scriptFile, 'utf8');
const optionsSource = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');

test('real TypeSafe browser verifier has no mock or replay success path', () => {
  assert.match(source, /readSecretFromTty/);
  assert.match(source, /mockOrReplayAllowed:\s*false/);
  assert.doesNotMatch(source, /--mock|--replay|mockResponse|fixtureResponse/u);
  assert.match(source, /https:\/\/api\.typesafe\.ai/);
  assert.match(source, /\/v1\/systemone/);
  assert.match(source, /\/v1\/models/);
});

test('real credential stays at the Node proxy boundary', () => {
  assert.match(source, /extensionCredential:\s*'fixed dummy only'/);
  assert.match(source, /realCredentialLocation:\s*'Node proxy memory only'/);
  assert.match(source, /Authorization:\s*`Bearer \$\{getSecret\(\)\}`/);
  assert.match(source, /request\.headers\.authorization !== `Bearer \$\{dummySecret\}`/);
  assert.match(source, /realSecret = ''/);
});

test('verifier requires real UI triggers and exact DOM grounding assertions', () => {
  assert.match(source, /locator\('#testProvider'\)\.click\(\)/);
  assert.match(source, /locator\('#refreshModels'\)\.click\(\)/);
  assert.match(source, /locator\('#applyHighlight'\)\.click\(\)/);
  assert.match(source, /mark\.sci-llm-highlight/);
  assert.match(source, /sourceSentences\.negative/);
  assert.match(source, /diagnostics\.stage, 'complete'/);
});

test('verifier preserves failed reports and enforces bounded official calls', () => {
  assert.match(source, /TYPESAFE_ACCEPTANCE_OUTPUT_EXISTS/);
  assert.match(source, /defaultCallCap = 60/);
  assert.match(source, /callCapRejected/);
  assert.match(source, /safeRemoveTemporary/);
  assert.match(source, /synthetic_ground_truth_only_not_a_scientific_benchmark/);
});

test('model discovery accepts official aliases before manually testing a versioned model', () => {
  assert.match(source, /\['jev-latest', 'jev-preview'\]\.includes\(model\)/);
  assert.match(source, /configuredModelWasManuallyEntered:\s*true/);
  assert.doesNotMatch(source, /discoveredModels\.includes\(configuredModel\)/);
  assert.match(source, /modelDiscoveryStatus'\)\?\.dataset\.state === 'success'/);
});

test('failure diagnostics persist stages and cleanup cannot hang indefinitely', () => {
  assert.match(source, /stageHistory/);
  assert.match(source, /report\.failedStage = report\.stage/);
  assert.match(source, /closeBrowserContextBounded/);
  assert.match(source, /closeServerBounded/);
  assert.match(source, /closeAllConnections/);
  assert.match(source, /process\.exit\(process\.exitCode \|\| 0\)/);
});

test('first-run onboarding uses real navigation and the TypeSafe routing shortcut', () => {
  assert.match(source, /options\.html#onboarding/);
  assert.match(source, /locator\('#onboardingBack'\)\.click\(\)/);
  assert.match(source, /locator\('\[data-settings-nav="models"\]'\)\.click\(\)/);
  assert.match(source, /locator\('#typesafeTaskRoutingLink'\)\.click\(\)/);
  assert.match(source, /locator\('#advancedTaskRouting > summary'\)\.click\(\)/);
  assert.match(source, /semanticOption\.exists && !semanticOption\.disabled/);
  assert.match(source, /advancedTaskRouting'\)\?\.open === true/);
  assert.match(source, /highlightRoute\.waitFor\(\{ state: 'visible' \}\)/);
  assert.doesNotMatch(source, /highlightRoute\.selectOption\([^\n]+force:/u);
  assert.match(optionsSource,
    /function revealTypesafeTaskRouting[\s\S]*if \(onboardingUi\.active\) leaveOnboardingLayout\(\)/);
});

test('failed browser runs capture a bounded credential-safe settings screenshot', () => {
  assert.match(source, /captureFailureScreenshotBounded/);
  assert.match(source, /settings-failure\.png/);
  assert.match(source, /extension contains the fixed dummy credential only/);
  assert.match(source, /report\.failureScreenshot = await captureFailureScreenshotBounded/);
});

test('report fingerprints the TypeSafe execution path and runtime algorithm version', () => {
  for (const file of [
    'core/jev-highlight.js', 'core/task-profile-router.js',
    'core/background-router.js', 'providers/provider-registry.js',
    'core/settings-store.js', 'core/provider-probes.js'
  ]) assert.ok(source.includes(`'${file}'`), `${file} hash missing`);
  assert.match(source, /JEV_HIGHLIGHT_ALGORITHM_VERSION/);
  assert.match(source, /registeredTaskVersion/);
  assert.match(source, /production service-worker SciLLM runtime/);
});
