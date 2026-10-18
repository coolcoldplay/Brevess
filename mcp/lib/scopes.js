'use strict';

const crypto = require('node:crypto');
const { BrevessMcpError } = require('./errors.js');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;

function sanitizeOperations(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 80) {
    throw new BrevessMcpError('MCP_WRITE_SCOPE_INVALID', 'Write scope operations must be a non-empty array.', {
      field: 'operations',
      maximum: 80
    });
  }
  const set = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{2,159}$/u.test(value)) {
      throw new BrevessMcpError('MCP_WRITE_SCOPE_INVALID', 'Write scope operation names are invalid.', {
        field: 'operations',
        reason: 'format'
      });
    }
    set.add(value);
  }
  return [...set];
}

class WriteScopeManager {
  constructor(options = {}) {
    this.scope = null;
    this.pending = null;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  current() {
    if (!this.scope) return null;
    if (this.scope.expiresAt <= this.now()) {
      this.scope = null;
      return null;
    }
    return this.scope;
  }

  status() {
    const scope = this.current();
    return {
      granted: !!scope,
      scope: scope ? this.publicScope(scope) : null,
      pending: this.pending ? this.publicPending(this.pending) : null
    };
  }

  publicScope(scope) {
    return {
      scopeId: scope.scopeId,
      projectId: scope.projectId,
      operations: [...scope.operations],
      bootstrap: scope.bootstrap === true,
      createdAt: scope.createdAt,
      expiresAt: scope.expiresAt,
      approvalId: scope.approvalId || null
    };
  }

  publicPending(pending) {
    return {
      status: 'PENDING_HUMAN_ACTION',
      approvalId: pending.approvalId,
      expiresAt: pending.expiresAt,
      bootstrap: pending.bootstrap === true,
      preview: pending.preview || null
    };
  }

  request(args) {
    const ttlMs = Number.isSafeInteger(args?.ttlMs)
      ? args.ttlMs
      : Number.isSafeInteger(args?.ttlSeconds)
        ? args.ttlSeconds * 1000
        : DEFAULT_TTL_MS;
    if (ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new BrevessMcpError('MCP_WRITE_SCOPE_INVALID', 'Write scope TTL is outside the allowed range.', {
        field: 'ttlMs',
        minimum: MIN_TTL_MS,
        maximum: MAX_TTL_MS
      });
    }
    const operations = sanitizeOperations(args?.operations);
    const bootstrap = args?.bootstrap === true;
    const projectId = typeof args?.projectId === 'string' && args.projectId ? args.projectId : null;
    if (bootstrap && (projectId !== null ||
        operations.length !== 1 || operations[0] !== 'workbench.create_project')) {
      throw new BrevessMcpError(
        'MCP_BOOTSTRAP_SCOPE_INVALID',
        'Bootstrap write scope requires projectId:null and exactly the create_project operation.',
        {
          field: 'bootstrap',
          correction: 'Use {projectId:null,bootstrap:true,operations:["workbench.create_project"]}.'
        }
      );
    }
    const approvalId = typeof args?.approvalId === 'string' && args.approvalId ? args.approvalId : null;
    if (this.pending && !approvalId) {
      return this.publicPending(this.pending);
    }
    return {
      status: 'REQUEST',
      projectId,
      operations,
      reason: typeof args?.reason === 'string' ? args.reason.slice(0, 4000) : '',
      ttlMs,
      taskId: typeof args?.taskId === 'string' ? args.taskId.slice(0, 160) : null,
      bootstrap,
      approvalId
    };
  }

  applyHostResult(value, request = {}) {
    if (!value || typeof value !== 'object') return value;
    if (value.success === true && value.data && typeof value.data === 'object') {
      value = value.data;
    }
    if (value.status === 'PENDING_HUMAN_ACTION' || value.pending === true) {
      const approvalId = typeof value.approvalId === 'string' ? value.approvalId : `approval-${crypto.randomUUID()}`;
      const expiresAt = Number.isFinite(value.expiresAt) ? value.expiresAt : this.now() + 120000;
      this.pending = {
        approvalId,
        expiresAt,
        bootstrap: request.bootstrap === true,
        preview: value.preview || null
      };
      return { ...value, approvalId, expiresAt };
    }
    const scopeToken = typeof value.scopeToken === 'string' ? value.scopeToken
      : typeof value.token === 'string' ? value.token
        : '';
    if (value.status === 'GRANTED' || value.granted === true || scopeToken) {
      if (!scopeToken) {
        throw new BrevessMcpError(
          'MCP_WRITE_SCOPE_TOKEN_MISSING',
          'The Workbench host granted a write scope without a bridge-only scopeToken.',
          {
            correction: 'Return a server-side scopeToken; never expose it to the external MCP client.'
          }
        );
      }
      const operations = sanitizeOperations([
        ...(value.operations || request.operations || []),
        ...(request.hostOperations || [])
      ]);
      const projectId = typeof value.projectId === 'string' ? value.projectId : request.projectId;
      const expiresAt = Number.isFinite(value.expiresAt)
        ? value.expiresAt
        : this.now() + (request.ttlMs || DEFAULT_TTL_MS);
      this.scope = {
        scopeId: typeof value.scopeId === 'string' && value.scopeId
          ? value.scopeId
          : `scope-${crypto.randomUUID()}`,
        projectId: projectId || null,
        operations: new Set(operations),
        bootstrap: request.bootstrap === true,
        createdAt: this.now(),
        expiresAt,
        approvalId: value.approvalId || request.approvalId || null,
        hostToken: scopeToken
      };
      this.pending = null;
      const publicValue = { ...value };
      delete publicValue.scopeToken;
      delete publicValue.token;
      delete publicValue.writeScopeToken;
      return {
        ...publicValue,
        ...(value.scope || typeof value.scope === 'object' ? { scope: this.publicScope(this.scope) } : {}),
        granted: true,
        status: 'GRANTED'
      };
    }
    if (value.status === 'DENIED' || value.denied === true) {
      this.pending = null;
      return { ...value, status: 'DENIED' };
    }
    return value;
  }

  mergeHostStatus(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.writeScope) {
      const hostScope = value.writeScope;
      if (hostScope.status === 'GRANTED' && (hostScope.scopeToken || hostScope.token)) {
        this.applyHostResult({ ...hostScope, status: 'GRANTED' }, hostScope);
      } else if (hostScope.status === 'PENDING_HUMAN_ACTION') {
        this.applyHostResult(hostScope, hostScope);
      }
    }
    if (value.writeScope && typeof value.writeScope === 'object') {
      delete value.writeScope.scopeToken;
      delete value.writeScope.token;
      delete value.writeScope.writeScopeToken;
    }
    return value;
  }

