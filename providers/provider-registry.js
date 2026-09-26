(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFINITIONS = {
    openai: {
      label: 'OpenAI', defaultModel: 'gpt-5-mini',
      models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1'],
      supportsVision: true, visionInputFormat: 'openai',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    anthropic: {
      label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-6',
      models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-haiku-4-5'],
      supportsVision: true, visionInputFormat: 'anthropic',
      contextWindowTokens: 200000, maxOutputTokens: 65536
    },
    gemini: {
      label: 'Google Gemini', defaultModel: 'gemini-3.6-flash',
      models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
      supportsVision: true, visionInputFormat: 'gemini',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    deepseek: {
      label: 'DeepSeek', defaultModel: 'deepseek-v4-flash',
      models: [
        'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'
      ],
      supportsVision: false, visionInputFormat: 'none',
      contextWindowTokens: 128000, maxOutputTokens: 65536
    },
    typesafe: {
      label: 'TypeSafe Jev（文本判定）', defaultModel: 'jev-latest',
      models: ['jev-latest', 'jev-1.13.0', 'jev-preview'],
      supportsVision: false, visionInputFormat: 'none',
      supportedTaskIds: ['document_highlight', 'semantic_find'], textGeneration: false,
      typedDecisions: true, decisionTypes: ['noul', 'choice'],
      contextWindowTokens: 64000, maxStateQuestionTokens: 32000,
      maxOutputTokens: 32768
    },
    'codex-local': {
      label: '本机 Codex', defaultModel: 'auto',
      models: ['auto'],
      supportsVision: true, visionInputFormat: 'codex-local',
      contextWindowTokens: 400000, maxOutputTokens: 65536,
      localOnly: true
    },
    'openai-compatible': {
      label: '自定义 OpenAI 兼容接口', defaultModel: '', requiresBaseUrl: true,
      models: [], supportsVision: false, visionInputFormat: 'openai',
      contextWindowTokens: 32768, maxOutputTokens: 65536
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
      baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3',
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

  const FACTORY_EXPORTS = {
    openai: 'createOpenAIAdapter',
    anthropic: 'createAnthropicAdapter',
    gemini: 'createGeminiAdapter',
    deepseek: 'createDeepSeekAdapter',
    typesafe: 'createTypeSafeAdapter',
    'codex-local': 'createCodexLocalAdapter',
    'openai-compatible': 'createOpenAICompatibleAdapter'
  };

  function runtimeShared() {
    if (typeof globalThis !== 'undefined' && globalThis.SciLLM) {
      return globalThis.SciLLM;
    }
    return shared;
  }

  function getProviderDefinitions() {
    const definitions = JSON.parse(JSON.stringify(DEFINITIONS));
    const highlightVersion = runtimeShared().JEV_HIGHLIGHT_ALGORITHM_VERSION;
    const semanticFindVersion = runtimeShared().SEMANTIC_FIND_VERSION || 'semantic-find-v1';
    definitions.typesafe.taskAlgorithmVersions = {
      semantic_find: String(semanticFindVersion)
    };
    if (typeof highlightVersion === 'string' && highlightVersion) {
      definitions.typesafe.taskAlgorithmVersions.document_highlight = highlightVersion;
    }
    return definitions;
  }

  function getCompatibleProviderPresets() {
    return JSON.parse(JSON.stringify(COMPATIBLE_PROVIDER_PRESETS));
  }

  function noReasoningCapability() {
    return {
      supported: false,
      mode: 'none',
      levels: [],
      defaultLevel: 'auto'
    };
  }

  function reasoningCapability(mode, levels, defaultLevel = 'auto') {
    return {
      supported: true,
      mode,
      levels: [...levels],
      defaultLevel
    };
  }

  function getProviderReasoningCapabilities(providerId, config = {}) {
    const model = normalizedModelName(config);
    if (providerId === 'openai') {
      if (/\/chat\/completions(?:[/?#]|$)/i.test(String(config.baseUrl || ''))) {
        return noReasoningCapability();
      }
      if (/^(?:gpt-5(?:[-_.]|$)|o(?:1|3|4)(?:[-_.]|$))/.test(model)) {
        if (/^gpt-5-pro(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', ['auto', 'high']);
        }
        if (/^gpt-5\.(?:2|4)-pro(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', ['auto', 'medium', 'high', 'xhigh']);
        }
        if (/^gpt-5\.6(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'
          ]);
        }
        if (/^gpt-5\.1(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high'
          ]);
        }
        if (/^gpt-5\.(?:2|4)(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'none', 'low', 'medium', 'high', 'xhigh'
          ]);
        }
        if (/^gpt-5(?:$|-20\d{2}|-(?:mini|nano|codex)(?:[-_.]|$))/.test(model)) {
          return reasoningCapability('effort', [
            'auto', 'minimal', 'low', 'medium', 'high'
          ]);
        }
        if (/^o(?:1|3|4)(?:[-_.]|$)/.test(model)) {
          return reasoningCapability('effort', /(?:^|[-_.])pro(?:[-_.]|$)/.test(model)
            ? ['auto', 'high'] : ['auto', 'low', 'medium', 'high']);
        }
      }
      return noReasoningCapability();
    }
    if (providerId === 'anthropic') {
      const opus47Plus = /^claude-opus-4-(?:7|8)(?:[-_.]|$)/.test(model);
      const opus45 = /^claude-opus-4-5(?:[-_.]|$)/.test(model);
      const effortModel = /^claude-(?:sonnet-4-6|opus-4-(?:5|6|7|8))(?:[-_.]|$)/
        .test(model);
      if (!effortModel) return noReasoningCapability();
      return reasoningCapability('effort', opus47Plus
        ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
        : opus45
          ? ['auto', 'low', 'medium', 'high']
          : ['auto', 'low', 'medium', 'high', 'max']);
    }
    if (providerId === 'gemini') {
      if (/^gemini-3\.1-flash-lite-image(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'minimal', 'high']);
      }
      if (/^gemini-3-pro-preview(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'low', 'high']);
      }
      if (/^gemini-3\.1-pro-preview(?:[-_.]|$)/.test(model)) {
        return reasoningCapability('effort', ['auto', 'low', 'medium', 'high']);
      }
      if (/^gemini-(?:3\.(?:5|6)-flash(?:-lite)?|3\.1-flash-lite|3-flash-preview)(?:[-_.]|$)/
        .test(model)) {
        return reasoningCapability('effort', [
          'auto', 'minimal', 'low', 'medium', 'high'
        ]);
      }
      return noReasoningCapability();
    }
    if (providerId === 'deepseek') {
      // The official Chat Completions API lists deepseek-flash as a current
      // alias with the same explicit thinking toggle and effort controls.
      // Keep this exact so an undocumented future model is not inferred.
      return /^deepseek-(?:flash$|v4(?:[-_.]|$)|chat$|reasoner$)/.test(model)
        ? reasoningCapability('effort', ['low', 'high', 'max'], 'high')
        : noReasoningCapability();
    }
    if (providerId === 'codex-local') {
      return reasoningCapability('effort', [
        'auto', 'low', 'medium', 'high', 'xhigh'
      ]);
    }
    if (providerId === 'openai-compatible') {
      const mode = String(config.reasoningMode || '').trim().toLowerCase();
      if (mode === 'effort') {
        return reasoningCapability('effort', [
          'auto', 'minimal', 'low', 'medium', 'high', 'xhigh'
        ]);
      }
      if (mode === 'toggle') {
        return reasoningCapability('toggle', ['auto', 'enabled', 'disabled']);
      }
    }
    return noReasoningCapability();
  }

  function normalizeReasoningForProvider(providerId, config = {}, requested = {}) {
    const requestedEnabled = requested?.enabled === true;
    if (!requestedEnabled) return { enabled: false, effort: 'auto' };
    const capability = getProviderReasoningCapabilities(providerId, config);
    if (capability.supported !== true || !Array.isArray(capability.levels)) {
      return { enabled: false, effort: 'auto' };
    }
    if (capability.mode === 'toggle') {
      return capability.levels.includes('enabled')
        ? { enabled: true, effort: 'enabled' }
        : { enabled: false, effort: 'auto' };
    }

    let effort = String(requested?.effort || 'auto').trim().toLowerCase() || 'auto';
    if (providerId === 'deepseek') {
      if (effort === 'disabled' || effort === 'none') {
        return { enabled: false, effort: 'auto' };
      }
      if (effort === 'enabled' || effort === 'auto') effort = capability.defaultLevel;
      else if (effort === 'minimal') effort = 'low';
      else if (effort === 'medium' || effort === 'xhigh') effort = 'high';
    }
    if (effort === 'none' || effort === 'disabled') {
      return { enabled: false, effort: 'auto' };
    }
    if (effort === 'auto' || capability.levels.includes(effort)) {
      return { enabled: true, effort };
    }
    const fallback = capability.levels.includes(capability.defaultLevel)
      ? capability.defaultLevel : 'auto';
    return { enabled: true, effort: fallback };
  }

  function getProviderCapabilities(providerId, config = {}) {
    const definition = DEFINITIONS[providerId];
    if (!definition) return {
      supportsVision: false,
      visionInputFormat: 'none',
      reasoning: noReasoningCapability()
    };
    // Official model aliases served by DeepSeek-V4.1-Flash (2026-09-25).
    // Match the documented API names only; Pro and speculative suffixes stay text-only.
    const deepSeekVision = providerId === 'deepseek' && [
      'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'
    ].includes(normalizedModelName(config));
    const supportsVision = providerId === 'openai-compatible'
      ? config.supportsVision === true
      : deepSeekVision || definition.supportsVision === true;
    const capabilities = {
      supportsVision,
      visionInputFormat: supportsVision
        ? (deepSeekVision ? 'openai' : definition.visionInputFormat)
        : 'none',
      reasoning: getProviderReasoningCapabilities(providerId, config)
    };
    if (Array.isArray(definition.supportedTaskIds)) {
      capabilities.supportedTaskIds = [...definition.supportedTaskIds];
    }
    if (definition.textGeneration === false) capabilities.textGeneration = false;
    if (definition.typedDecisions === true) capabilities.typedDecisions = true;
    if (Array.isArray(definition.decisionTypes)) {
      capabilities.decisionTypes = [...definition.decisionTypes];
    }
    const algorithmVersion = runtimeShared().JEV_HIGHLIGHT_ALGORITHM_VERSION;
    const semanticFindVersion = runtimeShared().SEMANTIC_FIND_VERSION || 'semantic-find-v1';
    const taskAlgorithmVersions = definition.taskAlgorithmVersions || (
      providerId === 'typesafe'
        ? { semantic_find: String(semanticFindVersion) }
        : null
    );
    if (providerId === 'typesafe' && typeof algorithmVersion === 'string' &&
        algorithmVersion && taskAlgorithmVersions) {
      taskAlgorithmVersions.document_highlight = algorithmVersion;
    }
    if (taskAlgorithmVersions) {
      capabilities.taskAlgorithmVersions = { ...taskAlgorithmVersions };
    }
    if (Number(definition.maxStateQuestionTokens) > 0) {
      capabilities.maxStateQuestionTokens = Number(definition.maxStateQuestionTokens);
    }
    return capabilities;
  }

  function providerSupportsTask(providerId, taskId) {
    const definition = DEFINITIONS[providerId];
    if (!definition) return false;
    return !Array.isArray(definition.supportedTaskIds) ||
      definition.supportedTaskIds.includes(String(taskId || ''));
  }

  function validContextWindowOverride(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 8192 || numeric > 2000000) return null;
    return Math.round(numeric / 1024) * 1024;
  }

  function normalizedModelName(config = {}) {
    const model = String(config?.model || '').trim().toLowerCase();
    return model.split('/').at(-1) || model;
  }

  function knownModelCapacity(config = {}) {
    const model = normalizedModelName(config);
    if (/^deepseek-v4-(?:pro|flash)(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 1000000, maxOutputTokens: 384000 };
    }
    if (/^gpt-4\.1(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 1047576, maxOutputTokens: 65536 };
    }
    if (/^gpt-5(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 400000, maxOutputTokens: 65536 };
    }
    if (/^gemini-(?:2\.5|3(?:\.|-|$))/.test(model)) {
      return { contextWindowTokens: 1000000, maxOutputTokens: 65536 };
    }
    if (/^jev(?:[-_.]|$)/.test(model)) {
      return { contextWindowTokens: 64000, maxOutputTokens: 32768 };
    }
    return null;
  }

  function getProviderContextWindowTokens(providerId, config = {}, override = null) {
    const explicit = validContextWindowOverride(override);
    if (explicit) return explicit;
    const known = knownModelCapacity(config);
    if (known) return known.contextWindowTokens;
    return DEFINITIONS[providerId]?.contextWindowTokens || 32768;
  }

  function validOutputTokenOverride(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 512 || numeric > 2000000) return null;
    return Math.round(numeric);
  }

  function getProviderMaxOutputTokens(providerId, config = {}, override = null) {
    const explicit = validOutputTokenOverride(override);
    if (explicit) return explicit;
    const known = knownModelCapacity(config);
    if (known) return known.maxOutputTokens;
    return DEFINITIONS[providerId]?.maxOutputTokens || 65536;
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
    if (providerId === 'codex-local') {
      if (!String(config?.model || '').trim()) errors.push('model');
      const effort = String(config?.reasoningEffort || 'auto');
      if (!['auto', 'low', 'medium', 'high', 'xhigh'].includes(effort)) {
        errors.push('reasoningEffort');
      }
      return errors;
    }
    if (!String(config?.apiKey || '').trim()) errors.push('apiKey');
    if (!String(config?.model || '').trim()) errors.push('model');
    const baseUrl = String(config?.baseUrl || '').trim();
    if (providerId === 'typesafe' && baseUrl) {
      const normalized = baseUrl.replace(/\/+$/u, '');
      if (normalized !== 'https://api.typesafe.ai/v1' &&
          normalized !== 'https://api.typesafe.ai/v1/systemone') {
        errors.push('baseUrl');
      }
      return errors;
    }
    if ((DEFINITIONS[providerId].requiresBaseUrl || baseUrl) && !isHttpUrl(baseUrl)) {
      errors.push('baseUrl');
    }
    return errors;
  }

  function createProviderAdapter({ providerId, config, fetchImpl, nativeClient }) {
    const errors = validateProviderConfig(providerId, config);
    if (errors.length) throw new Error(`Invalid provider config: ${errors.join(',')}`);
    const factory = runtimeShared()[FACTORY_EXPORTS[providerId]];
    if (typeof factory !== 'function') {
      throw new Error(`Provider adapter is unavailable: ${providerId}`);
    }
    const adapterConfig = {
      ...config,
      __providerCapabilities: getProviderCapabilities(providerId, config),
      __reasoningCapabilities: getProviderReasoningCapabilities(providerId, config)
    };
    const adapter = providerId === 'codex-local'
      ? factory(config, nativeClient)
      : factory(adapterConfig, fetchImpl || fetch);
    adapter.maxOutputTokens = getProviderMaxOutputTokens(providerId, config);
    adapter.contextWindowTokens = getProviderContextWindowTokens(providerId, config);
    return adapter;
  }

  return {
    getProviderDefinitions,
    getCompatibleProviderPresets,
    getProviderCapabilities,
    providerSupportsTask,
    getProviderReasoningCapabilities,
    normalizeReasoningForProvider,
    getProviderContextWindowTokens,
    getProviderMaxOutputTokens,
    validateProviderConfig,
    createProviderAdapter
  };
});
