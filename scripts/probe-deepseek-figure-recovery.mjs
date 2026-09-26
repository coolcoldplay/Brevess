import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types as utilTypes } from 'node:util';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { ProviderRequestError } = require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const {
  compileFigureAnalysisPrompt,
  validateFigureAnalysis,
  compileFigurePanelRecoveryPrompt,
  validateFigurePanelRecoveryResult
} = require('../core/figure-analysis.js');
const {
  createPanelRecoveryBatches,
  mergeRecoveredPanels
} = require('../core/figure-panel-recovery.js');
require('../providers/deepseek.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const PANEL_PATTERN = /^[A-F]$/;
const PANEL_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
const VISUAL_CODE_PATTERN = /^[2-9]{3}$/;
const VISUAL_CODE_ALPHABET = '23456789';
const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const REPORT_KEYS = Object.freeze([
  'schemaVersion', 'status', 'inputMode', 'model', 'finishReason',
  'visualVerified', 'panelCounts', 'requestCount', 'tokenTotals', 'elapsedMs'
]);
const TOKEN_TOTAL_KEYS = Object.freeze(['input', 'output', 'reasoning']);
const PANEL_COUNT_KEYS = Object.freeze([
  'requested', 'received', 'recovered', 'unresolved', 'unique', 'matched'
]);
const SAFE_ERROR_CODES = new Set([
  'AUTH_INVALID', 'CANCELLED', 'INVALID_RESPONSE', 'NETWORK_ERROR',
  'OUTPUT_TRUNCATED', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE',
  'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'REQUEST_TIMEOUT',
  'TOKEN_LIMIT_REJECTED', 'PROBE_ADAPTER_REQUIRED', 'PROBE_FAILED',
  'PROBE_IMAGE_TOO_LARGE',
  'PROBE_INTERRUPTED', 'PROBE_KEY_INVALID', 'PROBE_KEY_TOO_LONG',
  'PROBE_OUTPUT_LIMIT_EXCEEDED', 'PROBE_REQUEST_LIMIT_EXCEEDED',
  'PROBE_REQUEST_TOO_LARGE', 'PROBE_RESPONSE_TOO_LARGE',
  'PROBE_TIME_LIMIT_EXCEEDED', 'PROBE_TOKEN_LIMIT_EXCEEDED',
  'PROBE_TOKEN_USAGE_MISSING', 'PROBE_VISUAL_ASSERTION_FAILED',
  'PROBE_TTY_CLOSED', 'PROBE_TTY_IO_ERROR', 'TTY_REQUIRED',
  'UNSAFE_DIAGNOSTIC_REPORT', 'UNSAFE_REPORT_PATH'
]);
const FORBIDDEN_KEYS = new Set([
  'apikey', 'apiheaders', 'authorization', 'headers', 'prompt', 'systemprompt',
  'userprompt', 'articletext', 'articlebody', 'image', 'images', 'imagebytes',
  'dataurl', 'request', 'requestbody', 'response', 'rawresponse', 'fullresponse',
  'modelresponse', 'providerpayload', 'oracle', 'pixels', 'pixeldata', 'visualcode'
]);

export const PROBE_LIMITS = Object.freeze({
  maxImageDataUrlBytes: 16384,
  maxRequestBytes: 131072,
  maxResponseBytes: 262144,
  maxRequests: 3,
  requestTimeoutMs: 60000,
  maxTotalElapsedMs: 180000,
  maxOutputTokens: 4096,
  maxTotalTokens: 30000,
  maxSecretChars: 256
});

export const FIXED_REPORT_RELATIVE_PATH =
  'tmp/deepseek-figure-recovery/report.json';


export const SYNTHETIC_FIGURE = Object.freeze({
  figureId: 'probe-figure',
  figureLabel: 'Synthetic Figure',
  articleTitle: 'Synthetic multimodal recovery probe',
  caption: 'Synthetic Figure with six Panels A through F. Read each three-character verification code directly from its Panel image.',
  contextParagraphs: Object.freeze([Object.freeze({
    paragraphId: 'probe-p1',
    sectionTitle: 'Synthetic results',
    text: 'The image contains six labeled Panels and no scientific claim or textual code value.'
  })]),
  panelHints: PANEL_LABELS
});

const VISUAL_GLYPHS = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  2: ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110']
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function renderGlyph(pixels, width, x, y, glyph, scale) {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let column = 0; column < glyph[row].length; column += 1) {
      if (glyph[row][column] !== '1') continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          pixels[(y + row * scale + dy) * width + x + column * scale + dx] = 0;
        }
      }
    }
  }
}

function renderVisualOraclePng(oracle) {
  const width = 360;
  const height = 180;
  const cellWidth = 120;
  const cellHeight = 90;
  const pixels = Buffer.alloc(width * height, 255);
  const darken = (x, y) => { pixels[y * width + x] = 0; };
  for (const [index, panel] of PANEL_LABELS.entries()) {
    const cellX = (index % 3) * cellWidth;
    const cellY = Math.floor(index / 3) * cellHeight;
    for (let x = cellX; x < cellX + cellWidth; x += 1) {
      darken(x, cellY);
      darken(x, cellY + 1);
      darken(x, cellY + cellHeight - 2);
      darken(x, cellY + cellHeight - 1);
    }
    for (let y = cellY; y < cellY + cellHeight; y += 1) {
      darken(cellX, y);
      darken(cellX + 1, y);
      darken(cellX + cellWidth - 2, y);
      darken(cellX + cellWidth - 1, y);
    }
    renderGlyph(pixels, width, cellX + 8, cellY + 8, VISUAL_GLYPHS[panel], 3);
    for (const [characterIndex, character] of [...oracle[panel]].entries()) {
      renderGlyph(
        pixels,
        width,
        cellX + 15 + characterIndex * 35,
        cellY + 42,
        VISUAL_GLYPHS[character],
        5
      );
    }
  }
  const scanlines = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (width + 1)] = 0;
    pixels.copy(scanlines, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const encoded = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND')
  ]).toString('base64');
  return Object.freeze({
    mediaType: 'image/png',
    dataUrl: `data:image/png;base64,${encoded}`
  });
}

