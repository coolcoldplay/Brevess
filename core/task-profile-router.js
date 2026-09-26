(function attach(root, factory) {
  const isCommonJs = typeof module === 'object' && module.exports;
  const shared = root.SciLLM || {};
  if (isCommonJs) {
    Object.assign(shared, require('./llm-task-catalog.js'));
    Object.assign(shared, require('./jev-highlight.js'));
    Object.assign(shared, require('./semantic-find.js'));
    Object.assign(shared, require('../providers/provider-registry.js'));
  }
  const api = factory(shared);
  if (isCommonJs) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function routeError(code, fields = []) {
    const messages = {
      NO_USABLE_PROFILE: 'No usable API profile is configured',
      CAPABILITY_MISMATCH: 'Selected API profile does not satisfy task capabilities',
      INVALID_SETTINGS: 'Task profile route is invalid'
    };
    const error = new Error(messages[code] || messages.INVALID_SETTINGS);
    error.code = code;
    error.fields = fields;
    return error;
  }

  function profileUsable(profile) {
    if (!profile?.id || typeof shared.validateProviderConfig !== 'function') return false;
    try {
      return shared.validateProviderConfig(
        profile.providerId,
        profile.config || {}
      ).length === 0;
    } catch (_) {
      return false;
    }
  }

  function normalizeEndpoint(value) {
    if (!String(value || '').trim()) return 'official';
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid';
      const pathname = url.pathname.replace(/\/+$/, '');
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`;
    } catch (_) {
      return 'invalid';
    }
  }

  function cloneJsonLike(value, depth = 0, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 64) return null;
    if (seen.has(value)) return seen.get(value);
    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    Object.entries(value).forEach(([key, nested]) => {
      clone[key] = cloneJsonLike(nested, depth + 1, seen);
    });
    return clone;
  }

  function profileAt(settings, profileId) {
    if (!profileId || !settings?.profiles ||
        !Object.prototype.hasOwnProperty.call(settings.profiles, profileId)) return null;
    const profile = settings.profiles[profileId];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
    return { ...profile, id: profileId };
  }

  function requestBehaviorSignature(
    providerId,
    config,
    effectiveReasoning = null,
    taskId = 'document_highlight'
  ) {
    const reasoning = effectiveReasoning || (
      typeof shared.normalizeReasoningForProvider === 'function'
        ? shared.normalizeReasoningForProvider(providerId, config, {
          enabled: config.reasoningEnabled === true || config.thinking === true,
          effort: config.reasoningEffort || 'auto'
        })
        : { enabled: false, effort: 'auto' }
    );
    if (providerId === 'deepseek') {
      return { reasoning };
    }
    if (providerId === 'typesafe') {
      const capabilities = shared.getProviderCapabilities(providerId, config);
      if (taskId === 'semantic_find') {
        return {
          typedDecisions: true,
          semanticFindAlgorithmVersion: String(
            shared.SEMANTIC_FIND_VERSION ||
            capabilities.taskAlgorithmVersions?.semantic_find ||
            'semantic-find-v1'
          )
        };
      }
      return {
        typedDecisions: true,
        highlightAlgorithmVersion:
          String(shared.JEV_HIGHLIGHT_ALGORITHM_VERSION ||
            capabilities.taskAlgorithmVersions?.document_highlight || '')
      };
    }
    if (providerId === 'openai-compatible') {
      return {
        jsonMode: config.jsonMode !== false,
        supportsVision: config.supportsVision === true,
        reasoningMode: String(config.reasoningMode || 'none'),
        reasoning
      };
    }
    if (providerId === 'anthropic') {
      return {
        anthropicVersion: String(config.anthropicVersion || '2023-06-01'),
        reasoning
      };
    }
    if (providerId === 'codex-local') {
      return { reasoning };
    }
    if (providerId === 'openai' || providerId === 'gemini') {
      return { reasoning };
    }
    return {};
  }

  function satisfiesTypedDecisionRequirements(definition, capabilities) {
    if (definition.requirements?.typedDecisions !== true) return true;
    if (capabilities.typedDecisions !== true) return false;
    const decisionType = String(definition.requirements?.decisionType || '');
    return !decisionType || (
      Array.isArray(capabilities.decisionTypes) &&
      capabilities.decisionTypes.includes(decisionType)
    );
  }

  function normalizedTokenCap(value) {
    if (value === null || value === undefined || value === '' ||
        typeof value === 'boolean') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 512 || numeric > 2000000) return null;
    return Math.round(numeric);
  }

  function normalizeEffectiveTokenPolicy(value, providerId, config) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? cloneJsonLike(value) : {};
    const mode = source.mode === 'manual' ? 'manual' : 'auto';
    const manualMax = mode === 'manual'
      ? normalizedTokenCap(source.manualMax) || 4096 : null;
    const autoCap = mode === 'auto' ? normalizedTokenCap(source.autoCap) : null;
    const providerCap = shared.getProviderMaxOutputTokens(providerId, config);
    const configuredCap = mode === 'manual' ? manualMax : autoCap;
    const effectiveCap = Math.min(providerCap, configuredCap || providerCap);
    return {
      tokenPolicy: { ...source, mode, manualMax, autoCap },
      signature: { mode, manualMax, autoCap, effectiveCap },
      effectiveCap
    };
  }

  function resolveTaskProfile(settings, taskId) {
    const definition = shared.getLlmTaskDefinition(taskId);
    const policy = settings?.taskPolicies?.[taskId];
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw routeError('INVALID_SETTINGS', [`taskPolicies.${taskId}`]);
    }

    const wantsProfile = policy.mode === 'profile';
    const requestedProfileId = wantsProfile ? String(policy.profileId || '') : null;
    const requestedProfileExists = wantsProfile && Boolean(settings?.profiles) &&
      Object.prototype.hasOwnProperty.call(settings.profiles, requestedProfileId);
    let effectiveProfileId = requestedProfileId;
    let effectiveProfile = wantsProfile
      ? profileAt(settings, requestedProfileId) : null;
    let fallbackReason = null;

    if (wantsProfile && !requestedProfileExists) fallbackReason = 'PROFILE_MISSING';
    else if (wantsProfile && !profileUsable(effectiveProfile)) {
      fallbackReason = 'PROFILE_UNAVAILABLE';
    }

    const requiresTypedDecisions = definition.requirements?.typedDecisions === true;
    if (requiresTypedDecisions && fallbackReason) {
      throw routeError('NO_USABLE_PROFILE', [`taskPolicies.${taskId}.profileId`]);
    }

    if (!wantsProfile || fallbackReason) {
      effectiveProfileId = String(settings?.globalProfileId || '');
      effectiveProfile = profileAt(settings, effectiveProfileId);
    }
    if (!profileUsable(effectiveProfile)) {
      throw routeError('NO_USABLE_PROFILE');
    }

    const config = cloneJsonLike(effectiveProfile.config || {});
    const normalizedTokenPolicy = normalizeEffectiveTokenPolicy(
      effectiveProfile.tokenPolicy, effectiveProfile.providerId, config
    );
    const tokenPolicy = normalizedTokenPolicy.tokenPolicy;
    const capabilities = shared.getProviderCapabilities(
      effectiveProfile.providerId,
      config
    );
    const supportsVision = capabilities.supportsVision === true;
    const requiresVision = definition.requirements?.vision === true;
    const supportsTask = typeof shared.providerSupportsTask !== 'function' ||
      shared.providerSupportsTask(effectiveProfile.providerId, taskId);
    if (!supportsTask || !satisfiesTypedDecisionRequirements(definition, capabilities)) {
      throw routeError(
        requiresTypedDecisions ? 'NO_USABLE_PROFILE' : 'CAPABILITY_MISMATCH',
        [`taskPolicies.${taskId}.profileId`]
      );
    }
    // Caption/body interpretation is an input mode supported by Figure tasks.
    // allowTextFallback separately governs retrying rejected visual input as text.
    const supportsCaptionContext = definition.requirements?.captionContext === true;
    if (requiresVision && !supportsVision && !supportsCaptionContext &&
        policy.allowTextFallback !== true) {
      throw routeError(
        'CAPABILITY_MISMATCH',
        [`taskPolicies.${taskId}.profileId`]
      );
    }
    const capabilityMode = capabilities.textGeneration === false
      ? 'text_classification'
      : requiresVision
      ? (supportsVision ? 'vision' : 'caption_text_only')
      : 'text';
    const effectiveReasoning = shared.normalizeReasoningForProvider(
      effectiveProfile.providerId,
      config,
      {
        enabled: policy.reasoningEnabled === true,
        effort: policy.reasoningEffort || definition.defaultReasoning
      }
    );
    delete config.thinking;
    config.reasoningEnabled = effectiveReasoning.enabled;
    config.reasoningEffort = effectiveReasoning.effort;
    const model = String(config.model || '');
    const profileSignature = shared.stableHash({
      profileId: effectiveProfileId,
      providerId: effectiveProfile.providerId,
      model,
      outputLanguage: String(settings?.language || '').toLowerCase().startsWith('en')
        ? 'en' : 'zh-CN',
      endpoint: normalizeEndpoint(config.baseUrl),
      capabilityMode,
      requestBehavior: requestBehaviorSignature(
        effectiveProfile.providerId,
        config,
        effectiveReasoning,
        taskId
      ),
      tokenPolicy: normalizedTokenPolicy.signature
    });

    return {
      taskId,
      taskType: taskId,
      requestedProfileId,
      effectiveProfileId,
      providerId: effectiveProfile.providerId,
      model,
      config,
      tokenPolicy,
      effectiveTokenPolicyCap: normalizedTokenPolicy.effectiveCap,
      capabilityMode,
      effectiveReasoning,
      fallbackReason,
      profileSignature,
      publicProfile: {
        id: effectiveProfileId,
        name: String(effectiveProfile.name || ''),
        providerId: effectiveProfile.providerId,
        model,
        supportsVision
      }
    };
  }

  return {
    routeError, resolveTaskProfile, profileUsable, normalizeEndpoint,
    requestBehaviorSignature, normalizeEffectiveTokenPolicy
  };
});
