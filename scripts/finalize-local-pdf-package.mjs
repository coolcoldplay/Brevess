import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { releaseInventory } from './release-inventory.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const require = createRequire(import.meta.url);
// Reuse the JavaScript parser bundled with the declared Playwright dev dependency.
// Syntax parsing avoids treating Mermaid grammar strings as executable imports.
const { babelParse } = require(path.join(
  path.dirname(require.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'
));
const FIXED_LOCAL_EXTENSION_ID = 'finhfnjbpidfakpmkghkfjlfcfpoandh';
const PDFJS_EXTENSION_PAGE_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
const ACCEPTED_REPORT_STATUSES = new Set(['PASS', 'PASS_WITH_EVIDENCE_REVIEW']);
const REPORT_KINDS = new Set(['realApi', 'figureApi', 'nativeUi', 'syntheticOcr']);

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walkFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => entry.isDirectory()
      ? walkFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]);
}

function normalizeRelativePath(value, code = 'INVALID_RELATIVE_PATH') {
  const normalized = String(value || '').replace(/\\/g, '/').trim();
  if (!normalized || path.posix.isAbsolute(normalized) ||
      normalized.split('/').some(part => !part || part === '.' || part === '..') ||
      normalized.includes(':')) {
    throw new Error(code);
  }
  return normalized;
}

function resolveInside(root, relative, code = 'PATH_ESCAPES_ROOT') {
  const normalized = normalizeRelativePath(relative, code);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(code);
  }
  return resolved;
}