function randomVisualCode(randomSource) {
  let result = '';
  while (result.length < 3) {
    const bytes = randomSource(1);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 1) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    const value = bytes[0];
    if (value >= 248) continue;
    result += VISUAL_CODE_ALPHABET[value % VISUAL_CODE_ALPHABET.length];
  }
  return result;
}

function createVisualFixtureFromOracle(oracle) {
  if (!oracle || Object.keys(oracle).join('') !== PANEL_LABELS.join('') ||
      PANEL_LABELS.some(panel => !VISUAL_CODE_PATTERN.test(oracle[panel])) ||
      new Set(PANEL_LABELS.map(panel => oracle[panel])).size !== PANEL_LABELS.length) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  const canonicalOracle = Object.freeze(Object.fromEntries(
    PANEL_LABELS.map(panel => [panel, oracle[panel]])
  ));
  return Object.freeze({
    image: renderVisualOraclePng(canonicalOracle),
    oracle: canonicalOracle
  });
}

function createRuntimeVisualFixture() {
  const oracle = {};
  const seen = new Set();
  for (const panel of PANEL_LABELS) {
    let code;
    do { code = randomVisualCode(randomBytes); } while (seen.has(code));
    seen.add(code);
    oracle[panel] = code;
  }
  return createVisualFixtureFromOracle(oracle);
}

export function __testOnlyCreateVisualFixture() {
  return createRuntimeVisualFixture();
}

export function __testOnlyCreateMetamorphicVisualPair() {
  const first = createRuntimeVisualFixture();
  const shifted = Object.fromEntries(PANEL_LABELS.map((panel, index) => [
    panel,
    first.oracle[PANEL_LABELS[(index + 1) % PANEL_LABELS.length]]
  ]));
  return Object.freeze({ first, second: createVisualFixtureFromOracle(shifted) });
}

function probeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
}

function boundedInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(numeric));
}

function unsafeDiagnosticReport() {
  throw probeError('UNSAFE_DIAGNOSTIC_REPORT');
}

function readOwnShape(value) {
  if (!value || typeof value !== 'object') unsafeDiagnosticReport();
  try {
    if (utilTypes.isProxy(value)) unsafeDiagnosticReport();
    return {
      isArray: Array.isArray(value),
      prototype: Object.getPrototypeOf(value),
      descriptors: Object.getOwnPropertyDescriptors(value)
    };
  } catch (_) {
    unsafeDiagnosticReport();
  }
}

function readStrictRecord(value, expectedKeys) {
  const { isArray, prototype, descriptors } = readOwnShape(value);
  if (isArray) unsafeDiagnosticReport();
  let keys;
  try { keys = Reflect.ownKeys(descriptors); } catch (_) { unsafeDiagnosticReport(); }
  if (prototype !== Object.prototype || keys.length !== expectedKeys.length ||
      keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) {
    unsafeDiagnosticReport();
  }
  const values = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')) unsafeDiagnosticReport();
    values[key] = descriptor.value;
  }
  return values;
}

function ownEntries(value) {
  if (!value || typeof value !== 'object') return [];
  const { isArray, prototype, descriptors } = readOwnShape(value);
  if (prototype !== null && prototype !== Object.prototype &&
      prototype !== Array.prototype) {
    unsafeDiagnosticReport();
  }
  let keys;
  try { keys = Reflect.ownKeys(descriptors); } catch (_) { unsafeDiagnosticReport(); }
  if (keys.some(key => typeof key !== 'string')) unsafeDiagnosticReport();
  return keys.filter(key => !(isArray && key === 'length')).map(key => {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')) unsafeDiagnosticReport();
    return [key, descriptor.value];
  });
}

export function assertNoForbiddenDiagnosticData(value) {
  const seen = new Set();
  const visit = current => {
    if (typeof current === 'string') {
      if (/\bBearer\s+\S+/i.test(current) || /data:image\//i.test(current) ||
          /\bsk-[a-z0-9]{16,}\b/i.test(current)) {
        throw probeError('UNSAFE_DIAGNOSTIC_REPORT');
      }
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) throw probeError('UNSAFE_DIAGNOSTIC_REPORT');
    seen.add(current);
    for (const [key, item] of ownEntries(current)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (FORBIDDEN_KEYS.has(normalizedKey)) {
        throw probeError('UNSAFE_DIAGNOSTIC_REPORT');
      }
      visit(item);
    }
    seen.delete(current);
  };
  visit(value);
  return value;
}

export function assertProbeBudget(budget = {}) {
  if (boundedInteger(budget.requestCount) > PROBE_LIMITS.maxRequests) {
    throw probeError('PROBE_REQUEST_LIMIT_EXCEEDED');
  }
  if (boundedInteger(budget.elapsedMs) > PROBE_LIMITS.maxTotalElapsedMs) {
    throw probeError('PROBE_TIME_LIMIT_EXCEEDED');
  }
  if (boundedInteger(budget.tokenTotal) > PROBE_LIMITS.maxTotalTokens) {
    throw probeError('PROBE_TOKEN_LIMIT_EXCEEDED');
  }
  return budget;
}

