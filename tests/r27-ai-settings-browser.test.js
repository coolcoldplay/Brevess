const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

test('R27 production settings UI: isolated model workflow, About clipboard, responsive QR rendering',
  { skip: process.env.BREVESS_R27_BROWSER !== '1', timeout: 60000 }, async () => {
    const { chromium } = require('playwright');
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'output/r27-ai-settings-repair');
    const registry = require('../providers/provider-registry.js');
    require('../core/llm-task-catalog.js'); require('../core/token-budget.js');
    const settingsApi = require('../core/settings-store.js');
    const categories = Object.values(require('../core/category-store.js').createBuiltInCategories());
    let settings = settingsApi.createDefaultSettings();
    settings.consentGranted = true;
    const state = () => ({ settings: settingsApi.toPublicSettings(settings), providers: registry.getProviderDefinitions(),
      compatibleProviderPresets: registry.getCompatibleProviderPresets(), availableCategories: categories,
      activeCategories: categories, customCategories: [], deletedBuiltInCategories: [],
      llmReady: Object.values(settings.profiles).some(profile => Boolean(profile.config.apiKey)),
      effectiveMode: 'regex', analysisModeDefaults: settingsApi.createDefaultAnalysisModes() });
    const calls = [], pageErrors = [], unexpectedNetwork = [], viewportEvidence = [];
    const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
    const files = new Map([['/options.html', 'options.html']]);
    for (const match of html.matchAll(/\b(?:src|href)="([\w./-]+\.(?:js|css|png|svg))"/g)) files.set('/' + match[1], match[1]);
    files.set('/vendor/phosphor/Phosphor.woff2', 'vendor/phosphor/Phosphor.woff2');
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    const server = http.createServer(async (req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname === '/__fixture/message' && req.method === 'POST') {
        let text = ''; for await (const chunk of req) text += chunk;
        const message = JSON.parse(text); calls.push({ type: message.type, probeIds: message.probeIds });
        let data = {};
        if (message.type === 'LLM_GET_SETTINGS') data = state();
        if (message.type === 'LLM_SAVE_PROFILE') {
          const profile = message.profile, old = settings.profiles[profile.id];
          const config = { ...profile.config, apiKey: profile.config.apiKey || old?.config?.apiKey || '' };
          settings.profiles[profile.id] = settingsApi.normalizeProfile(profile.id, { ...profile, config });
          data = { ...state(), profile: { id: profile.id } };
        }
        if (message.type === 'LLM_UPDATE_PROFILE_ROUTING') {
          settings.globalProfileId = message.globalProfileId; settings.taskPolicies = message.taskPolicies; data = state();
        }
        if (message.type === 'LLM_UPDATE_PREFERENCES') { settings = settingsApi.mergeSettings({ ...settings, ...message.preferences }); data = state(); }
        if (message.type === 'LLM_LIST_MODELS') data = { models: [{ id: 'synthetic-directory-id', displayName: '合成目录模型' }] };
        if (message.type === 'LLM_TEST_PROFILE') {
          await new Promise(resolve => setTimeout(resolve, 180));
          data = { providerId: 'openai-compatible', model: 'exact-custom-id', connectivity: true, capabilitiesReady: false,
            probes: message.probeIds.map(id => ({ id, status: id === 'structured_schema' ? 'failed' : 'passed', code: id === 'structured_schema' ? 'INVALID_RESPONSE' : '' })) };
        }
        if (message.type === 'TTS_GET_PUBLIC_SETTINGS') data = { enabled: false };
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); return;
      }
      if (pathname === '/__fixture/shim.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(fs.readFileSync(path.join(root, 'output/r25-ui-fixture/shim.js'), 'utf8') +
          '\nchrome.permissions = {request: async () => true, contains: async () => true};'); return;
      }
      if (!files.has(pathname)) { res.writeHead(404); res.end(); return; }
      const name = files.get(pathname); let bytes = fs.readFileSync(path.join(root, name));
      if (name === 'options.html') bytes = Buffer.from(bytes.toString('utf8').replace('<head>', '<head><script src="/__fixture/shim.js"></script>'));
      res.writeHead(200, { 'content-type': mime[path.extname(name)] || 'application/octet-stream' }); res.end(bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser, page;
    try {
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
      await context.route('**/*', async route => {
        if (!route.request().url().startsWith(origin + '/')) { unexpectedNetwork.push(route.request().url()); await route.abort(); }
        else await route.continue();
      });
      page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(origin + '/options.html#models');
      await page.locator('#apiProfileList [data-profile-id]').first().waitFor({ state: 'attached' });
      await page.locator('[data-settings-nav="models"]').click();
      await page.locator('#providerId').selectOption('openai-compatible');
      await page.locator('#baseUrl').fill('https://example.test/v1');
      await page.locator('#apiKey').fill('synthetic-ui-key');
      await page.locator('#model').fill('exact-custom-id');
      await page.locator('#saveSettings').click();
      await page.waitForFunction(() => document.getElementById('providerConfigurationStep').textContent === '配置已保存');
      assert.match(await page.locator('#providerTestStep').textContent(), /尚未验证/);
      assert.equal(await page.locator('#onboardingProgress').textContent(), '连接已配置，待验证');
      assert.match(await page.locator('#effectiveMode').textContent(), /LLM 已配置/);
      await page.locator('#refreshModels').click();
      await page.waitForFunction(() => document.getElementById('modelDiscoveryStatus').textContent.includes('目录模型'));
      await page.locator('#modelDirectorySearch').fill('synthetic-directory');
      assert.equal(await page.locator('#model').inputValue(), 'exact-custom-id');
      assert.match(await page.locator('#modelSuggestionsSelect').textContent(), /获取目录/);
      await page.locator('#modelDirectorySearch').fill('');
      await page.locator('#testPlainJson').check(); await page.locator('#testStructuredSchema').check();
      await page.locator('#testProvider').click();
      await page.waitForFunction(() => document.getElementById('providerTestStep').textContent.includes('部分能力未通过'));
      assert.match(await page.locator('[data-probe-id="plain_json"]').textContent(), /通过/);
      assert.match(await page.locator('[data-probe-id="structured_schema"]').textContent(), /失败/);
      assert.match(await page.locator('[data-probe-id="web_search"]').textContent(), /未测试/);
      assert.equal(await page.locator('#onboardingProgress').textContent(), '基础连接已验证');
      const publicEvidence = await page.evaluate(() => ({ hasRawKey: Object.values(state.settings.profiles).some(profile => Object.hasOwn(profile.config, 'apiKey')),
        caches: [...discoveredModels.keys()], verification: JSON.stringify([...providerVerificationResults]) }));
      assert.equal(publicEvidence.hasRawKey, false);
      assert.equal(JSON.stringify(publicEvidence).includes('synthetic-ui-key'), false);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => window.scrollY === 0);
      await page.screenshot({ path: path.join(output, 'settings-model-workflow.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 1000 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => window.scrollY === 0);
      assert.equal(await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, 'settings-model-workflow-375.png'), fullPage: true });
      await page.screenshot({ path: path.join(output, 'settings-model-workflow-375-viewport.png') });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.evaluate(() => applyState(structuredClone(state)));
      assert.match(await page.locator('#providerTestStep').textContent(), /结果已过期/);
      assert.equal(await page.locator('#model').inputValue(), 'exact-custom-id');
      assert.equal(await page.locator('#onboardingProgress').textContent(), '连接已配置，待验证');
      await page.locator('#model').fill('changed-exact-id');
      assert.match(await page.locator('#providerTestStep').textContent(), /结果已过期/);
      assert.match(await page.locator('[data-probe-id="plain_json"]').textContent(), /未测试/);
      assert.equal(await page.locator('#onboardingProgress').textContent(), '连接已配置，待验证');
      await page.locator('[data-settings-nav="about"]').click();
      const supportIcon = await page.locator('.support-email-icon').boundingBox();
      assert.ok(supportIcon?.width >= 24 && supportIcon.height >= 24);
      await page.locator('#copySupportEmail').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('supportCopyStatus').textContent === '邮箱已复制。');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'brevess0729@163.com');
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } } }));
      await page.locator('#copySupportEmail').click();
      await page.waitForFunction(() => document.getElementById('supportCopyStatus').textContent.includes('手动复制'));
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('#copySupportEmail').focus();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'copySupportEmail');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForFunction(() => window.scrollY === 0);
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY,
          headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
          headerBottom: document.querySelector('.topbar').getBoundingClientRect().bottom,
          feedbackTop: document.getElementById('support').getBoundingClientRect().top }));
        assert.ok(viewport.headerTop >= 0 && viewport.headerTop <= 1);
        viewportEvidence.push(viewport);
        await page.screenshot({ path: path.join(output, `settings-about-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(output, `settings-about-${width}-viewport.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const [index, platform] of ['wechat', 'alipay'].entries()) await page.locator('.support-qr-image').nth(index).screenshot({ path: path.join(output, `settings-qr-${width}-${platform}.png`) });
      }
      assert.deepEqual(unexpectedNetwork, []); assert.deepEqual(pageErrors, []);
      fs.writeFileSync(path.join(output, 'settings-browser.json'), JSON.stringify({ passed: true, evidence: 'production options; loopback assets; synthetic memory transport', realServiceCalls: 0, calls, pageErrors, unexpectedNetwork, widths: [1280, 375], viewportEvidence }, null, 2));
    } catch (error) {
      if (page) {
        await page.screenshot({ path: path.join(output, 'settings-browser-failure.png'), fullPage: true });
        fs.writeFileSync(path.join(output, 'settings-browser-failure.json'), JSON.stringify({ error: error.message, pageErrors, unexpectedNetwork,
          status: await page.locator('#status').textContent(), step: await page.locator('#providerTestStep').textContent(), calls }, null, 2));
      }
      throw error;
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  });
