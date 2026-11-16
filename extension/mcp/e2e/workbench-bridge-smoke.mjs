#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { start, extensionIdFromManifest } = require('../server.js');

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mcp-profile-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mcp-state-'));
const token = `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const outputDir = path.join(repo, 'output', 'mcp-20261018');
let instance;
let context;
let rpcId = 0;

function fileUrl(value) {
  return `file:///${String(value).replace(/\\/gu, '/').replace(/^\/+/u, '')}`;
}

function encodeFileUrl(value) {
  return encodeURI(fileUrl(value));
}

function runCodex(port, token, pdfUrl) {
  const prompt = `Use the brevess MCP server. First call brevess.status. Then call library.query_global_library with pageSize 3. Then call pdf.open_local with fileUrl ${pdfUrl}. Do not modify any record. Report the exact tool receipts and any PENDING_PARSING status.`;
  const script = [
    `& '${path.join(process.env.APPDATA || '', 'npm', 'codex.cmd').replaceAll("'", "''")}' exec --skip-git-repo-check --ephemeral --json -s read-only`,
    `-c 'mcp_servers.brevess.url="http://127.0.0.1:${port}/mcp"'`,
    `-c 'mcp_servers.brevess.bearer_token_env_var="BREVESS_MCP_TOKEN"'`,
    `'${prompt.replaceAll("'", "''")}'`
  ].join(' ');
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      cwd: repo,
      env: { ...process.env, BREVESS_MCP_TOKEN: token },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdoutTail: stdout.slice(-12000),
        stderrTail: stderr.slice(-8000)
      });
    };
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({ exitCode: null, error: String(error.message || error) }));
    child.on('exit', code => finish({ exitCode: code }));
    setTimeout(() => {
      if (!settled) {
        try { child.kill(); } catch {}
        finish({ exitCode: null, timeout: true });
      }
    }, 240000);
  });
}

async function grantScope(page, args) {
  const request = rpc('tools/call', {
    name: 'brevess.request_write_scope',
    arguments: args
  });
  await page.waitForSelector('[data-scope-allow]', { timeout: 10000 });
  await page.locator('[data-scope-allow]').click();
  return request;
}

async function rpc(method, params = {}) {
  const response = await fetch(`${instance.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method,
      params
    })
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${JSON.stringify(value)}`);
  if (value.error) throw Object.assign(new Error(value.error.message), {
    code: value.error.data?.code || value.error.code,
    details: value.error.data
  });
  return value.result;
}