export function assertSafeDiagnosticReport(report) {
  const values = readStrictRecord(report, REPORT_KEYS);
  if (values.schemaVersion !== 2 || values.status !== 'PASS' ||
      values.inputMode !== 'figure_image' || values.model !== DEEPSEEK_VISION_MODEL ||
      values.finishReason !== 'stop' || values.visualVerified !== true) {
    unsafeDiagnosticReport();
  }
  const panelCounts = readStrictRecord(values.panelCounts, PANEL_COUNT_KEYS);
  if (PANEL_COUNT_KEYS.some(key => !Number.isSafeInteger(panelCounts[key]) ||
      panelCounts[key] < 0 || panelCounts[key] > PANEL_LABELS.length) ||
      panelCounts.requested !== PANEL_LABELS.length ||
      panelCounts.received + panelCounts.recovered + panelCounts.unresolved !==
        panelCounts.requested ||
      panelCounts.unresolved !== 0 || panelCounts.unique !== PANEL_LABELS.length ||
      panelCounts.matched !== PANEL_LABELS.length) {
    unsafeDiagnosticReport();
  }
  if (!Number.isSafeInteger(values.requestCount) || values.requestCount < 1 ||
      values.requestCount > PROBE_LIMITS.maxRequests ||
      !Number.isSafeInteger(values.elapsedMs) || values.elapsedMs < 0 ||
      values.elapsedMs > PROBE_LIMITS.maxTotalElapsedMs) {
    unsafeDiagnosticReport();
  }
  const tokenValues = readStrictRecord(values.tokenTotals, TOKEN_TOTAL_KEYS);
  if (TOKEN_TOTAL_KEYS.some(key => !Number.isSafeInteger(tokenValues[key]) ||
      tokenValues[key] < 0)) {
    unsafeDiagnosticReport();
  }
  if (tokenValues.reasoning > tokenValues.output) unsafeDiagnosticReport();
  const tokenTotal = tokenValues.input + tokenValues.output;
  assertProbeBudget({
    requestCount: values.requestCount,
    elapsedMs: values.elapsedMs,
    tokenTotal
  });
  const canonical = {
    schemaVersion: values.schemaVersion,
    status: values.status,
    inputMode: values.inputMode,
    model: values.model,
    finishReason: values.finishReason,
    visualVerified: values.visualVerified,
    panelCounts: Object.fromEntries(PANEL_COUNT_KEYS.map(key => [key, panelCounts[key]])),
    requestCount: values.requestCount,
    tokenTotals: {
      input: tokenValues.input,
      output: tokenValues.output,
      reasoning: tokenValues.reasoning
    },
    elapsedMs: values.elapsedMs
  };
  return canonical;
}

function createSafeReportSerializationGraph(canonicalReport) {
  const panelCounts = Object.create(null);
  for (const key of PANEL_COUNT_KEYS) panelCounts[key] = canonicalReport.panelCounts[key];
  const tokenTotals = Object.create(null);
  tokenTotals.input = canonicalReport.tokenTotals.input;
  tokenTotals.output = canonicalReport.tokenTotals.output;
  tokenTotals.reasoning = canonicalReport.tokenTotals.reasoning;
  const graph = Object.create(null);
  graph.schemaVersion = canonicalReport.schemaVersion;
  graph.status = canonicalReport.status;
  graph.inputMode = canonicalReport.inputMode;
  graph.model = canonicalReport.model;
  graph.finishReason = canonicalReport.finishReason;
  graph.visualVerified = canonicalReport.visualVerified;
  graph.panelCounts = panelCounts;
  graph.requestCount = canonicalReport.requestCount;
  graph.tokenTotals = tokenTotals;
  graph.elapsedMs = canonicalReport.elapsedMs;
  assertNoForbiddenDiagnosticData(graph);
  return graph;
}

function safePanelList(value) {
  const panels = Array.isArray(value) ? value.filter(panel =>
    typeof panel === 'string' && PANEL_PATTERN.test(panel)) : [];
  return [...new Set(panels)].slice(0, 6);
}

function addVisualCodeToPanelSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  if (Array.isArray(schema.oneOf)) {
    for (const option of schema.oneOf) addVisualCodeToPanelSchema(option);
    return;
  }
  if (schema.type !== 'object' || !schema.properties ||
      !Array.isArray(schema.required)) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  schema.properties.visual_code = {
    type: 'string',
    pattern: '^[2-9]{3}$'
  };
  if (!schema.required.includes('visual_code')) schema.required.push('visual_code');
}

function withVisualAssertion(prompt) {
  let responseSchema;
  try { responseSchema = structuredClone(prompt.responseSchema); } catch (_) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  const panelItems = responseSchema?.properties?.panels?.items;
  addVisualCodeToPanelSchema(panelItems);
  return {
    systemPrompt: [
      prompt.systemPrompt,
      'VISUAL_VERIFICATION: Every returned Panel record must include visual_code.',
      'Read visual_code only from the three large glyphs printed inside that Panel image.',
      'Return exactly three characters from 2 through 9. Never infer a value from Panel labels or surrounding text.'
    ].join('\n'),
    userPrompt: prompt.userPrompt,
    schemaName: `${prompt.schemaName}_visual_verification_v2`,
    responseSchema,
    validationContext: prompt.validationContext
  };
}

