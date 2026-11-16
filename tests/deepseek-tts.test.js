const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../core/tts-service.js');
const { createTtsRouter } = require('../core/tts-router.js');
const settings = () => ({ mode: 'deepseek', speed: 1.25, deepseek: { apiKey: 'fixture', voiceEn: 'tide' },
  local: { endpoint: T.TTS_LOCAL_ENDPOINT, model: 'kokoro', transport: 'standard', voiceEn: 'af_heart' } });
test('DeepSeek uses its own protocol, converts PCM and delegates speed to playback', async () => {
  const calls = [];
  const service = T.createTtsService({ fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(new Uint8Array([0, 0, 1, 0]), { headers: { 'content-type': 'audio/pcm' } });
  } });
  const result = await service.synthesize({ text: 'Alpha-synuclein pathology.', language: 'en' }, { settings: settings() });
  assert.equal(calls[0].url, T.TTS_DEEPSEEK_ENDPOINT);
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Alpha-synuclein pathology.', voice_id: 'tide', format: 'pcm', filter_markdown: true });
  assert.equal(result.playbackRate, 1.25);
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString('ascii', 0, 4), 'RIFF');
});
test('Kokoro configuration and request format survive switching providers', async () => {
  const saved = T.mergeTtsSettings(settings(), { mode: 'local' });
  assert.equal(saved.local.voiceEn, 'af_heart'); assert.equal(saved.deepseek.apiKey, 'fixture');
  let request;
  const service = T.createTtsService({ fetchImpl: async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(Buffer.from('RIFF1234WAVEdata'), { headers: { 'content-type': 'audio/wav' } });
  } });
  await service.synthesize({ text: 'Paper.' }, { settings: saved });
  assert.equal(request.url, T.TTS_LOCAL_ENDPOINT); assert.equal(request.body.voice, 'af_heart');
  assert.equal(request.body.model, 'kokoro'); assert.equal(request.body.speed, 1.25);
});
test('only an official DeepSeek profile may supply the TTS key; public settings never contain it', () => {
  const full = { tts: { mode: 'deepseek' }, globalProfileId: 'official', profiles: {
    proxy: { providerId: 'deepseek', config: { baseUrl: 'https://proxy.example/chat/completions', apiKey: 'proxy-secret' } },
    official: { providerId: 'deepseek', config: { apiKey: 'official-secret' } }
  } };
  assert.equal(T.resolveTtsSettings(full).deepseek.apiKey, 'official-secret');
  assert.ok(!JSON.stringify(T.toPublicTtsSettings(T.resolveTtsSettings(full))).includes('secret'));
  delete full.profiles.official; assert.equal(T.resolveTtsSettings(full).deepseek.apiKey, '');
  assert.equal(T.getTtsPublicSettings(T.resolveTtsSettings(full)).configured, false);
});
test('invalid DeepSeek voices and redirected responses fail without fallback uploads', async () => {
  let calls = 0;
  const service = T.createTtsService({ fetchImpl: async () => { calls++; return new Response('', { status: 302 }); } });
  await assert.rejects(service.synthesize({ text: 'Paper' }, { settings: { ...settings(), deepseek: { apiKey: 'fixture', voiceEn: 'unknown' } } }), { code: 'TTS_INVALID_VOICE' });
  assert.equal(calls, 0);
  await assert.rejects(service.synthesize({ text: 'Paper' }, { settings: settings() }), { code: 'TTS_REDIRECT' });
  assert.equal(calls, 1);
});
test('background router resolves credentials without exposing them to the content page', async () => {
  let resolved;
  const router = createTtsRouter({ runtimeExtensionId: 'ext', loadSettings: async () => ({ tts: { mode: 'deepseek' }, profiles: {
    p: { providerId: 'deepseek', config: { apiKey: 'secret-fixture' } } } }),
    service: { synthesize: async (_, opts) => { resolved = opts.settings; return { voice: 'stella' }; } } });
  const sender = { id: 'ext', url: 'https://www.nature.com/articles/1', documentId: 'doc', tab: { id: 1 }, frameId: 0 };
  const publicResult = await router.handle({ type: 'TTS_GET_PUBLIC_SETTINGS' }, sender);
  assert.equal(publicResult.data.configured, true); assert.ok(!JSON.stringify(publicResult).includes('secret'));
  const result = await router.handle({ type: 'TTS_SYNTHESIZE', requestId: 'request-1', text: 'Paper.', userGesture: true }, sender);
  assert.equal(result.success, true); assert.equal(resolved.deepseek.apiKey, 'secret-fixture');
});

test('truncated PCM fails instead of playing an incomplete successful response', async()=>{
 const service=T.createTtsService({fetchImpl:async()=>new Response(new Uint8Array([0,0]),{headers:{'content-type':'audio/pcm','content-length':'8'}})});
 await assert.rejects(service.synthesize({text:'Paper'},{settings:settings()}),{code:'TTS_RESPONSE_SIZE'});
});

test('settings mode-change handler keeps DeepSeek selected and leaves Kokoro configuration intact',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require.resolve('../options.js'),'utf8');
 const match=source.match(/document\.getElementById\('ttsMode'\)\.addEventListener\('change', \(\) => \{([\s\S]*?)\n  \}\);/);
 assert.ok(match);let rendered;const draft=settings();draft.mode='local';
 const context={ttsDraft:draft,document:{getElementById:id=>id==='ttsMode'?{value:'deepseek'}:{checked:true}},captureTtsConnection(){},renderTtsConnection(){rendered=draft.mode;},dirty(){}};
 vm.runInNewContext(match[1],context);assert.equal(rendered,'deepseek');assert.equal(draft.local.model,'kokoro');assert.equal(draft.local.voiceEn,'af_heart');
});
