const test = require('node:test');
const assert = require('node:assert/strict');
const { translateInterfaceText: translate } = require('../core/i18n.js');
const { publicWorkspaceDirectoryError } = require('../core/workspace-directory-controller.js');

test('note copy/export controls and operation results have English UI text without changing Chinese mode', () => {
  const cases = new Map([
    ['复制笔记', 'Copy notes'], ['导出 Markdown', 'Export Markdown'],
    ['笔记复制与导出', 'Copy and export notes'],
    ['已复制当前模板笔记，来源状态一并保留。', 'Copied the current template notes with their source status.'],
    ['已生成 Markdown 文件；颜色使用笔记的受控标记。', 'Markdown file created; colors use the note format markers.'],
    ['复制失败：笔记模板不可用', 'Copy failed: The note template is unavailable'],
    ['导出失败：笔记格式无法安全转换，原文已保留', 'Export failed: The note format could not be converted safely; the original text was preserved'],
    ['导出失败：“用户字段”的来源无法安全转换，原文已保留', 'Export failed: Sources for “用户字段” could not be converted safely; the original text was preserved']
  ]);
  for (const [source, expected] of cases) {
    assert.equal(translate(source, 'en'), expected);
    assert.equal(translate(source, 'zh-CN'), source);
  }
});

test('native directory pending/bound messages translate chrome while preserving actual names', () => {
  const cases = new Map([
    ['正在核验并绑定本机目录…', 'Verifying and binding the local folder…'],
    ['正在检查本机助手与目录绑定…', 'Checking the local helper and folder binding…'],
    ['请填写实际数据根的完整绝对路径。目录名不能代替本机路径。', 'Enter the full absolute path of the actual data root. A folder name is not a local path.'],
    ['绑定成功：SCI-Highlighter。仅打开已同步且通过身份校验的文献目录；绑定不代表文献已同步。',
      'Bound: SCI-Highlighter. Only synced article folders with verified identity can be opened; binding does not mean an article has been synced.'],
    ['本机助手可用，最近核验已绑定目录：笔记。', 'Local helper available. Last verified bound folder: 笔记.'],
    ['本机助手可用，最近核验已绑定目录：当前数据根。', 'Local helper available. Last verified bound folder: current data root.']
  ]);
  for (const [source, expected] of cases) {
    assert.equal(translate(source, 'en'), expected);
    assert.equal(translate(source, 'zh-CN'), source);
  }
});

test('copy/export notification history keeps translations after its existing NFKC normalization', () => {
  for (const source of [
    '已复制当前模板笔记，来源状态一并保留。',
    '已生成 Markdown 文件；颜色使用笔记的受控标记。',
    '复制失败：笔记模板不可用',
    '导出失败：笔记格式无法安全转换，原文已保留',
    '导出失败：“用户字段”的来源无法安全转换，原文已保留'
  ]) {
    const notification = source.normalize('NFKC');
    assert.equal(translate(notification, 'en'), translate(source, 'en'), notification);
    assert.equal(translate(notification, 'zh-CN'), notification);
  }
});

test('all current directory-controller failures translate including stable diagnostic suffixes', () => {
  const suffixes = ['UNCONFIGURED', 'PERMISSION_REQUIRED', 'ROOT_MISSING', 'BINDING_MISSING',
    'BINDING_INVALID', 'ROOT_CHANGED', 'NOT_SYNCED', 'IDENTITY_MISMATCH', 'PATH_INVALID',
    'MANIFEST_INVALID', 'CRYPTO_UNAVAILABLE', 'IO_ERROR', 'UNSUPPORTED', 'INVALID_REQUEST',
    'INVALID_PATH', 'NOT_BOUND', 'ROOT_MISMATCH', 'PROOF_INVALID', 'PROOF_EXPIRED',
    'CONFIG_INVALID', 'CONFIG_WRITE_FAILED', 'MISSING', 'PATH_ESCAPE', 'OPEN_FAILED',
    'HOST_UNAVAILABLE', 'HOST_UPDATE_REQUIRED', 'TIMEOUT', 'PROTOCOL_INVALID', 'FORBIDDEN', 'BUSY'];
  for (const suffix of suffixes) {
    const error = publicWorkspaceDirectoryError({ code: `WORKSPACE_DIRECTORY_${suffix}` });
    const source = `${error.message}（${error.code}）`;
    const english = translate(source, 'en');
    assert.doesNotMatch(english, /[\u3400-\u9fff]/u, suffix);
    assert.ok(english.endsWith(`(${error.code})`), suffix);
    assert.equal(translate(source, 'zh-CN'), source, suffix);
  }
});

test('library folder status and accessible labels preserve literal article titles', () => {
  const title = '复制笔记 <b>人类原题名</b>';
  const cases = new Map([
    [`打开 ${title} 的文件夹`, `Open folder for ${title}`],
    [`正在核验「${title}」的文献目录…`, `Verifying the article folder for “${title}”…`],
    [`已请求系统打开「${title}」的文件夹，请查看文件管理器。`, `Requested the system to open the folder for “${title}”. Check your file manager.`],
    [`「${title}」：这篇文献的本地目录不存在，请先完成保存与同步。（WORKSPACE_DIRECTORY_MISSING）`,
      `“${title}”: This article's local folder does not exist. Save and sync it first. (WORKSPACE_DIRECTORY_MISSING)`]
  ]);
  for (const [source, expected] of cases) {
    assert.equal(translate(source, 'en'), expected);
    assert.equal(translate(source, 'zh-CN'), source);
  }
  assert.equal(translate('D:\\用户资料\\SCI-Highlighter', 'en'), 'D:\\用户资料\\SCI-Highlighter');
  assert.equal(translate('用户笔记正文及原始引文', 'en'), '用户笔记正文及原始引文');
  assert.equal(translate('复制失败：Unexpected clipboard denial <b>literal</b>', 'en'),
    'Copy failed: Unexpected clipboard denial <b>literal</b>');
});