function assertOracleAbsentFromTextRequest(prompt, oracle) {
  let text;
  try {
    text = JSON.stringify({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schemaName: prompt.schemaName,
      responseSchema: prompt.responseSchema
    });
  } catch (_) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  if (PANEL_LABELS.some(panel => text.includes(oracle[panel]))) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
}

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  if (!descriptor || descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')) return undefined;
  return descriptor.value;
}

function stripAndVerifyVisualCodes(raw, oracle, matchedPanels) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.getPrototypeOf(raw) !== Object.prototype) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  const rawPanels = ownDataValue(raw, 'panels');
  if (!Array.isArray(rawPanels) || rawPanels.length < 1 ||
      rawPanels.length > PANEL_LABELS.length) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  const strippedPanels = rawPanels.map(rawPanel => {
    if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel) ||
        Object.getPrototypeOf(rawPanel) !== Object.prototype) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    const panel = ownDataValue(rawPanel, 'panel');
    const code = ownDataValue(rawPanel, 'visual_code');
    if (!PANEL_PATTERN.test(panel) || !VISUAL_CODE_PATTERN.test(code) ||
        code !== oracle[panel] || matchedPanels.has(panel)) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    const stripped = {};
    let keys;
    try { keys = Reflect.ownKeys(rawPanel); } catch (_) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    if (keys.some(key => typeof key !== 'string')) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(rawPanel, key);
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) {
        throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
      }
      if (key !== 'visual_code') stripped[key] = descriptor.value;
    }
    matchedPanels.add(panel);
    return stripped;
  });
  const strippedRoot = {};
  let rootKeys;
  try { rootKeys = Reflect.ownKeys(raw); } catch (_) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  if (rootKeys.some(key => typeof key !== 'string')) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  for (const key of rootKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')) {
      throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    }
    strippedRoot[key] = key === 'panels' ? strippedPanels : descriptor.value;
  }
  return strippedRoot;
}

function requestPayload(prompt, image, timeoutMs = PROBE_LIMITS.requestTimeoutMs) {
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schemaName: prompt.schemaName,
    responseSchema: prompt.responseSchema,
    images: [image],
    reasoningEnabled: false,
    reasoningEffort: 'auto',
    maxOutputTokens: PROBE_LIMITS.maxOutputTokens,
    timeoutMs
  };
}

function createProbeDeadline(now) {
  let lastReading = null;
  const read = () => {
    let reading;
    try { reading = Number(now()); } catch (_) {
      throw probeError('PROBE_TIME_LIMIT_EXCEEDED');
    }
    if (!Number.isFinite(reading) || reading < 0) {
      throw probeError('PROBE_TIME_LIMIT_EXCEEDED');
    }
    lastReading = lastReading === null ? reading : Math.max(lastReading, reading);
    return lastReading;
  };
  const startedAt = read();
  const elapsedMs = () => Math.max(0, Math.ceil(read() - startedAt));
  const remainingMs = () => {
    const remaining = PROBE_LIMITS.maxTotalElapsedMs - elapsedMs();
    if (remaining <= 0) throw probeError('PROBE_TIME_LIMIT_EXCEEDED');
    return remaining;
  };
  return { elapsedMs, remainingMs };
}

export function assertBoundedProviderRequest(request) {
  const images = Array.isArray(request?.images) ? request.images : [];
  if (images.length !== 1 || images.some(image =>
    image?.mediaType !== 'image/png' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(image?.dataUrl || '')) ||
    byteLength(image.dataUrl) > PROBE_LIMITS.maxImageDataUrlBytes
  )) {
    throw probeError('PROBE_IMAGE_TOO_LARGE');
  }
  if (!Number.isSafeInteger(request?.maxOutputTokens) || request.maxOutputTokens < 1 ||
      request.maxOutputTokens > PROBE_LIMITS.maxOutputTokens) {
    throw probeError('PROBE_OUTPUT_LIMIT_EXCEEDED');
  }
  if (!Number.isSafeInteger(request?.timeoutMs) || request.timeoutMs < 1 ||
      request.timeoutMs > PROBE_LIMITS.requestTimeoutMs) {
    throw probeError('PROBE_TIME_LIMIT_EXCEEDED');
  }
  if (byteLength({
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    schemaName: request.schemaName,
    responseSchema: request.responseSchema,
    images,
    reasoningEnabled: request.reasoningEnabled,
    reasoningEffort: request.reasoningEffort,
    maxOutputTokens: request.maxOutputTokens
  }) > PROBE_LIMITS.maxRequestBytes) {
    throw probeError('PROBE_REQUEST_TOO_LARGE');
  }
  return request;
}

