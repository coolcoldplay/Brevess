const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
require('../providers/deepseek.js');
require('../core/cache-planner.js');
const registry = require('../providers/provider-registry.js');
const router = require('../core/task-profile-router.js');
const planner = require('../core/figure-panel-planner.js');
const analysis = require('../core/figure-analysis.js');

// Official documentation, checked 2026-09-25:
// https://api-docs.deepseek.com/quick_start/pricing/
// https://api-docs.deepseek.com/guides/vision/
// All transport is mocked; these tests do not call an actual model.
const flashModels = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'];
const image = { mediaType: 'image/png', width: 1, height: 1, inputMode: 'figure_image',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=' };
function settings(model) {
  const policy = { mode: 'global', profileId: null, reasoningEnabled: false,
    reasoningEffort: 'auto', tokenRule: 'auto', allowTextFallback: false };
  return {
    language: 'zh-CN', globalProfileId: 'profile_saved_deepseek',
    profiles: { profile_saved_deepseek: { name: 'Saved DeepSeek', providerId: 'deepseek',
      config: { apiKey: 'synthetic-key', model }, capabilities: { vision: false },
      tokenPolicy: { mode: 'auto', autoCap: null } } },
    taskPolicies: Object.fromEntries(['figure_walkthrough', 'figure_panel_interpretation',
      'figure_panel_followup'].map(task => [task, { ...policy }]))
  };
}

for (const model of flashModels) test(`FIG023 documented vision capability: ${model}`, () => {
  const capability = registry.getProviderCapabilities('deepseek', { model });
  assert.equal(capability.supportsVision, true);
  assert.equal(capability.visionInputFormat, 'openai');
});

test('FIG023 unverified or non-vision DeepSeek model names do not gain image capability', () => {
  for (const model of ['deepseek-v4-pro', 'deepseek-v4-pro-vision', 'deepseek-chat',
    'deepseek-reasoner', 'deepseek-v4.1-flash', 'deepseek-flash-future',
    'deepseek-v4-flash-vision-impostor']) {
    assert.equal(registry.getProviderCapabilities('deepseek', { model }).supportsVision, false, model);
  }
  assert.equal(registry.getProviderCapabilities('openai-compatible', {
    model: 'deepseek-flash', supportsVision: false
  }).supportsVision, false);
});

test('FIG023 saved false capability metadata does not override current Figure routes or mutate profile settings', () => {
  for (const model of flashModels) {
    const stored = settings(model);
    const original = JSON.stringify(stored);
    for (const task of Object.keys(stored.taskPolicies)) {
      const route = router.resolveTaskProfile(stored, task);
      assert.equal(route.capabilityMode, 'vision', `${model}/${task}`);
      assert.equal(route.publicProfile.supportsVision, true);
      assert.equal(route.model, model, 'preserve the selected API alias');
    }
    assert.equal(JSON.stringify(stored), original);
  }
});

async function dispatchFixture(model, suppliedImages = [image]) {
  const route = router.resolveTaskProfile(settings(model), 'figure_panel_followup');
  const input = { figureId: 'figure-1', figureLabel: 'Figure 1', panelId: 'B', panel: { panel: 'B' },
    caption: '(B) Synthetic image fixture.', contextParagraphs: [], topics: [],
    customQuestion: '图中黄色元素是什么？', requestMode: 'followup',
    imageVariants: route.capabilityMode === 'vision' ? suppliedImages : [],
    contextWindowTokens: 128000, outputTokens: 2048 };
  const plan = planner.buildFigurePanelPlans(input)[0];
  const prompt = analysis.compilePanelFollowupPrompt({ ...input, ...plan }, {
    visualInput: plan.pixelsSupplied === true
  });
  const sent = [];
  const adapter = registry.createProviderAdapter({ providerId: 'deepseek', config: route.config,
    fetchImpl: async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify({ fixture: true }) } }] }), { status: 200 });
    } });
  await adapter.generateJson({ ...prompt, images: plan.images, maxOutputTokens: 2048 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.deepseek.com/chat/completions');
  return { route, plan, prompt, body: sent[0].body };
}

for (const model of flashModels) test(`FIG023 Panel followup serializes its selected image bytes for ${model}`, async () => {
  const { route, plan, body } = await dispatchFixture(model);
  const content = body.messages[1].content;
  const imageParts = Array.isArray(content) ? content.filter(part => part.type === 'image_url') : [];
  assert.equal(imageParts.length, 1, 'the outbound request must actually contain the image');
  assert.equal(imageParts[0].image_url.url, image.dataUrl);
  assert.equal(route.capabilityMode, 'vision');
  assert.equal(plan.pixelsSupplied, true);
  assert.equal(body.model, model);
});

test('FIG023 a non-vision model still routes and sends text even when a source image exists', async () => {
  const { route, plan, body } = await dispatchFixture('deepseek-v4-pro');
  assert.equal(route.capabilityMode, 'caption_text_only');
  assert.equal(plan.pixelsSupplied, false);
  assert.equal(plan.images.length, 0);
  assert.equal(typeof body.messages[1].content, 'string');
});

test('FIG023 no admitted image means no claimed or serialized pixels despite model capability', async () => {
  const { plan, body } = await dispatchFixture('deepseek-flash', []);
  assert.equal(plan.pixelsSupplied, false);
  assert.equal(plan.inputMode, 'caption_context');
  assert.equal(plan.images.length, 0);
  assert.equal(typeof body.messages[1].content, 'string');
  const user = JSON.parse(body.messages[1].content);
  assert.equal(user.analysis_basis, 'caption_context');
});

test('FIG023 a rejected Flash image request remains an error for the caller to handle', async () => {
  let requests = 0;
  const adapter = registry.createProviderAdapter({ providerId: 'deepseek',
    config: { apiKey: 'synthetic-key', model: 'deepseek-flash' },
    fetchImpl: async (_url, options) => {
      requests += 1;
      const content = JSON.parse(options.body).messages[1].content;
      assert.equal(content[1].image_url.url, image.dataUrl);
      return new Response(JSON.stringify({ error: { message: 'unsupported image input' } }), { status: 400 });
    } });
  await assert.rejects(adapter.generateJson({ systemPrompt: 'Synthetic fixture', userPrompt: '{}',
    images: [image], responseSchema: { type: 'object' } }), { code: 'PROVIDER_REJECTED' });
  assert.equal(requests, 1, 'the adapter must not silently retry as text and claim visual evidence');
});