function readJson(file, code = 'INVALID_JSON') {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`${code}: ${path.basename(file)}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function realApiCallCount(report) {
  const candidates = [
    report?.realApiCalls,
    report?.network?.realApiCalls,
    report?.metrics?.realApiCalls,
    report?.verification?.realApiCalls
  ];
  const value = candidates.find(candidate => Number.isFinite(Number(candidate)));
  return Math.max(0, Math.floor(Number(value) || 0));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function validateFigureApiReport(report, relativePath, apiCalls) {
  const invalid = reason => {
    throw new Error(`FIGURE_API_EVIDENCE_INVALID:${relativePath}:${reason}`);
  };
  if (report?.realFigures !== true || apiCalls < 1 ||
      report?.fixtures !== false || report?.replay !== false ||
      report?.network?.fixtures === true || report?.network?.replay === true) {
    invalid('PROVENANCE');
  }
  if (report?.review?.status !== 'PASS') invalid('REVIEW');
  if (report?.scope?.freshOriginalImagePanelExtraction !== true ||
      report?.scope?.freshFigureSynthesis !== true ||
      report?.scope?.broadScientificCorrectnessClaim !== false) {
    invalid('SCOPE');
  }
  const expectedPanelCount = positiveInteger(report?.expectedPanelCount);
  const generatedPanelCount = positiveInteger(report?.generatedPanelCount);
  if (!expectedPanelCount || generatedPanelCount !== expectedPanelCount) {
    invalid('PANEL_COUNT');
  }
  if (!Array.isArray(report?.figures) || report.figures.length === 0) {
    invalid('FIGURES');
  }
  const figureIds = new Set();
  let expectedSum = 0;
  let generatedSum = 0;
  for (const figure of report.figures) {
    const figureId = typeof figure?.figureId === 'string' ? figure.figureId.trim() : '';
    const figureExpected = positiveInteger(figure?.expectedPanelCount);
    const figureGenerated = positiveInteger(figure?.generatedPanelCount);
    if (!figureId || figureIds.has(figureId) || figure?.status !== 'PASS' ||
        !figureExpected || figureGenerated !== figureExpected ||
        figure?.incompleteFigure !== false || !Array.isArray(figure?.errors)) {
      invalid('FIGURE_RESULT');
    }
    if (figure.errors.some(error =>
      /incomplete[_-]?figure/iu.test(typeof error === 'string'
        ? error : JSON.stringify(error)))) {
      invalid('INCOMPLETE_FIGURE');
    }
    figureIds.add(figureId);
    expectedSum += figureExpected;
    generatedSum += figureGenerated;
  }
  if (expectedSum !== expectedPanelCount || generatedSum !== generatedPanelCount ||
      (report.incompleteFigureErrors !== undefined &&
        Number(report.incompleteFigureErrors) !== 0)) {
    invalid('AGGREGATE');
  }
  return { expectedPanelCount, generatedPanelCount, figureCount: figureIds.size };
}

function normalizeDocumentationList(value) {
  const docs = (Array.isArray(value) ? value : []).map(item =>
    normalizeRelativePath(item, 'INVALID_DOCUMENTATION_PATH'));
  if (new Set(docs).size !== docs.length || docs.some(item =>
    !item.startsWith('docs/') || !/\.md$/iu.test(item))) {
    throw new Error('INVALID_DOCUMENTATION_PATH');
  }
  return docs.sort();
}

export function validateVerificationManifest(manifestPath, options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const manifestFile = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath)
    : resolveInside(rootDir, manifestPath, 'EVIDENCE_MANIFEST_OUTSIDE_REPOSITORY');
  if (manifestFile !== rootDir && !manifestFile.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error('EVIDENCE_MANIFEST_OUTSIDE_REPOSITORY');
  }
  const manifest = readJson(manifestFile, 'INVALID_EVIDENCE_MANIFEST');
  if (Number(manifest?.schemaVersion) !== 1 || !Array.isArray(manifest?.reports) ||
      manifest.reports.length === 0) {
    throw new Error('INVALID_EVIDENCE_MANIFEST');
  }
  const reports = manifest.reports.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !REPORT_KINDS.has(entry.kind)) {
      throw new Error(`INVALID_EVIDENCE_KIND:${index}`);
    }
    const relativePath = normalizeRelativePath(entry.path, `INVALID_EVIDENCE_PATH:${index}`);
    const reportFile = resolveInside(rootDir, relativePath, `EVIDENCE_REPORT_OUTSIDE_REPOSITORY:${index}`);
    assert.ok(fs.existsSync(reportFile) && fs.statSync(reportFile).isFile(),
      `EVIDENCE_REPORT_MISSING:${relativePath}`);
    const report = readJson(reportFile, `INVALID_EVIDENCE_REPORT:${relativePath}`);
    if (!ACCEPTED_REPORT_STATUSES.has(String(report?.status || ''))) {
      throw new Error(`EVIDENCE_REPORT_NOT_PASSING:${relativePath}`);
    }
    const apiCalls = realApiCallCount(report);
    if (entry.kind === 'realApi' && (
      report?.realPdf !== true || apiCalls < 1 ||
      report?.fixtures !== false || report?.replay !== false ||
      report?.network?.fixtures === true || report?.network?.replay === true
    )) {
      throw new Error(`REAL_API_EVIDENCE_INVALID:${relativePath}`);
    }
    const figureApi = entry.kind === 'figureApi'
      ? validateFigureApiReport(report, relativePath, apiCalls) : null;
    return Object.freeze({
      kind: entry.kind,
      path: relativePath,
      status: report.status,
      sha256: sha256File(reportFile),
      bytes: fs.statSync(reportFile).size,
      ...(entry.kind === 'realApi' ? { realPdf: true, realApiCalls: apiCalls } : {}),
      ...(entry.kind === 'figureApi' ? {
        realFigures: true,
        realApiCalls: apiCalls,
        expectedPanelCount: figureApi.expectedPanelCount,
        generatedPanelCount: figureApi.generatedPanelCount,
        figureCount: figureApi.figureCount,
        scientificReview: 'PASS'
      } : {}),
      ...(typeof report?.model === 'string' && report.model.trim()
        ? { model: report.model.trim().slice(0, 160) } : {})
    });
  });
  if (!reports.some(report => report.kind === 'realApi') ||
      !reports.some(report => report.kind === 'nativeUi')) {
    throw new Error('EVIDENCE_MANIFEST_REQUIRES_REAL_API_AND_NATIVE_UI');
  }
  return Object.freeze({
    manifestPath: path.relative(rootDir, manifestFile).replace(/\\/g, '/'),
    manifestSha256: sha256File(manifestFile),
    documentation: normalizeDocumentationList(manifest.documentation),
    reports
  });
}

export function deriveExtensionId(publicKey) {
  let bytes;
  try {
    bytes = Buffer.from(String(publicKey || ''), 'base64');
  } catch (_) {
    throw new Error('INVALID_MANIFEST_KEY');
  }
  if (!bytes.length || bytes.toString('base64').replace(/=+$/u, '') !==
      String(publicKey || '').replace(/\s+/gu, '').replace(/=+$/u, '')) {
    throw new Error('INVALID_MANIFEST_KEY');
  }
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/gu, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)));
}

const CREDENTIAL_PATTERNS = Object.freeze([
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['openai-style-key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/u],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/u],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/iu],
  ['assigned-api-key', /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9_./+~-]{24,}["']/iu]
]);

export function findCredentialPattern(text) {
  const source = String(text || '');
  return CREDENTIAL_PATTERNS.find(([, expression]) => expression.test(source))?.[0] || '';
}

function sourceInventory(rootDir, options = {}) {
  if (Array.isArray(options.sourceFiles)) {
    return [...new Set(options.sourceFiles.map(item => normalizeRelativePath(item)))].sort();
  }
  return releaseInventory(rootDir, options.packageVariant || 'full').map(file => file.source);
}

export function checkLocalReferences(targetDir, files) {
  let checked = 0;
  const available = new Set(files);
  const check = (owner, rawReference, options = {}) => {
    const reference = String(rawReference || '').trim();
    if (!reference || /^(?:[a-z][\w+.-]*:|\/\/|#)/iu.test(reference)) return;
    let decoded;
    try {
      decoded = decodeURIComponent(reference.split(/[?#]/u)[0]);
    } catch (_) {
      throw new Error(`INVALID_LOCAL_RESOURCE_REFERENCE:${owner}:${reference}`);
    }
    if (!decoded) return;
    const directoryReference = options.allowDirectory === true && decoded.endsWith('/');
    const ownerDirectory = options.extensionRoot === true ? '' : path.posix.dirname(owner);
    const relative = path.posix.normalize(path.posix.join(ownerDirectory, decoded));
    const normalizedDirectory = relative.replace(/\/+$/u, '');
    const directoryPrefix = `${normalizedDirectory}/`;
    const directoryHasFiles = directoryReference && files.some(file => file.startsWith(directoryPrefix));
    let directoryExists = false;
    if (directoryHasFiles) {
      const absoluteDirectory = resolveInside(
        targetDir, normalizedDirectory, 'INVALID_LOCAL_RESOURCE_DIRECTORY'
      );
      directoryExists = fs.existsSync(absoluteDirectory) &&
        fs.statSync(absoluteDirectory).isDirectory() && walkFiles(absoluteDirectory).length > 0;
    }
    if (relative.startsWith('../') || path.posix.isAbsolute(relative) ||
        (directoryReference ? !directoryExists : !available.has(relative))) {
      throw new Error(`MISSING_LOCAL_RESOURCE:${owner}:${reference}`);
    }
    checked += 1;
  };
  for (const owner of files) {
    if (!/\.(?:html|js|mjs|css)$/iu.test(owner)) continue;
    const text = fs.readFileSync(resolveInside(targetDir, owner), 'utf8');
    if (/\.html$/iu.test(owner)) {
      for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/giu)) {
        check(owner, match[1]);
      }
    }
    if (/\.(?:js|mjs)$/iu.test(owner)) {
      const memberPath = node => node?.type === 'Identifier' ? node.name
        : node?.type === 'MetaProperty' ? node.meta.name + '.' + node.property.name
        : node?.type === 'MemberExpression' && !node.computed
          ? memberPath(node.object) + '.' + node.property.name : '';
      const literal = node => node?.type === 'StringLiteral' ? node.value : null;
      const pending = [babelParse(text, path.join(targetDir, owner), true)];
      while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration',
          'ImportExpression'].includes(node.type) && literal(node.source) !== null) {
          check(owner, literal(node.source));
        }
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
          const callee = memberPath(node.callee);
          const first = literal(node.arguments?.[0]);
          if (callee === 'importScripts') {
            for (const arg of node.arguments || []) {
              if (literal(arg) !== null) check(owner, literal(arg));
            }
          } else if (first !== null && (node.callee?.type === 'Import' ||
              (node.type === 'NewExpression' && callee === 'Worker'))) {
            check(owner, first);
          } else if (first !== null && node.type === 'NewExpression' &&
              callee === 'URL' && memberPath(node.arguments?.[1]) === 'import.meta.url') {
            check(owner, first);
          } else if (first !== null && callee === 'chrome.runtime.getURL') {
            check(owner, first, { extensionRoot: true, allowDirectory: true });
          }
        }
        for (const [key, value] of Object.entries(node)) {
          if (['loc', 'start', 'end', 'leadingComments', 'trailingComments',
            'innerComments', 'comments', 'tokens'].includes(key)) continue;
          if (Array.isArray(value)) pending.push(...value);
          else if (value && typeof value === 'object') pending.push(value);
        }
      }
    }
    if (/\.css$/iu.test(owner)) {
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)) check(owner, match[1]);
    }
  }
  const manifest = readJson(path.join(targetDir, 'manifest.json'), 'INVALID_PACKAGE_MANIFEST');
  const manifestReferences = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || [])
  ];
  for (const reference of manifestReferences) check('manifest.json', reference);
  return checked;
}

function renderReadme({ buildName, version, evidence, extensionId }) {
  const realApi = evidence.reports.filter(item => item.kind === 'realApi');
  const figureApi = evidence.reports.filter(item => item.kind === 'figureApi');
  const nativeUi = evidence.reports.filter(item => item.kind === 'nativeUi');
  const syntheticOcr = evidence.reports.filter(item => item.kind === 'syntheticOcr');
  const modelNames = [...new Set([...realApi, ...figureApi]
    .map(item => item.model).filter(Boolean))];
  const models = modelNames.length ? modelNames.join('、') : '证据清单所记录的模型';
  const evidenceLines = evidence.reports.map(item =>
    `- \`${item.kind}\`：\`${item.path}\`，${item.status}，SHA-256 \`${item.sha256}\``).join('\n');
  const documentationLines = evidence.documentation.length
    ? evidence.documentation.map(item => {
      const href = item.split('/').map(part => encodeURIComponent(part)).join('/');
      return `- [\`${item}\`](${href})`;
    }).join('\n')
    : '- 本次证据清单未指定更新记录。';
  return `# Brevess 本地验收安装包

构建标识：\`${buildName}\`；扩展版本：\`${version}\`；固定开发版扩展 ID：\`${extensionId}\`。

本包直接保留并显示原 PDF 页面。普通含文字层的 PDF 支持原页翻页、缩放、划选、标注、自动高亮、全文问答和 Figure 工作区；索引与高亮不会以解析后的重排页面替换原页画面。

扫描件在原生文字不足时会明确提示需要文字识别。当前没有完成“真实扫描 PDF 经 MinerU 识别后”的端到端验收，因此不声明扫描件识别准确率、坐标准确率或 MinerU 可用性。${syntheticOcr.length ? '清单中的 syntheticOcr 只验证透明文字层几何与原页像素保持，不代表真实 OCR。' : '本包没有把合成文字层测试当作真实 OCR 证据。'}

Figure 的非多模态分析依据正文、图注和上下文，不声称看到了图像内容。只有明确使用视觉模型并有对应验收证据的路线才可作图像解读；本说明不把未验证模型写成已通过。此次真实 API 证据记录的模型为：${models}。

包内不包含你的 API Key、浏览器数据、论文原文、私人标注或模型原始响应。包内包含 \`native-host\`；构建阶段会准备伴随程序，验收清单生成步骤只核对文件，不会安装、注册或登录。需要本机 Codex/PDF 伴随功能时再按 [INSTALL.md](INSTALL.md) 安装。

[BUILD39_OPTIMIZATION.md](BUILD39_OPTIMIZATION.md) 是早期 2.4.x/build39 的历史优化记录，不是本包版本号或当前验收声明。

## 本次更新与验证范围

${documentationLines}

## 验收证据

验收状态由显式清单 \`${evidence.manifestPath}\` 提供。真实 PDF API 报告 ${realApi.length} 项，真实 Figure API 报告 ${figureApi.length} 项，本机 UI 报告 ${nativeUi.length} 项：

${evidenceLines}

报告只以路径、状态和哈希记入 PACKAGE_INFO.json，不把报告正文复制进安装包。
`;
}