async function runFigureRecoveryProbe(options, visualFixture) {
  const adapter = options.adapter;
  const now = typeof options.now === 'function'
    ? options.now
    : () => Number(process.hrtime.bigint() / 1000000n);
  if (!adapter || typeof adapter.analyzeChunk !== 'function') {
    throw probeError('PROBE_ADAPTER_REQUIRED');
  }
  if (byteLength(visualFixture.image.dataUrl) > PROBE_LIMITS.maxImageDataUrlBytes) {
    throw probeError('PROBE_IMAGE_TOO_LARGE');
  }

  const deadline = createProbeDeadline(now);
  const usage = { input: 0, output: 0, reasoning: 0 };
  const matchedPanels = new Set();
  let requestCount = 0;
  let tokenBudgetExceeded = false;

  const usageTokenTotal = () => Math.min(
    Number.MAX_SAFE_INTEGER,
    usage.input + usage.output
  );
  const assertAccumulatedTokenBudget = () => {
    if (tokenBudgetExceeded) throw probeError('PROBE_TOKEN_LIMIT_EXCEEDED');
    assertProbeBudget({ tokenTotal: usageTokenTotal() });
  };
  const safeTelemetryInteger = (event, key) => {
    if (!event || (typeof event !== 'object' && typeof event !== 'function')) {
      return { valid: false, value: 0 };
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(event, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
          !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) {
        return { valid: false, value: 0 };
      }
      return { valid: true, value: boundedInteger(descriptor.value) };
    } catch (_) {
      return { valid: false, value: 0 };
    }
  };
  const addUsage = (key, value) => {
    usage[key] = Math.min(Number.MAX_SAFE_INTEGER, usage[key] + value);
  };

  const send = async prompt => {
    const visualPrompt = withVisualAssertion(prompt);
    assertOracleAbsentFromTextRequest(visualPrompt, visualFixture.oracle);
    const totalRemainingMs = deadline.remainingMs();
    assertAccumulatedTokenBudget();
    assertProbeBudget({ requestCount: requestCount + 1 });
    const requestTimeoutMs = Math.max(1, Math.floor(Math.min(
      PROBE_LIMITS.requestTimeoutMs,
      totalRemainingMs
    )));
    const request = assertBoundedProviderRequest(requestPayload(
      visualPrompt,
      visualFixture.image,
      requestTimeoutMs
    ));
    const controller = new AbortController();
    request.signal = controller.signal;
    let telemetryReported = false;
    let routeVerified = true;
    let usageVerified = true;
    let acceptTelemetry = true;
    request.onProviderTelemetry = event => {
      if (!acceptTelemetry) return;
      const input = safeTelemetryInteger(event, 'inputTokens');
      const output = safeTelemetryInteger(event, 'outputTokens');
      const reasoning = safeTelemetryInteger(event, 'reasoningTokens');
      telemetryReported ||= input.valid && output.valid;
      routeVerified &&= ownDataValue(event, 'providerId') === 'deepseek' &&
        ownDataValue(event, 'model') === DEEPSEEK_VISION_MODEL &&
        ownDataValue(event, 'finishReason') === 'stop';
      usageVerified &&= input.valid && output.valid && reasoning.valid &&
        reasoning.value <= output.value;
      addUsage('input', input.value);
      addUsage('output', output.value);
      addUsage('reasoning', reasoning.value);
      if (usageTokenTotal() > PROBE_LIMITS.maxTotalTokens) {
        tokenBudgetExceeded = true;
      }
    };
    requestCount += 1;
    const timeoutCode = totalRemainingMs <= PROBE_LIMITS.requestTimeoutMs
      ? 'PROBE_TIME_LIMIT_EXCEEDED'
      : 'REQUEST_TIMEOUT';
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(probeError(timeoutCode));
        try { controller.abort(); } catch (_) {}
      }, requestTimeoutMs);
    });
    let raw;
    try {
      raw = await Promise.race([
        Promise.resolve().then(() => adapter.analyzeChunk(request)),
        timeout
      ]);
    } finally {
      acceptTelemetry = false;
      if (timer !== null) clearTimeout(timer);
    }
    deadline.remainingMs();
    if (!telemetryReported) throw probeError('PROBE_TOKEN_USAGE_MISSING');
    if (!usageVerified || usage.reasoning > usage.output) {
      throw probeError('PROBE_TOKEN_USAGE_MISSING');
    }
    if (!routeVerified) throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
    assertAccumulatedTokenBudget();
    if (byteLength(raw) > PROBE_LIMITS.maxResponseBytes) {
      throw probeError('PROBE_RESPONSE_TOO_LARGE');
    }
    return stripAndVerifyVisualCodes(raw, visualFixture.oracle, matchedPanels);
  };

  const expectedPanels = [...SYNTHETIC_FIGURE.panelHints];
  const initialPrompt = compileFigureAnalysisPrompt(SYNTHETIC_FIGURE, {
    visualInput: true,
    analysisDepth: 'standard'
  });
  const initialRaw = await send(initialPrompt);
  let current;
  try {
    current = validateFigureAnalysis(initialRaw, SYNTHETIC_FIGURE, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: true
    });
  } catch (error) {
    if (error?.code !== 'FIGURE_PANEL_COVERAGE_INCOMPLETE') throw error;
    current = validateFigureAnalysis(initialRaw, SYNTHETIC_FIGURE, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: false
    });
  }

  const receivedPanels = safePanelList(current.panelCoverage?.returnedPanels);
  const missingPanels = expectedPanels.filter(panel => !receivedPanels.includes(panel));
  const recoveredPanels = [];
  const recoveryBatchSize = Number.isSafeInteger(options.recoveryBatchSize) &&
    options.recoveryBatchSize >= 1 && options.recoveryBatchSize <= 3
    ? options.recoveryBatchSize : 3;
  for (const batch of createPanelRecoveryBatches(missingPanels, recoveryBatchSize)) {
    const completedPanelLabels = safePanelList(current.panels?.map(panel => panel?.panel));
    const recoveryPrompt = compileFigurePanelRecoveryPrompt(
      { ...SYNTHETIC_FIGURE, completedPanelLabels },
      batch,
      {
        visualInput: true,
        inputMode: 'figure_image',
        analysisDepth: 'standard',
        completedPanelLabels
      }
    );
    const recoveryRaw = await send(recoveryPrompt);
    const recovery = validateFigurePanelRecoveryResult(
      recoveryRaw,
      batch,
      recoveryPrompt.validationContext
    );
    for (const panel of safePanelList(recovery.resolvedPanels)) {
      if (!recoveredPanels.includes(panel)) recoveredPanels.push(panel);
    }
    current = mergeRecoveredPanels(current, recovery, expectedPanels);
  }

  const unresolvedPanels = expectedPanels.filter(panel =>
    !receivedPanels.includes(panel) && !recoveredPanels.includes(panel));
  const resolvedPanels = [...receivedPanels, ...recoveredPanels];
  if (unresolvedPanels.length !== 0 || resolvedPanels.length !== PANEL_LABELS.length ||
      new Set(resolvedPanels).size !== PANEL_LABELS.length ||
      matchedPanels.size !== PANEL_LABELS.length) {
    throw probeError('PROBE_VISUAL_ASSERTION_FAILED');
  }
  const elapsedMs = deadline.elapsedMs();
  const totalTokens = usageTokenTotal();
  assertProbeBudget({ requestCount, elapsedMs, tokenTotal: totalTokens });
  const report = {
    schemaVersion: 2,
    status: 'PASS',
    inputMode: 'figure_image',
    model: DEEPSEEK_VISION_MODEL,
    finishReason: 'stop',
    visualVerified: true,
    panelCounts: {
      requested: expectedPanels.length,
      received: receivedPanels.length,
      recovered: recoveredPanels.length,
      unresolved: unresolvedPanels.length,
      unique: new Set(resolvedPanels).size,
      matched: matchedPanels.size
    },
    requestCount,
    tokenTotals: {
      input: usage.input,
      output: usage.output,
      reasoning: usage.reasoning
    },
    elapsedMs
  };
  return assertSafeDiagnosticReport(report);
}

