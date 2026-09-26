import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || '.');
const live = process.argv.includes('--live');
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  `output/playwright/custom-model-settings-${live ? 'live' : 'mock'}`);
const customModel = 'deepseek-v4.1-flash-expires-on-0910';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-custom-model-'));
const extension = path.join(temporary, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(output, { recursive: true });
const report = { status: 'FAIL', live, realApiCalls: 0, checks: [], calls: [], errors: [] };
let secret = live ? await readSecretFromTty({ prompt: 'Authorized DeepSeek key (masked): ' })
  : 'custom-model-fixture-secret';
let context;
const server = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(['/models', '/chat/completions'].includes(request.url));
    assert.ok(report.calls.length < 15);
    const receipt = { path: request.url, model: body ? JSON.parse(body).model : '',
      credentialMatches: request.headers.authorization === `Bearer ${secret}` };
    report.calls.push(receipt);
    assert.equal(receipt.credentialMatches, true);
    if (live) {
      report.realApiCalls++;
      const remote = await fetch(`https://api.deepseek.com${request.url}`, {
        method: request.method,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        ...(body ? { body } : {}), signal: AbortSignal.timeout(90000)
      });
      receipt.status = remote.status;
      response.writeHead(remote.status, { 'Content-Type': 'application/json' });
      response.end(await remote.text());
    } else {
      receipt.status = 200;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(request.url === '/models'
        ? { data: [{ id: 'deepseek-v4-flash' }] }
        : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    }
  } catch (error) {
    report.errors.push(error.code || 'PROXY_BOUNDARY_ERROR');
    response.writeHead(502); response.end('{}');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(extension, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(js|mjs|html|css)$/.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  const network = path.join(extension, 'offscreen-network-worker.js');
  const prefix = `const originalCustomModelFetch = globalThis.fetch.bind(globalThis);\n` +
    `globalThis.fetch = (url, options) => { const parsed = new URL(url);\n` +
    `if(parsed.origin !== 'https://api.deepseek.com') throw new Error('UNEXPECTED_PROVIDER');\n` +
    `return originalCustomModelFetch('http://127.0.0.1:${server.address().port}' + parsed.pathname, options); };\n`;
  fs.writeFileSync(network, prefix + fs.readFileSync(network, 'utf8'));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.name));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#page=models`);
  await page.evaluate(async () => {
    for (const id of ['profile_custom_model', 'profile_missing_key']) {
      const result = await chrome.runtime.sendMessage({ type: 'LLM_SAVE_PROFILE',
        profile: { id, name: id, providerId: 'deepseek',
          config: { model: 'deepseek-v4-flash' } } });
      if (!result.success) throw Error('SETUP_PROFILE_FAILED');
    }
    await chrome.runtime.sendMessage({ type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: 'profile_custom_model', taskPolicies: {} });
  });
  await page.reload();
  await page.locator('[data-profile-id="profile_custom_model"]').waitFor();
  await page.locator('#apiKey').fill(secret);
  await page.locator('#model').fill(customModel);
  assert.equal(await page.locator('#modelSuggestionsSelect').inputValue(), '');
  report.checks.push('manual input clears stale suggested model');
  await page.locator('#saveSettings').click();
  await page.waitForFunction(() => !profileActionInFlight.save && !profileActionInFlight.test &&
    state?.settings?.profiles?.profile_custom_model?.config?.hasApiKey === true);
  await page.reload();
  await page.locator('[data-profile-id="profile_custom_model"]').waitFor();
  assert.equal(await page.locator('#model').inputValue(), customModel);
  assert.equal(await page.locator('#apiKey').inputValue(), '');
  assert.match(await page.locator('#apiKey').getAttribute('placeholder'), /已保存|Saved/);
  report.checks.push('custom model survives reload; stored key is masked and not filled back');
  const testConnection = async () => {
    const before = report.calls.filter(call => call.path === '/chat/completions').length;
    await page.locator('#testProvider').click();
    await page.waitForFunction(() => !profileActionInFlight.save && !profileActionInFlight.test &&
      document.getElementById('status')?.classList.contains('success'), null, { timeout: 120000 });
    const completions = report.calls.filter(call => call.path === '/chat/completions').slice(before);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].model, customModel);
    assert.equal(completions[0].credentialMatches, true);
    assert.equal(completions[0].status, 200);
  };
  await testConnection();
  report.checks.push('actual test button sends exact custom model with saved credential');
  await page.reload();
  await page.locator('[data-profile-id="profile_custom_model"]').waitFor();
  await testConnection();
  report.checks.push('second test after reload reuses key and custom model');
  await page.locator('[data-profile-id="profile_missing_key"]').click();
  const beforeMissing = report.calls.length;
  await page.locator('#model').fill(customModel);
  await page.locator('#testProvider').click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent
    .includes('当前配置没有可用的 API Key'));
  assert.equal(report.calls.length, beforeMissing);
  report.checks.push('missing-key error identifies this profile without issuing provider request');
  await page.locator('[data-profile-id="profile_custom_model"]').click();
  await page.locator('#model').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'settings.png') });
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.error = String(error.message).replaceAll(secret, '[REDACTED]');
  process.exitCode = 1;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  secret = '';
  const resolved = path.resolve(temporary);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('brevess-custom-model-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
