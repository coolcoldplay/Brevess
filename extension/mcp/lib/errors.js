'use strict';

class BrevessMcpError extends Error {
  constructor(code, message, details = undefined, options = {}) {
    super(String(message || code));
    this.name = 'BrevessMcpError';
    this.code = String(code || 'BREVESS_MCP_ERROR');
    if (details !== undefined) this.details = details;
    this.retryable = options.retryable === true;
    if (Array.isArray(options.nextActions)) this.nextActions = options.nextActions;
    if (Number.isFinite(options.status)) this.status = Number(options.status);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function asError(value, fallbackCode = 'BREVESS_MCP_ERROR') {
  if (value instanceof BrevessMcpError) return value;
  const error = new BrevessMcpError(
    value?.code || fallbackCode,
    value?.message || String(value || fallbackCode),
    value?.details,
    {
      retryable: value?.retryable === true,
      nextActions: value?.nextActions,
      status: value?.status,
      cause: value
    }
  );
  if (value?.stack) error.stack = value.stack;
  return error;
}

function serializeError(value) {
  const error = asError(value);
  return {
    code: error.code,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    retryable: error.retryable === true,
    ...(Array.isArray(error.nextActions) && error.nextActions.length
      ? { nextActions: error.nextActions }
      : {})
  };
}

function publicError(error) {
  const value = asError(error);
  const nextActions = Array.isArray(value.nextActions) ? [...value.nextActions] : [];
  if (!nextActions.length) {
    if (new Set([
      'WORKBENCH_AGENT_STALE_REVISION',
      'WORKBENCH_AGENT_PROJECT_CHANGED',
      'WORKBENCH_REVISION_CONFLICT',
      'WORKBENCH_VIEW_CONFLICT',
      'WORKBENCH_SELECTION_CONFLICT'
    ]).has(value.code)) {
      nextActions.push({
        tool: 'workbench.read_context',
        reason: 'Read the latest revision before retrying the write.'
      });
    } else if (value.code === 'BRIDGE_UNAVAILABLE') {
      nextActions.push({
        action: 'open_connect_page',
        reason: 'Open the BREVESS Workbench with the MCP bridge enabled.'
      });
    } else if (String(value.code).startsWith('AGENT_LOCAL_DATA_APPROVAL_')) {
      nextActions.push({
        action: 'human_approval',
        reason: 'Approve the pending preview in the BREVESS Workbench.'
      });
    }
  }
  return {
    code: value.code,
    message: value.message,
    ...(value.details !== undefined ? { details: value.details } : {}),
    retryable: value.retryable === true,
    ...(nextActions.length ? { nextActions } : {})
  };
}

module.exports = {
  BrevessMcpError,
  asError,
  serializeError,
  publicError
};