export async function runOfflineFigureRecoveryProbe(options = {}) {
  return runFigureRecoveryProbe(options, createRuntimeVisualFixture());
}

export async function __testOnlyRunWithVisualFixture(options = {}, fixture) {
  const canonicalFixture = createVisualFixtureFromOracle(fixture?.oracle);
  return runFigureRecoveryProbe(options, canonicalFixture);
}

function providerProbeError(code) {
  return new ProviderRequestError(code, code, {
    retryable: false,
    diagnosticStage: 'probe-budget'
  });
}

function ownSafeUsageValue(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { present: false, valid: false, value: 0 };
  }
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) {
      return { present: true, valid: false, value: 0 };
    }
    if (!descriptor) continue;
    const valid = Object.hasOwn(descriptor, 'value') &&
      Number.isSafeInteger(descriptor.value) && descriptor.value >= 0;
    return { present: true, valid, value: valid ? descriptor.value : 0 };
  }
  return { present: false, valid: false, value: 0 };
}

function assertDeepSeekUsageReported(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch (_) {
    if (/^\s*(?:data:|: keep-alive)/mu.test(text)) {
      throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
    }
    return;
  }
  let usageDescriptor;
  try { usageDescriptor = Object.getOwnPropertyDescriptor(envelope, 'usage'); } catch (_) {
    throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
  }
  const usage = usageDescriptor && Object.hasOwn(usageDescriptor, 'value')
    ? usageDescriptor.value : null;
  const input = ownSafeUsageValue(
    usage,
    ['prompt_tokens', 'input_tokens', 'inputTokens']
  );
  const output = ownSafeUsageValue(
    usage,
    ['completion_tokens', 'output_tokens', 'outputTokens']
  );
  if (!input.present || !input.valid || !output.present || !output.valid) {
    throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
  }
  let reasoning = ownSafeUsageValue(
    usage,
    ['thoughtsTokenCount', 'reasoningTokens', 'reasoningOutputTokens']
  );
  for (const detailKey of ['output_tokens_details', 'completion_tokens_details']) {
    if (reasoning.present) break;
    let detailsDescriptor;
    try { detailsDescriptor = Object.getOwnPropertyDescriptor(usage, detailKey); } catch (_) {
      throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
    }
    if (detailsDescriptor) {
      if (!Object.hasOwn(detailsDescriptor, 'value')) {
        throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
      }
      reasoning = ownSafeUsageValue(detailsDescriptor.value, ['reasoning_tokens']);
    }
  }
  if (reasoning.present && (!reasoning.valid || reasoning.value > output.value)) {
    throw providerProbeError('PROBE_TOKEN_USAGE_MISSING');
  }
}

function declaredResponseBytes(response) {
  try {
    const value = response?.headers?.get?.('Content-Length') ??
      response?.headers?.get?.('content-length');
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  } catch (_) {
    return null;
  }
}

function cancelResponseBody(response, reader = null) {
  try {
    const cancellation = reader?.cancel
      ? reader.cancel()
      : response?.body?.cancel
        ? response.body.cancel()
        : null;
    Promise.resolve(cancellation).catch(() => {});
  } catch (_) {}
}