  require(projectId, operation, aliases = []) {
    const scope = this.current();
    if (!scope) {
      throw new BrevessMcpError(
        'MCP_WRITE_SCOPE_REQUIRED',
        'A task-level write scope is required for this mutation.',
        {
          status: 'PENDING_HUMAN_ACTION',
          operation,
          requestTool: 'brevess.request_write_scope',
          correction: 'Request a scoped write approval from the user, then retry with a fresh expectedRevision.'
        },
        {
          nextActions: [{
            tool: 'brevess.request_write_scope',
            reason: 'Ask the human to approve routine writes for this task.'
          }]
        }
      );
    }
    if (scope.expiresAt <= this.now()) {
      this.scope = null;
      throw new BrevessMcpError('MCP_WRITE_SCOPE_EXPIRED', 'The task-level write scope expired.', {
        status: 'PENDING_HUMAN_ACTION',
        operation,
        requestTool: 'brevess.request_write_scope'
      });
    }
    if (scope.projectId && projectId && scope.projectId !== projectId) {
      throw new BrevessMcpError(
        'MCP_WRITE_SCOPE_PROJECT_MISMATCH',
        'The active write scope belongs to another project.',
        {
          field: 'expectedProjectId',
          scopeProjectId: scope.projectId,
          expectedProjectId: projectId
        }
      );
    }
    const accepted = [operation, ...aliases].filter(Boolean);
    if (!scope.operations.has('*') && !accepted.some(name => scope.operations.has(name))) {
      throw new BrevessMcpError(
        'MCP_WRITE_SCOPE_DENIED',
        'The active write scope does not include this operation.',
        {
          operation,
          allowedOperations: [...scope.operations],
          correction: 'Request a new scope for the intended operation.'
        }
      );
    }
    return scope;
  }

  revoke(scopeId = null) {
    const current = this.current();
    if (scopeId && current && current.scopeId !== scopeId) {
      throw new BrevessMcpError('MCP_WRITE_SCOPE_NOT_FOUND', 'The write scope does not match.', {
        field: 'scopeId'
      });
    }
    const revoked = current ? this.publicScope(current) : null;
    this.scope = null;
    this.pending = null;
    return { revoked: !!revoked, scope: revoked };
  }

  consume(scopeId) {
    const current = this.current();
    if (!current || current.scopeId !== scopeId) return false;
    this.scope = null;
    return true;
  }
}

module.exports = {
  WriteScopeManager,
  DEFAULT_TTL_MS,
  MIN_TTL_MS,
  MAX_TTL_MS
};