function renderInstall({ extensionId, buildName, version }) {
  return `# 本地安装与升级

安装包构建标识：\`${buildName}\`；扩展版本：\`${version}\`。

## 升级现有开发版

1. 等待正在执行的任务结束，导出需要保留的迁移文件和重要文献档案。迁移文件可能包含 API Key，请自行妥善保管。
2. 在 \`edge://extensions/\` 或 \`chrome://extensions/\` 记录当前扩展 ID 与加载目录，不要先卸载扩展。
3. 备份旧加载目录，将本包完整内容替换到同一目录，确保 \`manifest.json\` 位于目录根部。
4. 在扩展管理页点击“重新加载”，再刷新论文页并重新打开侧栏。
5. 核对扩展 ID、设置、历史标注和文献工作区。固定开发版 ID 为 \`${extensionId}\`；若现有 ID 不同，请先完成迁移，不要假设浏览器存储会自动共享。

## 首次安装

1. 在扩展管理页开启开发人员模式。
2. 选择“加载解压缩的扩展程序”，选中直接包含 \`manifest.json\` 的目录。
3. 打开网页论文或使用扩展的本地 PDF 入口。LLM 功能需要用户自行配置模型、API 与正文发送许可。

## 原页 PDF 与扫描件

普通含文字层 PDF 会保持原页显示，并建立本地可选文字索引。扫描件缺少文字层时仍显示原页，但会提示增强识别；真实 MinerU 扫描识别尚未完成验收。不要把 syntheticOcr 组件报告理解成 OCR 准确率证明。

## 可选 native-host

包内保留已有 Windows x64 伴随程序。仅在需要本机 Codex/PDF 功能或安装路径变化时，在 \`native-host\` 目录运行：

\`\`\`powershell
.\\install.ps1 -ExtensionId 你的实际扩展ID
\`\`\`

生成安装包不会运行上述安装命令或更改浏览器注册。登录与连接测试见 [CODEX_LOCAL_SETUP.md](CODEX_LOCAL_SETUP.md)；连接测试可能产生真实模型请求。
`;
}

