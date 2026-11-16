/* Official website icons are bundled locally; never send credentials or custom URLs to an icon service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(globalThis, function () {
  'use strict';
  const brands = Object.freeze({
    openai: ['OpenAI', 'openai.png'],
    anthropic: ['Anthropic Claude', 'claude.png'],
    gemini: ['Google Gemini', 'gemini.png'],
    deepseek: ['DeepSeek', 'deepseek.ico'],
    typesafe: ['TypeSafe Jev', 'typesafe.png'],
    grok: ['Grok · xAI', 'grok.png'],
    kimi: ['Kimi · 月之暗面', 'kimi.ico'],
    zhipu: ['智谱 GLM', 'zhipu.png'],
    doubao: ['豆包 · 火山方舟', 'doubao.png'],
    qwen: ['通义千问 · 阿里云百炼', 'qwen.png'],
    hunyuan: ['腾讯混元', 'hunyuan.png'],
    qianfan: ['百度千帆', 'qianfan.ico'],
    minimax: ['MiniMax', 'minimax.ico']
  });
  const aliases = { 'codex-local': 'openai', 'deepseek-harness': 'deepseek', 'hunyuan-tokenhub': 'hunyuan', 'hunyuan-classic': 'hunyuan' };
  const officialHosts = Object.freeze({
    'api.openai.com': 'openai', 'api.anthropic.com': 'anthropic',
    'generativelanguage.googleapis.com': 'gemini', 'api.deepseek.com': 'deepseek',
    'api.typesafe.ai': 'typesafe', 'api.x.ai': 'grok',
    'api.moonshot.cn': 'kimi', 'api.moonshot.ai': 'kimi',
    'open.bigmodel.cn': 'zhipu', 'api.z.ai': 'zhipu',
    'ark.cn-beijing.volces.com': 'doubao', 'dashscope.aliyuncs.com': 'qwen',
    'dashscope-intl.aliyuncs.com': 'qwen', 'dashscope-us.aliyuncs.com': 'qwen',
    'tokenhub.tencentmaas.com': 'hunyuan', 'api.hunyuan.cloud.tencent.com': 'hunyuan',
    'qianfan.baidubce.com': 'qianfan', 'api.minimaxi.com': 'minimax', 'api.minimax.io': 'minimax'
  });
  function getProviderBrand(profile = {}) {
    const config = profile.config || {};
    let id = String(profile.providerId || '');
    if (id === 'openai-compatible') {
      id = String(config.presetId || 'custom');
      if (!id || id === 'custom') {
        try {
          const url = new URL(config.baseUrl);
          id = url.protocol === 'https:' && !url.username && !url.password ? officialHosts[url.hostname] : '';
        } catch (_) { id = ''; }
      }
    }
    id = aliases[id] || id;
    const brand = Object.hasOwn(brands, id) ? brands[id] : null;
    return brand ? { id, label: brand[0], src: 'icons/providers/' + brand[1] } : null;
  }
  return { getProviderBrand };
});