async function readBoundedDeepSeekResponse(response) {
  if (declaredResponseBytes(response) > PROBE_LIMITS.maxResponseBytes) {
    cancelResponseBody(response);
    throw providerProbeError('PROBE_RESPONSE_TOO_LARGE');
  }
  let text;
  if (response?.body && typeof response.body.getReader === 'function') {
    let reader;
    const chunks = [];
    let totalBytes = 0;
    try {
      reader = response.body.getReader();
      while (true) {
        const item = await reader.read();
        if (item?.done) break;
        if (!(item?.value instanceof Uint8Array)) {
          throw providerProbeError('INVALID_RESPONSE');
        }
        if (item.value.byteLength > PROBE_LIMITS.maxResponseBytes - totalBytes) {
          cancelResponseBody(response, reader);
          throw providerProbeError('PROBE_RESPONSE_TOO_LARGE');
        }
        const chunk = Buffer.from(item.value);
        totalBytes += chunk.length;
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks, totalBytes).toString('utf8');
    } finally {
      try { reader?.releaseLock?.(); } catch (_) {}
    }
  } else {
    const value = await response.text();
    if (typeof value !== 'string') throw providerProbeError('INVALID_RESPONSE');
    if (byteLength(value) > PROBE_LIMITS.maxResponseBytes) {
      throw providerProbeError('PROBE_RESPONSE_TOO_LARGE');
    }
    text = value;
  }
  assertDeepSeekUsageReported(text);
  return text;
}

function createBoundedDeepSeekFetch(fetchImpl) {
  return async (url, options = {}) => {
    if (typeof options.body !== 'string' ||
        byteLength(options.body) > PROBE_LIMITS.maxRequestBytes) {
      throw providerProbeError('PROBE_REQUEST_TOO_LARGE');
    }
    const response = await fetchImpl(url, options);
    let textPromise = null;
    return {
      ok: response?.ok === true,
      status: Number(response?.status) || 0,
      headers: response?.headers,
      body: response?.body,
      text() {
        textPromise ||= readBoundedDeepSeekResponse(response);
        return textPromise;
      }
    };
  };
}

export function createDeepSeekProbeAdapter(secret, options = {}) {
  if (typeof secret !== 'string' || !secret.trim() ||
      secret.length > PROBE_LIMITS.maxSecretChars) {
    throw probeError('PROBE_KEY_INVALID');
  }
  const fetchImpl = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (...args) => globalThis.fetch(...args);
  return createProviderAdapter({
    providerId: 'deepseek',
    config: {
      apiKey: secret,
      model: DEEPSEEK_VISION_MODEL,
      reasoningEnabled: false,
      reasoningEffort: 'auto'
    },
    fetchImpl: createBoundedDeepSeekFetch(fetchImpl)
  });
}

export function readSecretFromTty(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const prompt = typeof options.prompt === 'string' ? options.prompt : 'DeepSeek API key: ';
  if (input?.isTTY !== true || output?.isTTY !== true ||
      typeof input.setRawMode !== 'function') {
    return Promise.reject(probeError('TTY_REQUIRED'));
  }
  let wasRaw;
  let wasFlowing;
  let wasPaused;
  try {
    if (typeof input.listenerCount !== 'function' ||
        input.listenerCount('data') > 0 || input.listenerCount('readable') > 0 ||
        typeof input.isPaused !== 'function') {
      return Promise.reject(probeError('TTY_REQUIRED'));
    }
    wasRaw = input.isRaw === true;
    wasFlowing = input.readableFlowing;
    wasPaused = input.isPaused();
  } catch (_) {
    return Promise.reject(probeError('TTY_REQUIRED'));
  }
  return new Promise((resolveSecret, rejectSecret) => {
    const characters = [];
    let settled = false;
    let rawArmed = false;
    const listenerEntries = [];
    const removeOwnListeners = () => {
      for (const [eventName, handler] of listenerEntries) {
        try { input.removeListener(eventName, handler); } catch (_) {}
      }
      listenerEntries.length = 0;
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      removeOwnListeners();
      let cleanupError = null;
      if (rawArmed) {
        try { input.setRawMode(wasRaw); } catch (_) {
          cleanupError = probeError('PROBE_TTY_IO_ERROR');
        }
      }
      try {
        if (wasFlowing === true) input.resume();
        else input.pause();
      } catch (_) {
        cleanupError ||= probeError('PROBE_TTY_IO_ERROR');
      }
      try { input.readableFlowing = wasFlowing; } catch (_) {
        cleanupError ||= probeError('PROBE_TTY_IO_ERROR');
      }
      try { output.write('\n'); } catch (_) {
        cleanupError ||= probeError('PROBE_TTY_IO_ERROR');
      }
      const finalError = cleanupError || error;
      const value = finalError ? '' : characters.join('').trim();
      characters.fill('');
      if (finalError) rejectSecret(finalError);
      else {
        if (!value) rejectSecret(probeError('PROBE_KEY_INVALID'));
        else resolveSecret(value);
      }
    };
    const onData = chunk => {
      if (settled) return;
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        for (const byte of bytes) {
          if (byte === 3) {
            finish(probeError('PROBE_INTERRUPTED'));
            return;
          }
          if (byte === 13 || byte === 10) {
            finish();
            return;
          }
          if (byte === 8 || byte === 127) {
            characters.pop();
            continue;
          }
          if (byte >= 32 && byte <= 126) {
            if (characters.length >= PROBE_LIMITS.maxSecretChars) {
              finish(probeError('PROBE_KEY_TOO_LONG'));
              return;
            }
            characters.push(String.fromCharCode(byte));
          }
        }
      } catch (_) {
        finish(probeError('PROBE_TTY_IO_ERROR'));
      }
    };
    const onClosed = () => finish(probeError('PROBE_TTY_CLOSED'));
    const onError = () => finish(probeError('PROBE_TTY_IO_ERROR'));
    listenerEntries.push(
      ['data', onData],
      ['end', onClosed],
      ['close', onClosed],
      ['error', onError]
    );
    try {
      output.write(prompt);
    } catch (_) {
      finish(probeError('PROBE_TTY_IO_ERROR'));
      return;
    }
    try {
      input.setRawMode(true);
      rawArmed = true;
    } catch (_) {
      finish(probeError('TTY_REQUIRED'));
      return;
    }
    try {
      for (const [eventName, handler] of listenerEntries) input.on(eventName, handler);
    } catch (_) {
      finish(probeError('PROBE_TTY_IO_ERROR'));
      return;
    }
    try {
      input.resume?.();
    } catch (_) {
      finish(probeError('PROBE_TTY_IO_ERROR'));
    }
  });
}

