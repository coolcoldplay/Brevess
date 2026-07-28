(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function routeError(code, fields = []) {
    const error = new Error(code === 'NO_USABLE_PROFILE'
      ? 'No usable API profile is configured'
      : 'Task profile route is invalid');
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

  function requestBehaviorSignature(providerId, config) {
    if (providerId === 'deepseek') {
      return { thinking: config.thinking === true };
    }
    if (providerId === 'openai-compatible') {
      return {
        jsonMode: config.jsonMode !== false,
        supportsVision: config.supportsVision === true
      };
    }
    if (providerId === 'anthropic') {
      return { anthropicVersion: String(config.anthropicVersion || '2023-06-01') };
    }
    if (providerId === 'codex-local') {
      return { reasoningEffort: String(config.reasoningEffort || 'auto') };
    }
    return {};
  }

  function resolveTaskProfile(settings, taskType, requirements = {}) {
    if (!Array.isArray(shared.TASK_ROUTE_KEYS) ||
        !shared.TASK_ROUTE_KEYS.includes(taskType)) {
      throw routeError('INVALID_SETTINGS', ['taskType']);
    }

    const route = settings?.taskRoutes?.[taskType];
    const wantsProfile = route?.mode === 'profile';
    const requestedProfileId = wantsProfile ? String(route.profileId || '') : null;
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

    if (!wantsProfile || fallbackReason) {
      effectiveProfileId = String(settings?.globalProfileId || '');
      effectiveProfile = profileAt(settings, effectiveProfileId);
    }
    if (!profileUsable(effectiveProfile)) {
      throw routeError('NO_USABLE_PROFILE');
    }

    const config = cloneJsonLike(effectiveProfile.config || {});
    const tokenPolicy = cloneJsonLike(effectiveProfile.tokenPolicy || {});
    const capabilities = shared.getProviderCapabilities(
      effectiveProfile.providerId,
      config
    );
    const supportsVision = capabilities.supportsVision === true;
    const capabilityMode = requirements?.vision === true
      ? (supportsVision ? 'vision' : 'caption_text_only')
      : 'text';
    const model = String(config.model || '');
    const profileSignature = shared.stableHash({
      profileId: effectiveProfileId,
      providerId: effectiveProfile.providerId,
      model,
      endpoint: normalizeEndpoint(config.baseUrl),
      capabilityMode,
      requestBehavior: requestBehaviorSignature(effectiveProfile.providerId, config)
    });

    return {
      taskType,
      requestedProfileId,
      effectiveProfileId,
      providerId: effectiveProfile.providerId,
      model,
      config,
      tokenPolicy,
      capabilityMode,
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
    requestBehaviorSignature
  };
});
