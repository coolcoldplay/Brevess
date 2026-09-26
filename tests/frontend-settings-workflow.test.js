const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'options.html'), 'utf8');
const script = readFileSync(join(root, 'options.js'), 'utf8');

function sourceOf(name, nextName) {
  const start = script.indexOf(`function ${name}(`);
  const end = script.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source is present`);
  return script.slice(start, end);
}

test('model settings put the connection workflow before advanced behavior and routing', () => {
  const profiles = html.indexOf('id="apiProfilesSettings"');
  const behavior = html.indexOf('id="analysisBehaviorSettings"');
  const routing = html.indexOf('id="taskRoutingSettings"');
  assert.ok(profiles > 0 && behavior > profiles && routing > behavior);
  assert.match(html, /<details[^>]*id="modelBehaviorAdvanced"/);
  assert.match(html, /<details[^>]*id="profileAdvancedSettings"/);
  assert.match(html, /id="providerConnectionActions"[\s\S]*id="saveSettings"[\s\S]*id="testProvider"/);
  assert.match(html, /id="providerConnectionStatus"[\s\S]*id="status"/);
});

test('task routing keeps common tasks first and all advanced tasks in an explicit disclosure', () => {
  assert.match(html, /id="llmTaskPolicyTableBody"/);
  assert.match(html, /<details[^>]*id="advancedTaskRouting"/);
  assert.match(html, /id="llmAdvancedTaskPolicyTableBody"/);
  assert.match(script, /COMMON_TASK_POLICY_IDS/);
  assert.match(script, /advancedBody\.appendChild\(row\)/);
  assert.match(script, /支持此输入/);
});

test('reading settings expose stable section navigation and a single-template editor', () => {
  for (const target of [
    'pdfMineruSettings', 'articleChatPromptSettings', 'literatureNoteTemplateSettings',
    'selectionLlmActionSettings', 'panelFollowupSettings'
  ]) {
    assert.match(html, new RegExp(`data-reading-settings-target="${target}"`));
  }
  assert.match(html, /id="literatureNoteTemplateSelector"/);
  assert.match(html, /id="literatureNoteTemplateNav"/);
});

test('switching note templates preserves every row value while exposing only the selected editor', () => {
  const rows = [
    {
      hidden: false,
      dataset: { literatureTemplateId: 'basic' },
      value: 'unsaved basic draft',
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return { focus() {} }; }
    },
    {
      hidden: false,
      dataset: { literatureTemplateId: 'clinical' },
      value: 'unsaved clinical draft',
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return { focus() {} }; }
    }
  ];
  const buttons = rows.map(row => ({
    dataset: { literatureTemplateTarget: row.dataset.literatureTemplateId },
    setAttribute(name, value) { this[name] = value; }
  }));
  const selector = { value: 'basic' };
  const context = {
    document: {
      getElementById(id) {
        if (id === 'literatureNoteTemplateList') {
          return { querySelectorAll() { return rows; } };
        }
        if (id === 'literatureNoteTemplateSelector') return selector;
        return null;
      },
      querySelectorAll() { return buttons; }
    }
  };
  vm.runInNewContext(
    `${sourceOf('activateLiteratureNoteTemplate', 'syncLiteratureNoteTemplateNavigation')}` +
      '\nglobalThis.activate = activateLiteratureNoteTemplate;',
    context
  );

  const selected = context.activate('clinical');
  assert.equal(selected, 'clinical');
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[1].hidden, false);
  assert.equal(rows[0].value, 'unsaved basic draft');
  assert.equal(rows[1].value, 'unsaved clinical draft');
  assert.equal(selector.value, 'clinical');
  assert.equal(buttons[0]['aria-selected'], 'false');
  assert.equal(buttons[1]['aria-selected'], 'true');
});