async function pathEntry(pathname) {
  try {
    return await lstat(pathname);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw probeError('UNSAFE_REPORT_PATH');
  }
}

async function ensureDirectoryChainHasNoLinks(targetDirectory) {
  const absoluteTarget = resolve(targetDirectory);
  const rootPath = parse(absoluteTarget).root;
  let currentPath = rootPath;
  for (const segment of relative(rootPath, absoluteTarget).split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    let entry = await pathEntry(currentPath);
    if (!entry) {
      try {
        await mkdir(currentPath);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw probeError('UNSAFE_REPORT_PATH');
      }
      entry = await pathEntry(currentPath);
    }
    if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) {
      throw probeError('UNSAFE_REPORT_PATH');
    }
  }
  return absoluteTarget;
}

async function assertSafeReportFile(pathname) {
  const entry = await pathEntry(pathname);
  if (entry && (entry.isSymbolicLink() || !entry.isFile())) {
    throw probeError('UNSAFE_REPORT_PATH');
  }
}

async function writeReportAtFixedPath(report, rootDirectory) {
  const canonicalReport = assertSafeDiagnosticReport(report);
  const serializationGraph = createSafeReportSerializationGraph(canonicalReport);
  const rootDir = resolve(rootDirectory);
  const reportPath = resolve(rootDir, ...FIXED_REPORT_RELATIVE_PATH.split('/'));
  const expectedRelativePath = FIXED_REPORT_RELATIVE_PATH.split('/').join(sep);
  if (relative(rootDir, reportPath) !== expectedRelativePath) {
    throw probeError('UNSAFE_REPORT_PATH');
  }
  const reportDirectory = dirname(reportPath);
  await ensureDirectoryChainHasNoLinks(reportDirectory);
  await assertSafeReportFile(reportPath);
  const temporaryPath = join(
    reportDirectory,
    `.report.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(serializationGraph, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600
    });
    await ensureDirectoryChainHasNoLinks(reportDirectory);
    await assertSafeReportFile(reportPath);
    await rename(temporaryPath, reportPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
  return reportPath;
}

export async function writeRedactedReport(report) {
  return writeReportAtFixedPath(report, REPOSITORY_ROOT);
}

export function __testOnlyCreateReportWriter(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).length !== 1 || typeof options.rootDir !== 'string' ||
      !options.rootDir.trim()) {
    throw probeError('UNSAFE_REPORT_PATH');
  }
  const rootDir = resolve(options.rootDir);
  return report => writeReportAtFixedPath(report, rootDir);
}

function safeConsoleSummary(report) {
  const canonicalReport = assertSafeDiagnosticReport(report);
  const tokenTotal = canonicalReport.tokenTotals.input + canonicalReport.tokenTotals.output;
  return [
    'PASS',
    `input mode: ${canonicalReport.inputMode}`,
    `model: ${canonicalReport.model}`,
    `finish: ${canonicalReport.finishReason}`,
    `visual verified: ${canonicalReport.visualVerified}`,
    `panels requested: ${canonicalReport.panelCounts.requested}`,
    `panels received: ${canonicalReport.panelCounts.received}`,
    `panels recovered: ${canonicalReport.panelCounts.recovered}`,
    `panels unresolved: ${canonicalReport.panelCounts.unresolved}`,
    `panels unique: ${canonicalReport.panelCounts.unique}`,
    `panels matched: ${canonicalReport.panelCounts.matched}`,
    `requests: ${canonicalReport.requestCount}`,
    `tokens: ${tokenTotal}`,
    `elapsed ms: ${canonicalReport.elapsedMs}`,
    `report: ${FIXED_REPORT_RELATIVE_PATH}`
  ].join('\n');
}

export function __testOnlySafeConsoleSummary(report) {
  return safeConsoleSummary(report);
}

export async function interactiveMain(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  let secret = '';
  try {
    secret = await readSecretFromTty({ input, output });
    const adapter = createDeepSeekProbeAdapter(secret);
    const report = await runOfflineFigureRecoveryProbe({ adapter });
    await writeRedactedReport(report);
    output.write(`${safeConsoleSummary(report)}\n`);
    return report;
  } finally {
    secret = '';
  }
}

export function safeErrorCode(error) {
  let code = '';
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (descriptor && Object.hasOwn(descriptor, 'value') &&
          typeof descriptor.value === 'string') {
        code = descriptor.value;
      }
    } catch (_) {}
  }
  return SAFE_ERROR_CODES.has(code) ? code : 'PROBE_FAILED';
}

const directExecution = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directExecution) {
  interactiveMain().catch(error => {
    process.stderr.write(`FAIL ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
