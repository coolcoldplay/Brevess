'use strict';

const crypto = require('node:crypto');
const { BrevessMcpError, asError, publicError } = require('./errors.js');

const BRIDGE_PROTOCOL_VERSION = 1;
const DEFAULT_POLL_WAIT_MS = 20000;
const DEFAULT_TOOL_TIMEOUT_MS = 300000;
const DEFAULT_BRIDGE_STALE_MS = 70000;
const MAX_META_STRING = 240;

function text(value, maximum = MAX_META_STRING) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function tokenEqual(received, expected) {
  const left = Buffer.from(String(received || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function publicBridge(bridge) {
  if (!bridge) return null;
  return {
    id: bridge.id,
    name: bridge.name,
    extensionVersion: bridge.extensionVersion,
    protocolVersion: bridge.protocolVersion,
    platform: bridge.platform,
    lastSeenAt: bridge.lastSeenAt,
    connected: Date.now() - bridge.lastSeenAt <= bridge.staleAfterMs
  };
}

class BridgeHub {
  constructor(options = {}) {
    this.token = String(options.token || '');
    if (!this.token) throw new BrevessMcpError('MCP_TOKEN_REQUIRED', 'A local bridge token is required.');
    this.allowWrite = options.allowWrite === true;
    this.pollWaitMs = Number.isSafeInteger(options.pollWaitMs) ? options.pollWaitMs : DEFAULT_POLL_WAIT_MS;
    this.toolTimeoutMs = Number.isSafeInteger(options.toolTimeoutMs)
      ? options.toolTimeoutMs
      : DEFAULT_TOOL_TIMEOUT_MS;
    this.bridgeStaleMs = Number.isSafeInteger(options.bridgeStaleMs)
      ? options.bridgeStaleMs
      : DEFAULT_BRIDGE_STALE_MS;
    this.connectUrl = text(options.connectUrl, 2000);
    this.audit = typeof options.audit === 'function' ? options.audit : () => {};
    this.bridge = null;
    this.waiter = null;
    this.controlWaiter = null;
    this.queue = [];
    this.controlQueue = [];
    this.active = null;
    this.jobs = new Map();
    this.closed = false;
  }

  authorize(value) {
    if (!tokenEqual(value, this.token)) {
      throw new BrevessMcpError('BRIDGE_UNAUTHORIZED', 'The MCP bridge token is missing or invalid.', {
        field: 'authorization',
        correction: 'Open the one-time connect page printed by the MCP server.'
      }, { status: 401 });
    }
  }

  isBridgeOnline() {
    return !!this.bridge && Date.now() - this.bridge.lastSeenAt <= this.bridge.staleAfterMs;
  }

  requireBridge() {
    if (!this.isBridgeOnline()) {
      throw new BrevessMcpError(
        'BRIDGE_UNAVAILABLE',
        'The BREVESS Workbench MCP bridge is not connected.',
        {
          bridge: publicBridge(this.bridge),
          connectUrl: this.connectUrl || null,
          correction: 'Open the BREVESS Workbench from the MCP connect page and leave the tab open.'
        },
        {
          retryable: true,
          nextActions: this.connectUrl
            ? [{ action: 'open_url', url: this.connectUrl, reason: 'Pair the extension bridge.' }]
            : []
        }
      );
    }
  }

  status() {
    return {
      online: this.isBridgeOnline(),
      bridge: publicBridge(this.bridge),
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      scopes: this.allowWrite ? ['read', 'write'] : ['read'],
      queued: this.queue.length,
      activeRequestId: this.active?.id || null,
      tokenConfigured: true
    };
  }

  register(meta) {
    const protocolVersion = Number(meta?.protocolVersion);
    if (protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BrevessMcpError(
        'BRIDGE_VERSION_MISMATCH',
        `The extension bridge protocol is ${protocolVersion || 'missing'}; this MCP server requires ${BRIDGE_PROTOCOL_VERSION}.`,
        {
          expected: BRIDGE_PROTOCOL_VERSION,
          received: protocolVersion || null,
          field: 'protocolVersion'
        },
        { status: 409 }
      );
    }
    const id = text(meta.clientId, 160);
    if (!id || !/^[A-Za-z0-9._:-]{6,160}$/u.test(id)) {
      throw new BrevessMcpError('BRIDGE_CLIENT_INVALID', 'A stable bridge clientId is required.', {
        field: 'clientId'
      }, { status: 400 });
    }
    this.bridge = {
      id,
      name: text(meta.name, 120) || 'BREVESS Workbench',
      extensionVersion: text(meta.extensionVersion, 80) || 'unknown',
      protocolVersion,
      platform: text(meta.platform, 80),
      lastSeenAt: Date.now(),
      staleAfterMs: this.bridgeStaleMs
    };
    return publicBridge(this.bridge);
  }

  poll(meta) {
    if (this.closed) {
      throw new BrevessMcpError('BRIDGE_CLOSED', 'The MCP bridge is shutting down.', undefined, {
        retryable: true,
        status: 503
      });
    }
    const bridge = this.register(meta);
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve({ type: 'reconnect', bridge });
      this.waiter = null;
    }
    if (!this.active && this.queue.length) return Promise.resolve(this._sendNext());
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: value => resolve(value),
        reject: error => reject(error),
        timer: null
      };
      waiter.timer = setTimeout(() => {
        if (this.waiter === waiter) this.waiter = null;
        resolve({ type: 'idle', bridge, waitMs: this.pollWaitMs });
      }, this.pollWaitMs);
      this.waiter = waiter;
      this.bridge.lastSeenAt = Date.now();
    });
  }

  controlPoll(meta) {
    this.register(meta);
    if (this.controlQueue.length) return Promise.resolve(this.controlQueue.shift());
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: value => resolve(value),
        reject: error => reject(error),
        timer: null
      };
      waiter.timer = setTimeout(() => {
        if (this.controlWaiter === waiter) this.controlWaiter = null;
        resolve({ type: 'idle' });
      }, this.pollWaitMs);
      this.controlWaiter = waiter;
    });
  }

  _sendNext() {
    const job = this.queue.shift();
    if (!job) return { type: 'idle', bridge: publicBridge(this.bridge) };
    job.sent = true;
    job.sentAt = Date.now();
    this.active = job;
    return {
      type: 'call',
      requestId: job.id,
      mcpRequestId: job.mcpRequestId,
      name: job.name,
      args: job.args,
      hostOptions: job.hostOptions || {},
      timeoutMs: job.timeoutMs,
      bridge: publicBridge(this.bridge)
    };
  }

  call(name, args, options = {}) {
    this.requireBridge();
    if (this.closed) {
      throw new BrevessMcpError('BRIDGE_CLOSED', 'The MCP bridge is shutting down.', undefined, {
        retryable: true
      });
    }
    const timeoutMs = Number.isSafeInteger(options.timeoutMs) ? options.timeoutMs : this.toolTimeoutMs;
    const id = `job-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const job = {
        id,
        mcpRequestId: text(options.mcpRequestId, 160),
        name: text(name, 160),
        args,
        hostOptions: options.hostOptions && typeof options.hostOptions === 'object'
          ? { ...options.hostOptions }
          : {},
        timeoutMs,
        resolve,
        reject,
        sent: false,
        sentAt: 0,
        timer: null
      };
      job.timer = setTimeout(() => {
        if (this.jobs.get(id) !== job) return;
        this.jobs.delete(id);
        if (this.active === job) this.active = null;
        else this.queue = this.queue.filter(row => row !== job);
        reject(new BrevessMcpError(
          job.sent ? 'BRIDGE_RESULT_UNKNOWN' : 'BRIDGE_QUEUE_TIMEOUT',
          job.sent
            ? 'The bridge received this operation but did not return a receipt. Do not retry blindly; read the current context first.'
            : 'The operation waited too long for the Workbench bridge.',
          { requestId: id, operation: job.name, sent: job.sent },
          {
            retryable: !job.sent,
            nextActions: job.sent
              ? [{ tool: 'workbench.read_context', reason: 'Verify whether the operation was persisted.' }]
              : []
          }
        ));
        this._drainWaiter();
      }, timeoutMs);
      job.timer.unref?.();
      this.jobs.set(id, job);
      this.queue.push(job);
      this._drainWaiter();
    });
  }

  _drainWaiter() {
    if (this.active || !this.queue.length || !this.waiter) return;
    const waiter = this.waiter;
    this.waiter = null;
    clearTimeout(waiter.timer);
    try {
      waiter.resolve(this._sendNext());
    } catch (error) {
      waiter.reject(error);
    }
  }

  result(requestId, payload) {
    const job = this.active;
    if (!job || job.id !== requestId) {
      throw new BrevessMcpError(
        'BRIDGE_REQUEST_NOT_ACTIVE',
        'This bridge result does not match the active request; it was not applied.',
        { requestId: text(requestId, 160), activeRequestId: job?.id || null },
        { status: 409 }
      );
    }
    clearTimeout(job.timer);
    this.jobs.delete(job.id);
    this.active = null;
    if (this.bridge) this.bridge.lastSeenAt = Date.now();
    if (payload?.success === true) {
      job.resolve(payload.result);
    } else {
      const error = payload?.error || {};
      job.reject(new BrevessMcpError(
        error.code || 'BRIDGE_OPERATION_FAILED',
        error.message || 'The Workbench operation failed.',
        error.details,
        {
          retryable: error.retryable === true,
          nextActions: error.nextActions
        }
      ));
    }
    this._drainWaiter();
    return { accepted: true, requestId: job.id };
  }

  cancel(mcpRequestId) {
    const target = [...this.jobs.values()].find(job => job.mcpRequestId === mcpRequestId);
    if (!target) return { cancelled: false, reason: 'not_found' };
    if (!target.sent) {
      this.queue = this.queue.filter(job => job !== target);
      this.jobs.delete(target.id);
      clearTimeout(target.timer);
      target.reject(new BrevessMcpError('CANCELLED', 'The queued operation was cancelled before execution.', {
        requestId: target.id
      }));
      return { cancelled: true, requestId: target.id, sent: false };
    }
    const control = {
      type: 'cancel',
      requestId: `control-${crypto.randomUUID()}`,
      targetRequestId: target.id,
      reason: 'client_cancelled'
    };
    if (this.controlWaiter) {
      const waiter = this.controlWaiter;
      this.controlWaiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(control);
    } else {
      this.controlQueue.push(control);
    }
    return { cancelled: true, requestId: target.id, sent: true };
  }

  close(error) {
    this.closed = true;
    const failure = asError(error || new BrevessMcpError('BRIDGE_CLOSED', 'The MCP bridge closed.'));
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve({ type: 'closed' });
      this.waiter = null;
    }
    if (this.controlWaiter) {
      clearTimeout(this.controlWaiter.timer);
      this.controlWaiter.resolve({ type: 'closed' });
      this.controlWaiter = null;
    }
    for (const job of [...this.jobs.values()]) {
      clearTimeout(job.timer);
      job.reject(failure);
    }
    this.jobs.clear();
    this.queue.length = 0;
    this.active = null;
  }

  diagnostics() {
    return {
      ...this.status(),
      jobs: [...this.jobs.values()].map(job => ({
        requestId: job.id,
        name: job.name,
        sent: job.sent,
        sentAt: job.sentAt
      }))
    };
  }
}

module.exports = {
  BRIDGE_PROTOCOL_VERSION,
  BridgeHub,
  tokenEqual,
  publicError
};
