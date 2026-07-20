const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'options.html'), 'utf8');
const script = readFileSync(join(root, 'options.js'), 'utf8');

test('renders a compatible provider preset selector that persists the selected preset', () => {
  assert.match(html, /id="compatiblePreset"/);
  assert.match(script, /function renderCompatiblePresetOptions\(\)/);
  assert.match(script, /function applyCompatiblePreset\(\)/);
  assert.match(script, /state\.compatibleProviderPresets/);
  assert.match(script, /config\.presetId/);
});

test('provider selection offers model suggestions while preserving free text input', () => {
  assert.match(html, /<input[^>]*id="model"[^>]*list="modelSuggestions"/);
  assert.match(html, /<datalist[^>]*id="modelSuggestions"/);
  assert.match(script, /function renderModelSuggestions\(/);
  assert.match(script, /definition\?\.models/);
  assert.match(script, /function handleProviderChange\(/);
  assert.match(script, /defaultModel/);
});

test('compatible preset editing is scoped to the selected profile and preserves masked keys', () => {
  assert.match(script, /selectedProfileId/);
  assert.match(script, /function collectProfile\(/);
  assert.match(script, /function renderProfileEditor\(/);
  assert.match(script, /apiKey.*value\.trim\(\)/);
  assert.match(script, /delete config\.apiKey|apiKey\.value\.trim/);
  assert.match(script, /supportsVision/);
});

test('provider switching recomputes vision capability instead of inheriting the previous profile', () => {
  assert.match(script, /function providerVisionCapability\(/);
  assert.match(script, /providerVisionCapability\(providerId, config\)/);
  const start = script.indexOf('function providerVisionCapability(');
  const end = script.indexOf('\n}', start) + 2;
  const source = script.slice(start, end);
  const context = {
    state: {
      providers: {
        openai: { supportsVision: true },
        deepseek: { supportsVision: false },
        'openai-compatible': { supportsVision: false }
      }
    }
  };
  vm.runInNewContext(`${source}\nglobalThis.result = [
    providerVisionCapability('openai', {}),
    providerVisionCapability('deepseek', {}),
    providerVisionCapability('openai-compatible', {}),
    providerVisionCapability('openai-compatible', { supportsVision: true })
  ];`, context);
  assert.deepEqual([...context.result], [true, false, false, true]);
  assert.match(script, /renderFigureRouteWarning[\s\S]*providerVisionCapability/);
});

test('new profiles default to registry vision capability and unknown providers are text-only', () => {
  const addStart = script.indexOf('async function addApiProfile(');
  const addEnd = script.indexOf('\n}', addStart) + 2;
  const addSource = script.slice(addStart, addEnd);
  assert.match(addSource, /providerVisionCapability\(providerId/);
  assert.doesNotMatch(addSource, /providerId !== ['"]openai-compatible['"]/);
});

test('Figure route warning follows the unsaved current-profile vision toggle', () => {
  const helperStart = script.indexOf('function providerVisionCapability(');
  const helperEnd = script.indexOf('\n}', helperStart) + 2;
  const profileStart = script.indexOf('function profileById(');
  const profileEnd = script.indexOf('\n}', profileStart) + 2;
  const warningStart = script.indexOf('function renderFigureRouteWarning(');
  const warningEnd = script.indexOf('\n}', warningStart) + 2;
  const elements = {
    routeFigure: { value: 'profile_gateway' },
    globalProfileId: { value: 'profile_gateway' },
    providerId: { value: 'openai-compatible' },
    supportsVision: { checked: false },
    routeFigureWarning: { hidden: true, textContent: '' }
  };
  const context = {
    state: { providers: { 'openai-compatible': { supportsVision: false } }, settings: {
      profiles: { profile_gateway: { providerId: 'openai-compatible', config: { supportsVision: false } } }
    } },
    selectedProfileId: 'profile_gateway',
    document: { getElementById(id) { return elements[id]; } }
  };
  vm.runInNewContext(`${script.slice(helperStart, helperEnd)}\n${script.slice(profileStart, profileEnd)}\n${script.slice(warningStart, warningEnd)}\nrenderFigureRouteWarning();`, context);
  assert.equal(elements.routeFigureWarning.hidden, false);
  elements.supportsVision.checked = true;
  vm.runInNewContext('renderFigureRouteWarning();', context);
  assert.equal(elements.routeFigureWarning.hidden, true);
});

test('unsaved profile navigation is blocked without confirm and duplicate actions are rejected', () => {
  const guardStart = script.indexOf('function canLeaveProfileEditor(');
  const guardEnd = script.indexOf('\n}', guardStart) + 2;
  const beginStart = script.indexOf('function beginProfileAction(');
  const beginEnd = script.indexOf('\n}', beginStart) + 2;
  const endStart = script.indexOf('function endProfileAction(');
  const endEnd = script.indexOf('\n}', endStart) + 2;
  const context = {
    profileEditorDirty: true,
    profileActionInFlight: {},
    window: {},
    showStatus() {}
  };
  vm.runInNewContext(`${script.slice(guardStart, guardEnd)}\n${script.slice(beginStart, beginEnd)}\n${script.slice(endStart, endEnd)}\nglobalThis.results = [canLeaveProfileEditor('switch'), beginProfileAction('duplicate'), beginProfileAction('duplicate')];`, context);
  assert.deepEqual([...context.results], [false, true, false]);
  vm.runInNewContext('endProfileAction(\'duplicate\'); globalThis.after = beginProfileAction(\'duplicate\');', context);
  assert.equal(context.after, true);
});

test('save guard always releases and test action handles a guarded save result', () => {
  const persistStart = script.indexOf('async function persistForm(');
  const persistEnd = script.indexOf('\nasync function testProvider', persistStart);
  const persistSource = script.slice(persistStart, persistEnd);
  assert.match(persistSource, /finally\s*\{[\s\S]*endProfileAction\(['"]save['"]\)/);
  assert.match(persistSource, /previousDisabledStates\s*=\s*new Map/);
  assert.match(persistSource, /previousDisabledStates\.get\(button\)/);
  const testStart = script.indexOf('async function testProvider(');
  const testEnd = script.indexOf('\nfunction friendlyError', testStart);
  const testSource = script.slice(testStart, testEnd);
  assert.match(testSource, /persistForm\(true\)/);
  assert.match(testSource, /if\s*\(!saved\)/);
  const beginStart = script.indexOf('function beginProfileAction(');
  const beginEnd = script.indexOf('\n}', beginStart) + 2;
  const endStart = script.indexOf('function endProfileAction(');
  const endEnd = script.indexOf('\n}', endStart) + 2;
  const context = { profileActionInFlight: {} };
  vm.runInNewContext(`${script.slice(beginStart, beginEnd)}\n${script.slice(endStart, endEnd)}\nglobalThis.first = beginProfileAction('test'); globalThis.second = beginProfileAction('test'); endProfileAction('test'); globalThis.third = beginProfileAction('test');`, context);
  assert.deepEqual([context.first, context.second, context.third], [true, false, true]);
});

test('compatible preset changes participate in profile dirty tracking', () => {
  const bindStart = script.indexOf('function bindEvents(');
  const bindEnd = script.indexOf('\nasync function callBackground', bindStart);
  const bindSource = script.slice(bindStart, bindEnd);
  const presetStart = script.indexOf('function applyCompatiblePreset(');
  const presetEnd = script.indexOf('\nfunction markCompatiblePresetCustom', presetStart);
  const presetSource = script.slice(presetStart, presetEnd);
  assert.match(bindSource, /compatiblePreset/);
  assert.match(bindSource, /markProfileEditorDirty/);
  assert.match(presetSource, /markProfileEditorDirty\(\)/);
});
