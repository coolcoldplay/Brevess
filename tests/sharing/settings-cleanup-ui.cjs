'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('playwright');
const feature = path.resolve(__dirname, '../..');
const source = process.env.SHARING_QA_SOURCE || feature;
const runRoot=path.join(feature,'output','r37-browser-qa');fs.mkdirSync(runRoot,{recursive:true});const run=fs.mkdtempSync(path.join(runRoot,'ui-'));
const checks = [], errors = [];
const retired = ['paper_research_logic', 'paper_innovations', 'paper_limitations'];
let context;
(async () => {
  try {
    context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
      channel: 'msedge', headless: false,
      args: ['--disable-extensions-except=' + source, '--load-extension=' + source],
      viewport: { width: 1440, height: 1000 }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('chrome-extension://' + new URL(worker.url()).host + '/options.html#page=models');
    await page.locator('[data-task-policy-id="literature_note_autofill"]').waitFor();
    for (const id of retired) assert.equal(await page.locator('[data-task-policy-id="' + id + '"]').count(), 0);
    for (const id of ['cross_figure_mechanism', 'evidence_ledger_review', 'literature_radar_query']) {
      assert.ok(await page.locator('[data-task-policy-id="' + id + '"]').isVisible(), id);
    }
    await page.locator('[data-edit-task-token-rule="literature_note_autofill"]').click();
    for (const id of retired) assert.equal(await page.locator('[data-task-token-copy-target="' + id + '"]').count(), 0);
    await page.keyboard.press('Escape');
    checks.push('Only current features are editable; active radar/ledger/mechanism routes remain visible; retired tasks absent from token-copy choices.');
    const compatibility = await page.evaluate(async ids => {
      const initial = await callBackground({ type: 'LLM_GET_SETTINGS' });
      const policies = JSON.parse(JSON.stringify(initial.settings.taskPolicies));
      for (const [index, id] of ids.entries()) policies[id] = {
        ...policies[id], mode: 'global', profileId: null, reasoningEnabled: true,
        reasoningEffort: ['low', 'high', 'max'][index]
      };
      const saved = await callBackground({ type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: initial.settings.globalProfileId, taskPolicies: policies });
      applyState(saved, { replaceTaskPolicyDrafts: true });
      const before = Object.fromEntries(ids.map(id => [id, saved.settings.taskPolicies[id]]));
      const collected = collectTaskPolicies();
      await callBackground({ type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: saved.settings.globalProfileId, taskPolicies: collected });
      const reloaded = await callBackground({ type: 'LLM_GET_SETTINGS' });
      const after = Object.fromEntries(ids.map(id => [id, reloaded.settings.taskPolicies[id]]));
      // Missing/null entries from an old or partially edited configuration still produce valid defaults.
      for (const id of ids) { state.settings.taskPolicies[id] = null; taskPolicyDrafts.delete(id); }
      const empty = collectTaskPolicies();
      return { before, after, empty: ids.map(id => empty[id]) };
    }, retired);
    assert.deepEqual(compatibility.after, compatibility.before);
    assert.ok(compatibility.empty.every(p => p.mode === 'global' && p.profileId === null));
    await page.reload();
    await page.locator('[data-task-policy-id="literature_note_autofill"]').waitFor();
    checks.push('Existing manually edited retired policies survive real background save/read/reload; null/missing drafts get safe defaults.');
    for (const lang of ['zh-CN', 'en']) {
      await page.locator('#globalLanguage').selectOption(lang);
      for (const width of [1440, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#taskPolicyModules').scrollIntoViewIfNeeded();
        const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(layout.scroll <= layout.width + 1, JSON.stringify({ lang, ...layout }));
        await page.screenshot({ path: path.join(run, 'models-' + lang + '-' + width + '.png') });
      }
    }
    checks.push('Chinese and English real extension UI at desktop/360px widths has no page horizontal overflow.');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify({ checks, errors, compatibility }, null, 2));
    console.log(JSON.stringify({ run, checks: checks.length, errors }));
  } catch (error) {
    fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify({ checks, errors, failure: error.stack }, null, 2));
    console.error(error.stack); process.exitCode = 1;
  } finally { await context?.close(); }
})();