function assertNoCredentials(targetDir, files, virtualFiles = new Map()) {
  for (const file of files) {
    if (!/\.(?:js|mjs|json|html|css|md|txt|ps1|cmd)$/iu.test(file)) continue;
    const text = virtualFiles.has(file)
      ? virtualFiles.get(file)
      : fs.readFileSync(resolveInside(targetDir, file), 'utf8');
    const pattern = findCredentialPattern(text);
    if (pattern) throw new Error(`POSSIBLE_CREDENTIAL:${pattern}:${file}`);
  }
}

function writeUtf8(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function finalizeLocalPdfPackage(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const buildName = String(options.buildName || '');
  if (!/^Brevess-[A-Za-z0-9._-]+$/u.test(buildName)) throw new Error('INVALID_PACKAGE_NAME');
  if (!options.evidenceManifestPath) throw new Error('EVIDENCE_MANIFEST_REQUIRED');
  const distDir = path.join(rootDir, 'dist');
  const targetDir = path.join(distDir, buildName);
  if (!targetDir.startsWith(`${distDir}${path.sep}`) || !fs.existsSync(targetDir) ||
      !fs.statSync(targetDir).isDirectory()) {
    throw new Error('PACKAGE_STAGE_MISSING');
  }

  const evidence = validateVerificationManifest(options.evidenceManifestPath, { rootDir });
  const baseSourceFiles = sourceInventory(rootDir, options);
  const extraDocs = evidence.documentation;
  const expectedFinalFiles = [...new Set([...baseSourceFiles, ...extraDocs])].sort();
  const allowedInitialFiles = new Set([...expectedFinalFiles, 'PACKAGE_INFO.json']);
  const initialFiles = walkFiles(targetDir);
  const unexpected = initialFiles.filter(file => !allowedInitialFiles.has(file));
  if (unexpected.length) throw new Error(`PACKAGE_FILE_INVENTORY_MISMATCH:${unexpected.join(',')}`);
  for (const file of baseSourceFiles) {
    assert.ok(initialFiles.includes(file), `PACKAGE_SOURCE_FILE_MISSING:${file}`);
  }

  const packageManifest = readJson(path.join(targetDir, 'manifest.json'), 'INVALID_PACKAGE_MANIFEST');
  const sourceManifest = readJson(path.join(rootDir, 'manifest.json'), 'INVALID_SOURCE_MANIFEST');
  assert.deepEqual(packageManifest, sourceManifest, 'PACKAGE_MANIFEST_SOURCE_MISMATCH');
  assert.equal(packageManifest.manifest_version, 3, 'PACKAGE_MANIFEST_VERSION_MISMATCH');
  assert.equal(packageManifest.content_security_policy?.extension_pages,
    PDFJS_EXTENSION_PAGE_CSP, 'PACKAGE_PDF_WASM_CSP_MISMATCH');
  const extensionId = deriveExtensionId(packageManifest.key);
  assert.equal(extensionId, FIXED_LOCAL_EXTENSION_ID, 'PACKAGE_EXTENSION_ID_MISMATCH');

  const documentationOverrides = new Set(['README.md', 'INSTALL.md']);
  for (const file of baseSourceFiles) {
    if (documentationOverrides.has(file)) continue;
    assert.equal(sha256File(resolveInside(targetDir, file)),
      sha256File(resolveInside(rootDir, file)), `PACKAGE_SOURCE_HASH_MISMATCH:${file}`);
  }
  for (const file of extraDocs) {
    assert.ok(fs.statSync(resolveInside(rootDir, file)).isFile(), `DOCUMENTATION_SOURCE_MISSING:${file}`);
  }

  const readme = renderReadme({
    buildName, version: packageManifest.version, evidence, extensionId
  });
  const install = renderInstall({
    extensionId, buildName, version: packageManifest.version
  });
  const virtualFiles = new Map([['README.md', readme], ['INSTALL.md', install]]);
  for (const file of extraDocs) virtualFiles.set(file, fs.readFileSync(resolveInside(rootDir, file), 'utf8'));
  assertNoCredentials(targetDir, expectedFinalFiles, virtualFiles);
  const referencesChecked = checkLocalReferences(targetDir, baseSourceFiles);

  writeUtf8(path.join(targetDir, 'README.md'), readme);
  writeUtf8(path.join(targetDir, 'INSTALL.md'), install);
  for (const file of extraDocs) {
    writeUtf8(resolveInside(targetDir, file), virtualFiles.get(file));
  }
  const finalBeforeInfo = walkFiles(targetDir).filter(file => file !== 'PACKAGE_INFO.json');
  assert.deepEqual(finalBeforeInfo.sort(), expectedFinalFiles, 'PACKAGE_FINAL_INVENTORY_MISMATCH');

  const files = finalBeforeInfo.map(file => {
    const targetFile = resolveInside(targetDir, file);
    const sourceDerived = !documentationOverrides.has(file);
    if (sourceDerived) {
      assert.equal(sha256File(targetFile), sha256File(resolveInside(rootDir, file)),
        `PACKAGE_FINAL_SOURCE_HASH_MISMATCH:${file}`);
    }
    return {
      file,
      bytes: fs.statSync(targetFile).size,
      sha256: sha256File(targetFile),
      sourceDerived,
      sourceMatched: sourceDerived
    };
  });
  const overallStatus = evidence.reports.some(item => item.status === 'PASS_WITH_EVIDENCE_REVIEW')
    ? 'PASS_WITH_EVIDENCE_REVIEW' : 'PASS';
  const info = {
    schemaVersion: 1,
    status: overallStatus,
    build: buildName,
    version: packageManifest.version,
    finalizedAt: (options.now || new Date()).toISOString(),
    extensionId,
    fixedManifestIdentityVerified: true,
    sourceState: 'staged-from-current-worktree',
    workingTreeChangesIncluded: true,
    actionsPerformed: {
      scope: 'finalizeLocalPdfPackage-only',
      compiled: false, nativeHostStarted: false, nativeHostRegistered: false,
      installed: false, archived: false, published: false
    },
    verification: {
      status: overallStatus,
      evidenceManifest: evidence.manifestPath,
      evidenceManifestSha256: evidence.manifestSha256,
      reports: evidence.reports,
      referencesChecked,
      sourceMatchedFiles: files.filter(file => file.sourceMatched).length,
      documentationOverrides: [...documentationOverrides],
      includedDocumentation: extraDocs,
      realMineruScannedPdfVerified: false,
      ocrAccuracyVerified: false
    },
    limitations: {
      originalPdfPagesPreserved: true,
      regularTextPdfSupported: true,
      realScannedPdfMineruFlowVerified: false,
      syntheticOcrIsAccuracyEvidence: false,
      nonMultimodalFigureBasis: 'article-text-and-captions',
      unlistedModelsVerified: false
    },
    files
  };
  writeUtf8(path.join(targetDir, 'PACKAGE_INFO.json'), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

function parseCli(argv) {
  const buildName = argv[0];
  let evidenceManifestPath = '';
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--evidence-manifest' && argv[index + 1]) {
      evidenceManifestPath = argv[++index];
      continue;
    }
    throw new Error(`UNKNOWN_ARGUMENT:${argv[index]}`);
  }
  return { buildName, evidenceManifestPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  const info = finalizeLocalPdfPackage(parseCli(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    status: info.status,
    build: info.build,
    files: info.files.length,
    sourceMatchedFiles: info.verification.sourceMatchedFiles,
    referencesChecked: info.verification.referencesChecked,
    extensionId: info.extensionId,
    reports: info.verification.reports.length
  })}\n`);
}
