import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/note007-editor');
fs.mkdirSync(output, { recursive: true });
const run = fs.mkdtempSync(path.join(output, 'run-'));
const modules = ['core/literature-note-format.js', 'core/literature-note-renderer.js', 'core/literature-note-editor.js'];
const report = { status: 'FAIL', startedAt: new Date().toISOString(), run,
  scope: 'Isolated Edge component fixture with the real format, renderer and editor modules; no popup integration',
  realApiCalls: 0, personalDataAccessed: false, realImeTested: false,
  files: modules.map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') })),
  checks: [], screenshots: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 360, height: 760 }, reducedMotion: 'reduce' });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><title>笔记编辑组件验收</title><style>body{margin:12px;font:14px/1.5 system-ui}main{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}textarea{width:100%;box-sizing:border-box;min-height:140px;resize:vertical;font:inherit}button,select{font:inherit;max-width:100%}</style><main><label for="note">研究背景</label><textarea id="note" maxlength="12000"></textarea></main>');
  for (const file of modules) await page.addScriptTag({ path: path.join(root, file) });
  await page.evaluate(() => {
    window.note = document.getElementById('note');
    window.noteEvents = [];
    note.addEventListener('input', event => noteEvents.push({ value: note.value, trusted: event.isTrusted,
      inputType: event.inputType, composing: event.isComposing }));
    window.editor = SciLLM.attachLiteratureNoteEditor({ textarea: note });
    note.before(editor.element);
    window.nativeInsert = document.execCommand.bind(document);
  });
  const textarea = page.locator('#note');
  const action = name => page.locator(`[data-note-format-action="${name}"]`);
  const color = page.getByRole('combobox', { name: '设置选中文字颜色' });
  const toggle = page.getByRole('button', { name: '切换笔记编辑或预览' });
  const preview = page.getByRole('region', { name: '笔记预览' });
  const status = page.locator('.literature-note-editor-status');
  const check = (name, details = {}) => report.checks.push({ name, ...details });
  const selectByKeyboard = async (start, length) => {
    await textarea.focus(); await textarea.press('Control+Home');
    for (let i = 0; i < start; i += 1) await textarea.press('ArrowRight');
    for (let i = 0; i < length; i += 1) await textarea.press('Shift+ArrowRight');
  };
  const reset = async value => {
    await page.evaluate(() => {
      if (editor.element.querySelector('.literature-note-editor-toggle').getAttribute('aria-pressed') === 'true') {
        editor.element.querySelector('.literature-note-editor-toggle').click();
      }
      note.disabled = false; note.readOnly = false; document.execCommand = nativeInsert; editor.refresh();
    });
    await textarea.fill(value);
    await page.evaluate(() => { noteEvents = []; editor.refresh(); });
  };

  const source = '前文 未见变化 后文';
  await reset(source); await selectByKeyboard(3, 4);
  await action('bold').click();
  assert.equal(await textarea.inputValue(), '前文 **未见变化** 后文');
  const nativeEvents = await page.evaluate(() => noteEvents);
  assert.equal(nativeEvents.length, 1); assert.equal(nativeEvents[0].trusted, true);
  assert.deepEqual(await textarea.evaluate(node => [node.selectionStart, node.selectionEnd]), [5, 9]);
  check('real keyboard selection, mouse toolbar click, native insertText and one trusted input');
  await textarea.press('Control+z'); assert.equal(await textarea.inputValue(), source);
  check('native Ctrl+Z restores original source');
  await textarea.press('Control+y'); assert.equal(await textarea.inputValue(), '前文 **未见变化** 后文');
  check('native Ctrl+Y restores formatting');

  await reset(source); await selectByKeyboard(3, 4);
  await color.focus(); await color.press('End');
  assert.equal(await textarea.inputValue(), '前文 <span data-brevess-color="purple">未见变化</span> 后文');
  assert.equal(await color.locator('option').count(), 7);
  check('keyboard color selection preserves only the selected text, six explicitly named choices');
  await toggle.click(); assert.equal(await preview.locator('span[data-brevess-color="purple"]').textContent(), '未见变化');
  assert.equal(await preview.textContent(), source);
  check('selected color preview retains unaffected prefix and suffix');

  await reset('甲 1.25 μM\n乙未增加\n后文');
  await textarea.press('Control+Home'); await textarea.press('Control+Shift+End');
  await action('bullet').click(); assert.equal(await textarea.inputValue(), '- 甲 1.25 μM\n- 乙未增加\n- 后文');
  await action('ordered').click(); assert.equal(await textarea.inputValue(), '1. 甲 1.25 μM\n2. 乙未增加\n3. 后文');
  check('list buttons preserve scientific body values and negation');
  await textarea.press('Control+Home'); await textarea.press('ArrowDown'); await textarea.press('Home');
  await action('indent').click(); assert.match(await textarea.inputValue(), /\n  2\. 乙未增加/);
  await action('outdent').click(); assert.match(await textarea.inputValue(), /\n2\. 乙未增加/);
  check('list indent/outdent through real toolbar clicks');

  await reset(source); await selectByKeyboard(3, 4);
  await textarea.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' })));
  assert.equal(await action('bold').isDisabled(), true); assert.equal(await color.isDisabled(), true); assert.equal(await toggle.isDisabled(), true);
  await action('bold').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  assert.equal(await textarea.inputValue(), source); assert.match(await status.textContent(), /组合输入/);
  await textarea.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' })));
  assert.equal(await action('bold').isEnabled(), true);
  check('synthetic composition events block formatting until compositionend', { realIme: false });

  await reset('科'.repeat(12000)); await selectByKeyboard(0, 1); await action('bold').click();
  assert.equal((await textarea.inputValue()).length, 12000); assert.match(await status.textContent(), /12000/);
  assert.equal(await page.evaluate(() => noteEvents.length), 0);
  check('12000-character overhead rejection retains source and emits no input');
  await reset('甲🧬乙'); await textarea.evaluate(node => { node.setSelectionRange(2, 3); node.dispatchEvent(new Event('select')); });
  await action('bold').click(); assert.equal(await textarea.inputValue(), '甲🧬乙'); assert.match(await status.textContent(), /边界/);
  check('invalid UTF-16 selection is refused without changing source');

  await reset('<img src=x onerror="window.noteXss=1"><script>window.noteXss=2</script>\n**未见变化**\n[j](javascript:alert(1)) [安全](https://example.org/paper)');
  await toggle.click(); assert.equal(await preview.locator('img,script').count(), 0);
  assert.equal(await preview.locator('a').count(), 1); assert.equal(await preview.locator('a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.evaluate(() => window.noteXss), undefined);
  assert.match(await preview.textContent(), /<img/); check('real preview keeps hostile HTML inert and unsafe URLs non-clickable');
  await textarea.evaluate(node => { node.value = '**当前值**，1.25 μM'; editor.refresh(); });
  assert.equal(await preview.locator('strong').textContent(), '当前值');
  assert.equal(await preview.textContent(), '当前值，1.25 μM');
  check('preview refresh renders the current textarea value');

  await reset(source); await selectByKeyboard(3, 4);
  for (const property of ['disabled', 'readOnly']) {
    await textarea.evaluate((node, property) => { node[property] = true; }, property);
    await action('bold').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-note-format-action="bold"]').disabled);
    assert.equal(await color.isDisabled(), true);
    await action('bold').evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await textarea.inputValue(), source);
    await textarea.evaluate((node, property) => { node[property] = false; editor.refresh(); }, property);
    check(`${property} synchronizes controls and prevents writes`);
  }

  await reset(source); await selectByKeyboard(3, 4);
  await page.evaluate(() => { document.execCommand = () => false; });
  await action('bold').click(); assert.equal(await textarea.inputValue(), '前文 **未见变化** 后文');
  const fallbackEvents = await page.evaluate(() => noteEvents);
  assert.equal(fallbackEvents.length, 1); assert.equal(fallbackEvents[0].trusted, false);
  check('setRangeText fallback dispatches one real DOM input event', { nativeUndoGuaranteed: false });
  await reset(source); await selectByKeyboard(3, 4);
  await page.evaluate(() => { document.execCommand = () => false; note.addEventListener('beforeinput', event => event.preventDefault(), { once: true }); });
  await action('bold').click(); assert.equal(await textarea.inputValue(), source); assert.equal(await page.evaluate(() => noteEvents.length), 0);
  check('fallback respects a cancelled beforeinput');

  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 760 });
    await reset('未增加 1.25 μM\n  - 子项 **科学内容**\n[长链接](https://example.org/' + 'long'.repeat(50) + ')');
    await textarea.evaluate(node => { node.setSelectionRange(0, 0); node.scrollTop = 0; });
    assert.equal(await status.textContent(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const editing = path.join(run, `editor-${width}-editing.png`); await page.screenshot({ path: editing }); report.screenshots.push(editing);
    await toggle.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const viewing = path.join(run, `editor-${width}-preview.png`); await page.screenshot({ path: viewing }); report.screenshots.push(viewing);
    check(`editing and preview fit ${width}px`, { overflow: false });
  }
  await page.evaluate(() => editor.destroy());
  assert.equal(await textarea.isVisible(), true); assert.equal(await page.locator('.literature-note-editor').count(), 0);
  await textarea.fill('销毁后父级仍可保存'); assert.equal(await page.evaluate(() => noteEvents.at(-1).value), '销毁后父级仍可保存');
  check('destroy restores textarea visibility and leaves the parent input listener');
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) { report.failure = String(error.stack || error); process.exitCode = 1; }
finally {
  await browser?.close(); report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    report: path.join(run, 'report.json'), screenshots: report.screenshots, failure: report.failure || null }));
}