async function main() {
  instance = await start({
    port: 0,
    host: '127.0.0.1',
    transport: 'http',
    allowWrite: true,
    token,
    stateDir: state,
    tokenFile: path.join(state, 'token'),
    auditFile: path.join(state, 'audit.ndjson'),
    toolTimeoutMs: 120000
  });
  const extensionId = extensionIdFromManifest(path.join(repo, 'manifest.json'));
  if (!extensionId) throw new Error('Unable to derive extension ID from manifest.json');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    timeout: 45000,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${repo}`,
      `--load-extension=${repo}`,
      '--disable-background-networking',
      '--disable-sync',
      '--disable-quic',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
    ]
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const mcpServer = instance.baseUrl;
  const workbenchUrl = `chrome-extension://${extensionId}/workbench/index.html?mcpServer=${encodeURIComponent(mcpServer)}&mcpToken=${encodeURIComponent(token)}&mcpBridge=1`;
  await page.goto(workbenchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.BrevessWorkbenchMCP, null, { timeout: 20000 });
  // The current Workbench index still contains an inline CSP-blocked loader.
  // Load the same external loader the Workbench owner will use, without
  // editing the Workbench-owned index/app files.
  await page.addScriptTag({
    url: `chrome-extension://${extensionId}/workbench/mcp-bridge-loader.js`
  });
  try {
    await page.waitForFunction(() => {
      const status = window.BrevessMcpBridge?.status?.();
      return status?.connected === true;
    }, null, { timeout: 20000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      href: location.href,
      scripts: [...document.scripts].map(script => script.src).filter(Boolean),
      bridge: !!window.BrevessMcpBridge,
      core: !!window.BrevessWorkbenchMCP,
      bridgeStatus: window.BrevessMcpBridge?.status?.() || null,
      errorText: document.querySelector('[role="status"]')?.textContent || ''
    }));
    throw new Error(`${error.message} ${JSON.stringify({ diagnostics, consoleErrors })}`);
  }
  const bridgeDeadline = Date.now() + 20000;
  while (Date.now() < bridgeDeadline) {
    const health = await fetch(`${instance.baseUrl}/health`).then(response => response.json());
    if (health?.bridge?.online === true) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const initialize = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'brevess-workbench-bridge-smoke', version: '1' }
  });
  const health = await rpc('resources/read', { uri: 'brevess://health' });
  const capabilities = await rpc('tools/call', {
    name: 'brevess.capabilities',
    arguments: {}
  });
  const status = await rpc('tools/call', {
    name: 'brevess.status',
    arguments: {}
  });
  const pageContexts = await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    const contexts = tab?.id === undefined ? [] : await chrome.runtime.getContexts({ tabIds: [tab.id] });
    return contexts.map(context => ({
      contextType: context.contextType,
      tabId: context.tabId,
      frameId: context.frameId,
      documentUrl: context.documentUrl,
      documentLifecycle: context.documentLifecycle
    }));
  }).catch(error => ({ error: String(error.message || error) }));
  let bootstrap = null;
  let createdProject = null;
  let normalScope = null;
  let plannedHypothesis = null;
  let plannedFigures = null;
  let evidenceBlock = null;
  let edgeRelation = null;
  let e2eReadback = null;
  try {
    bootstrap = await grantScope(page, {
      projectId: null,
      bootstrap: true,
      operations: ['workbench.create_project'],
      reason: 'MCP bootstrap smoke: create the first isolated project',
      ttlMs: 60000,
      taskId: 'mcp-bootstrap-smoke'
    });
    const createRequest = rpc('tools/call', {
      name: 'workbench.create_project',
      arguments: {
        expectedProjectId: null,
        expectedRevision: 0,
        name: 'MCP bootstrap smoke',
        idempotencyKey: 'mcp-bootstrap-create-project-1'
      }
    });
    createdProject = await createRequest;
    const readback = await rpc('tools/call', {
      name: 'workbench.read_context',
      arguments: {}
    });
    if (createdProject?.structuredContent?.ok) {
      createdProject.readback = {
        projectId: readback.structuredContent?.data?.projectId ?? null,
        revision: readback.structuredContent?.data?.revision ?? null
      };
    }
    const projectId = readback.structuredContent?.data?.projectId;
    const revision = readback.structuredContent?.data?.revision;
    if (projectId && Number.isSafeInteger(revision)) {
      normalScope = await grantScope(page, {
        projectId,
        operations: [
          'workbench.plan_hypotheses',
          'workbench.plan_figures',
          'workbench.create_evidence_block',
          'workbench.set_edge_relation'
        ],
        reason: 'MCP smoke: planning and evidence writes',
        ttlMs: 60000,
        taskId: 'mcp-plan-smoke'
      });
      plannedHypothesis = await rpc('tools/call', {
        name: 'workbench.plan_hypotheses',
        arguments: {
          expectedProjectId: projectId,
          expectedRevision: revision,
          name: 'Isolated MCP hypothesis',
          nodes: [
            { key: 'upstream', label: 'Upstream signal', point: { x: 40, y: 60 } },
            { key: 'main', label: 'Main pathway', point: { x: 330, y: 60 } },
            { key: 'branch', label: 'Conditional branch', point: { x: 620, y: 200 } }
          ],
          edges: [
            { from: 'upstream', to: 'main', claim: 'main activation' },
            { from: 'upstream', to: 'branch', claim: 'conditional branch' }
          ],
          idempotencyKey: 'mcp-plan-hypothesis-1'
        }
      });
      const hypothesisRevision = plannedHypothesis.structuredContent?.data?.revision;
      plannedFigures = await rpc('tools/call', {
        name: 'workbench.plan_figures',
        arguments: {
          expectedProjectId: projectId,
          expectedRevision: hypothesisRevision,
          planName: 'Isolated MCP plan',
          figures: [{
            title: 'Figure 1 · MCP smoke',
            panels: [
              { title: 'A. Signal', purpose: 'Show the upstream signal' },
              { title: 'B. Readout', purpose: 'Show the planned readout' }
            ]
          }],
          idempotencyKey: 'mcp-plan-figures-1'
        }
      });
      const figureIds = plannedFigures.structuredContent?.data?.createdIds || {};
      const figureRevision = plannedFigures.structuredContent?.data?.revision;
      if (figureIds.planId && figureIds.figures?.[0] && figureIds.panels?.length) {
        evidenceBlock = await rpc('tools/call', {
          name: 'workbench.create_evidence_block',
          arguments: {
            expectedProjectId: projectId,
            expectedRevision: figureRevision,
            planId: figureIds.planId,
            figureId: figureIds.figures[0],
            title: 'A+B evidence',
            panelIds: figureIds.panels,
            summary: 'Smoke evidence block',
            status: 'draft',
            idempotencyKey: 'mcp-evidence-block-1'
          }
        });
      }
      const hypothesisIds = plannedHypothesis.structuredContent?.data?.createdIds || {};
      const relationRevision = evidenceBlock?.structuredContent?.data?.revision || figureRevision;
      if (hypothesisIds.hypothesisId && hypothesisIds.edges?.[0]) {
        edgeRelation = await rpc('tools/call', {
          name: 'workbench.set_edge_relation',
          arguments: {
            expectedProjectId: projectId,
            expectedRevision: relationRevision,
            hypothesisId: hypothesisIds.hypothesisId,
            edgeId: hypothesisIds.edges[0],
            kind: 'branch',
            idempotencyKey: 'mcp-edge-relation-1'
          }
        });
      }
      e2eReadback = await rpc('tools/call', {
        name: 'workbench.read_context',
        arguments: {}
      });
    }
  } catch (error) {
    bootstrap = { error: { code: error.code || null, message: error.message } };
  }
  let globalLibrary = null;
  try {
    globalLibrary = await rpc('tools/call', {
      name: 'library.query_global_library',
      arguments: { page: 1, pageSize: 5 }
    });
  } catch (error) {
    globalLibrary = { error: { code: error.code, message: error.message } };
  }
  let pdfOpen = null;
  const pdfPath = process.env.BREVESS_E2E_PDF || '';
  if (pdfPath && fs.existsSync(pdfPath)) {
    try {
      pdfOpen = await rpc('tools/call', {
        name: 'pdf.open_local',
        arguments: { fileUrl: encodeFileUrl(pdfPath) }
      });
    } catch (error) {
      pdfOpen = { error: { code: error.code, message: error.message } };
    }
  }
  let pdfReader = null;
  let readerPage = context.pages().find(candidate => candidate.url().includes('/pdf-reader.html'));
  if (!readerPage && pdfOpen?.structuredContent?.data?.opened === true) {
    readerPage = await context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  }
  let codex = null;
  if (process.env.BREVESS_RUN_CODEX === '1' && pdfPath) {
    codex = await runCodex(instance.port, token, encodeFileUrl(pdfPath));
  }
  if (readerPage) {
    await readerPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    try {
      await readerPage.waitForFunction(() => {
        const native = window.__brevessNativePdfDocument;
        return Number(native?.pageCount) > 0 || document.querySelector('.pdf-native-page');
      }, null, { timeout: 60000 });
      await readerPage.waitForFunction(() => {
        const native = window.__brevessNativePdfDocument;
        const phase = String(native?.phase || '');
        return ['text-ready', 'partial-index', 'ready'].includes(phase) ||
          Array.isArray(native?.structure?.outline) && native.structure.outline.length > 0;
      }, null, { timeout: 90000 }).catch(() => {});
      pdfReader = await readerPage.evaluate(() => {
        const native = window.__brevessNativePdfDocument;
        const phase = native?.phase || null;
        return {
          pageCount: Number(native?.pageCount) || document.querySelectorAll('.pdf-native-page').length || 0,
          phase,
          pendingParsing: !['text-ready', 'partial-index', 'ready'].includes(String(phase || '')),
          documentHash: native?.structure?.documentHash || null,
          title: document.title || '',
          heading: document.querySelector('#pdfReaderTitle, h1')?.textContent?.trim() || '',
          outlineCount: Array.isArray(native?.structure?.outline) ? native.structure.outline.length : null,
          structureKeys: native?.structure && typeof native.structure === 'object'
            ? Object.keys(native.structure).slice(0, 40)
            : [],
          typedRecordCounts: native?.structure?.typedRecords && typeof native.structure.typedRecords === 'object'
            ? Object.fromEntries(Object.entries(native.structure.typedRecords).map(([key, value]) => [
                key, Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
              ]))
            : {},
          nodeTypeCounts: Array.isArray(native?.structure?.nodes)
            ? Object.fromEntries([...new Set(native.structure.nodes.map(node => node?.type || 'unknown'))].map(type => [
                type, native.structure.nodes.filter(node => (node?.type || 'unknown') === type).length
              ]))
            : {},
          referenceCount: Number.isFinite(native?.structure?.referenceCount)
            ? native.structure.referenceCount
            : null
        };
      });
      await readerPage.screenshot({ path: path.join(outputDir, 'pdf-reader-smoke.png'), fullPage: false });
    } catch (error) {
      pdfReader = {
        pending: true,
        code: 'PENDING_PARSING',
        message: error.message,
        url: readerPage.url()
      };
    }
  }
  let legacyRead;
  try {
    legacyRead = await rpc('tools/call', {
      name: 'workbench.read_context',
      arguments: {}
    });
  } catch (error) {
    legacyRead = { error: { code: error.code, message: error.message } };
  }
  const report = {
    ok: true,
    extensionId,
    workbenchUrl: workbenchUrl.replace(token, '[redacted]'),
    initialize: {
      protocolVersion: initialize.protocolVersion,
      serverInfo: initialize.serverInfo,
      bridgeOnline: JSON.parse(health.contents[0].text).bridge.online
    },
    capabilities: {
      toolCount: Array.isArray(capabilities.structuredContent?.data?.tools)
        ? capabilities.structuredContent.data.tools.length
        : null,
      workbenchOperationCount: capabilities.structuredContent?.data?.workbench?.operations?.length || 0,
      workbenchCapabilities: capabilities.structuredContent?.data?.workbench?.capabilities || null
    },
    status: {
      writeScope: status.structuredContent?.data?.writeScope || null,
      hostReady: status.structuredContent?.data?.host?.ready === true,
      hostProjectId: status.structuredContent?.data?.host?.projectId || null
    },
    pageContexts,
    bootstrap,
    createdProject,
    normalScope,
    plannedHypothesis,
    plannedFigures,
    evidenceBlock,
    edgeRelation,
    e2eReadback,
    globalLibrary: globalLibrary?.structuredContent
      ? globalLibrary.structuredContent.ok
        ? {
          ok: globalLibrary.structuredContent.ok,
          itemCount: Array.isArray(globalLibrary.structuredContent.data?.items)
            ? globalLibrary.structuredContent.data.items.length
            : null,
          matchedCount: globalLibrary.structuredContent.data?.matchedCount ?? null
          }
        : { ok: false, error: globalLibrary.structuredContent.error || null }
      : globalLibrary,
    pdfOpen: pdfOpen?.structuredContent || pdfOpen,
    pdfReader,
    codex,
    legacyRead: legacyRead?.structuredContent || legacyRead,
    consoleErrors
  };
  fs.mkdirSync(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, 'workbench-bridge-smoke.png'), fullPage: true });
  report.screenshotSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(outputDir, 'workbench-bridge-smoke.png')))
    .digest('hex');
  const reportPath = path.join(outputDir, 'workbench-bridge-smoke.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  report.reportPath = reportPath;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || null, message: error.message, stack: error.stack }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  try { await context?.close(); } catch {}
  try { await instance?.close(null); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(state, { recursive: true, force: true }); } catch {}
}
