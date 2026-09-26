const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function actualFormatter(file, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const scope = { interfaceText: text => text };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  return scope[name];
}

const formatters = [
  ['article chat', actualFormatter('content.js', 'articleChatFailureMessage')],
  ['settings', actualFormatter('options.js', 'friendlyError')]
];
for (const [surface, format] of formatters) {
  for (const providerId of ['deepseek', 'openai', 'anthropic', 'codex-local']) {
    test(`${surface}: generic unavailable is provider-neutral for ${providerId}`, () => {
      const message = format({ code: 'PROVIDER_UNAVAILABLE', providerId,
        message: 'Provider is temporarily unavailable' });
      assert.equal(message, '当前模型服务暂时不可用，请稍后重试。');
      assert.doesNotMatch(message, /Codex|不是论文|不是.*上下文|API Key|登录/);
    });
  }
  for (const [code, meaning] of [
    ['CODEX_NOT_AUTHENTICATED', /Codex.*(?:未登录|过期)/],
    ['CODEX_NOT_INSTALLED', /未找到本机 Codex.*安装/],
    ['CODEX_BRIDGE_UNAVAILABLE', /本机 Codex 桥.*(?:未安装|未注册|断开)/],
    ['CODEX_PROVIDER_REJECTED', /本机 Codex 拒绝/]
  ]) {
    test(`${surface}: ${code} keeps its explicit Codex meaning`, () => {
      assert.match(format({ code, providerId: 'codex-local' }), meaning);
    });
  }
}

test('real DeepSeek adapter 503 reaches generic unavailable without a network call', async () => {
  require('../providers/provider-utils.js');
  const { createDeepSeekAdapter } = require('../providers/deepseek.js');
  let calls = 0;
  const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'synthetic-no-secret' }, async () => {
    calls++;
    return new Response('synthetic unavailable', { status: 503 });
  });
  const events = [];
  for await (const event of adapter.generateTextStream({ systemPrompt: 'synthetic', userPrompt: 'synthetic',
    maxOutputTokens: 512, timeoutMs: 1000 })) events.push(event);
  const error = events.find(event => event.type === 'error')?.error;
  assert.equal(error?.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(error?.status, 503);
  assert.equal(calls, 1);
  for (const [, format] of formatters) assert.equal(format(error), '当前模型服务暂时不可用，请稍后重试。');
});
