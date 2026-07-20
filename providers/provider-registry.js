(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFINITIONS = {
    openai: {
      label: 'OpenAI', defaultModel: 'gpt-5-mini',
      supportsVision: true, visionInputFormat: 'openai', contextWindowTokens: 128000
    },
    anthropic: {
      label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-6',
      supportsVision: true, visionInputFormat: 'anthropic', contextWindowTokens: 200000
    },
    gemini: {
      label: 'Google Gemini', defaultModel: 'gemini-3.5-flash',
      supportsVision: true, visionInputFormat: 'gemini', contextWindowTokens: 128000
    },
    deepseek: {
      label: 'DeepSeek', defaultModel: 'deepseek-v4-flash',
      supportsVision: false, visionInputFormat: 'none', contextWindowTokens: 65536
    },
    'openai-compatible': {
      label: '国内模型与兼容接口', defaultModel: '', requiresBaseUrl: true,
      supportsVision: false, visionInputFormat: 'openai', contextWindowTokens: 32768
    }
  };

  const COMPATIBLE_PROVIDER_PRESETS = [
    {
      id: 'custom', label: '自定义 OpenAI 兼容接口',
      description: '手动填写服务地址、模型名称和鉴权方式。',
      baseUrl: '', defaultModel: '', authHeader: 'Authorization', authPrefix: 'Bearer',
      jsonMode: true, supportsVision: false
    },
    {
      id: 'kimi', label: 'Kimi（月之暗面）',
      description: 'Kimi 官方 OpenAI Chat Completions 接口。',
      baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: true
    },
    {
      id: 'zhipu', label: '智谱 GLM',
      description: '智谱开放平台通用 API。',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.2',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'doubao', label: '豆包（火山方舟）',
      description: '火山方舟 OpenAI 兼容 Chat 接口。',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      defaultModel: 'doubao-seed-2-0-lite-260215',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'qwen', label: '通义千问（阿里云百炼）',
      description: '阿里云百炼 OpenAI 兼容接口（北京地域）。',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-flash',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'hunyuan-tokenhub', label: '腾讯混元（TokenHub）',
      description: '腾讯云当前推荐的 TokenHub 接口，需要 TokenHub API Key。',
      baseUrl: 'https://tokenhub.tencentmaas.com/v1', defaultModel: 'hy3-preview',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'hunyuan-classic', label: '腾讯混元（经典 API）',
      description: '适用于已有混元经典 API Key 的账户。',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'qianfan', label: '百度千帆',
      description: '千帆 v2 OpenAI 兼容接口。',
      baseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.5-turbo-32k',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    },
    {
      id: 'minimax', label: 'MiniMax',
      description: 'MiniMax M2.7 OpenAI 兼容文本接口。',
      baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M2.7',
      authHeader: 'Authorization', authPrefix: 'Bearer', jsonMode: true, supportsVision: false
    }
  ];

  const FACTORIES = {
    openai: shared.createOpenAIAdapter,
    anthropic: shared.createAnthropicAdapter,
    gemini: shared.createGeminiAdapter,
    deepseek: shared.createDeepSeekAdapter,
    'openai-compatible': shared.createOpenAICompatibleAdapter
  };

  function getProviderDefinitions() {
    return JSON.parse(JSON.stringify(DEFINITIONS));
  }

  function getCompatibleProviderPresets() {
    return JSON.parse(JSON.stringify(COMPATIBLE_PROVIDER_PRESETS));
  }

  function getProviderCapabilities(providerId, config = {}) {
    const definition = DEFINITIONS[providerId];
    if (!definition) return { supportsVision: false, visionInputFormat: 'none' };
    const supportsVision = providerId === 'openai-compatible'
      ? config.supportsVision === true
      : definition.supportsVision === true;
    return {
      supportsVision,
      visionInputFormat: supportsVision ? definition.visionInputFormat : 'none'
    };
  }

  function validContextWindowOverride(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 8192 || numeric > 2000000) return null;
    return Math.round(numeric / 1024) * 1024;
  }

  function getProviderContextWindowTokens(providerId, _config = {}, override = null) {
    const explicit = validContextWindowOverride(override);
    if (explicit) return explicit;
    return DEFINITIONS[providerId]?.contextWindowTokens || 32768;
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
    } catch {
      return false;
    }
  }

  function validateProviderConfig(providerId, config) {
    const errors = [];
    if (!DEFINITIONS[providerId]) return ['providerId'];
    if (!String(config?.apiKey || '').trim()) errors.push('apiKey');
    if (!String(config?.model || '').trim()) errors.push('model');
    if (DEFINITIONS[providerId].requiresBaseUrl && !isHttpUrl(config?.baseUrl)) errors.push('baseUrl');
    return errors;
  }

  function createProviderAdapter({ providerId, config, fetchImpl }) {
    const errors = validateProviderConfig(providerId, config);
    if (errors.length) throw new Error(`Invalid provider config: ${errors.join(',')}`);
    const factory = FACTORIES[providerId];
    return factory(config, fetchImpl || fetch);
  }

  return {
    getProviderDefinitions,
    getCompatibleProviderPresets,
    getProviderCapabilities,
    getProviderContextWindowTokens,
    validateProviderConfig,
    createProviderAdapter
  };
});
