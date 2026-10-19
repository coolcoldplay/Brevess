import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {releaseInventory} from './release-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist/Brevess-v1.0.1-R37-r4-public-test'));
const commit = String(process.argv[3] || '');
if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Pass the full source commit SHA as the second argument.');
if (fs.existsSync(destination) || fs.existsSync(destination + '.zip')) throw new Error('Release destination already exists; choose a fresh immutable destination.');

const extension = path.join(destination, 'browser-extension');
for (const entry of releaseInventory(root, 'store')) {
  const target = path.join(extension, entry.path);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(root, entry.source), target);
}
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
for (const relative of ['core/sharing-background.js', 'sharing/client.js']) {
  if (!fs.readFileSync(path.join(extension, relative), 'utf8').includes("const DEFAULT_ENDPOINT = 'http://127.0.0.1:40731';")) {
    throw new Error('Public build must retain the generic local endpoint, without an operational server address.');
  }
}
fs.writeFileSync(path.join(destination, 'START-HERE.md'), `# BREVESS 1.0.1 · R37 r4 公开测试版

## 安装

1. 使用电脑端 Edge 或 Chrome，解压整个 ZIP。
2. 打开 edge://extensions 或 chrome://extensions，开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择直接包含 manifest.json 的 browser-extension 文件夹。
4. 已有 BREVESS 时先保留旧目录及备份，避免同时启用多个副本；更新后重载插件并刷新论文页。

## 账号与课题组测试

公开包未预置实际共享服务器地址。负责人需私下提供可用服务地址；在“设置中心 → 账号管理 → 高级设置 · 服务连接”填写并保存。默认本机地址仅为占位，不代表已有公共服务。

注册账号 → 邮箱验证 → 回到插件登录。将用户名发给课题组负责人，由负责人发出邀请，再在账号管理中接受。

打开同一篇论文、同一页面/PDF版本：给高亮句子写备注并设置“课题组可见”；另一人开启“查看公开备注”并筛选课题组，点击虚线句子测试回复、点赞和排序。在解图模块各 Panel 的评论入口测试交流。个人备注默认私有，共享内容需登录并满足组内权限。

## 模型与保存

新增模型连接时选择供应商、填写自己的 API Key，自动初始化默认模型。在功能表格选择具体模型、思考、推理强度和支持的联网选项，点击“保存功能设置”。现有设置保留。

在“本地保存”选择目录后，侧栏保存会写入文献文件。模型配置加密备份自愿启用，默认不要求口令；浏览器撤销目录权限后仍需恢复授权。AI 调用可能由供应商计费，普通高亮无需模型。

本包只包含浏览器扩展。本机 Codex、特定 PDF 图像提取等可选能力需另行准备本机伴侣；本版未提供伴侣二进制，不包含云端服务或部署配置。

遇到问题请记录包名、浏览器版本、操作步骤和截图。不要发送密码、API Key 或邮件授权码。

## English

Extract the ZIP. In Edge/Chrome extensions, enable Developer mode and load browser-extension (the folder containing manifest.json). Reload the extension and article tabs after an update.

This public package has no operational sharing endpoint. Obtain the service URL privately from your group owner, then enter it in Settings → Account management → Advanced · Service connection. The default loopback address is only a placeholder. Register, verify your email, sign in, and accept the owner's group invitation. Test shared sentence notes and Panel discussions on the same document version, including replies, likes and sorting.

Add model connections using your own provider/API key. Configure models, thinking, effort and supported web search per feature. Folder saving does not require the optional encrypted configuration backup. Revoked browser permissions still require recovery. Optional native companion binaries and server/deployment material are not included.

Source: https://github.com/coolcoldplay/Brevess/tree/${commit}
License: AGPL-3.0-or-later. See browser-extension/LICENSE and THIRD_PARTY_NOTICES.md.
`);

const files = [];
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
    const target = path.join(dir, entry.name), relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Release cannot contain symbolic links.');
    if (entry.isDirectory()) walk(target, relative + '/');
    else { const bytes = fs.readFileSync(target); files.push({path: relative, bytes: bytes.length, sha256: hash(bytes)}); }
  }
}
walk(destination);
const key = Buffer.from(hash(Buffer.from(manifest.key, 'base64')), 'hex').subarray(0,16);
const extensionId = [...key].map(x => String.fromCharCode(97+(x>>4),97+(x&15))).join('');
fs.writeFileSync(path.join(destination, 'PACKAGE_INFO.json'), JSON.stringify({
  kind: 'public-browser-test-release', version: manifest.version, versionName: manifest.version_name,
  sourceRepository: 'https://github.com/coolcoldplay/Brevess', sourceCommit: commit,
  extensionId, operationalServiceEndpointIncluded: false, serverDeploymentIncluded: false, files
}, null, 2) + '\n');
console.log(JSON.stringify({destination, extensionId, files: files.length, sourceCommit: commit}));
