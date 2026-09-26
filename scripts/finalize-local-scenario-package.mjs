import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const name=process.argv[2];
if(!/^Brevess-[A-Za-z0-9._-]+$/.test(name||'')) throw new Error('INVALID_PACKAGE_NAME');
const target=path.join(root,'dist',name);
assert.ok(fs.existsSync(path.join(target,'manifest.json')));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>
  item.isDirectory()?walk(path.join(dir,item.name),prefix+item.name+'/'):[prefix+item.name]);
const reportRoot=path.join(root,'output/playwright/package-scenarios-r8');
fs.mkdirSync(reportRoot,{recursive:true});
const readme=`# BREVESS 本地安装包 · scenarios r8 · 2026-09-08

本包包含当前项目的新版亮文情境、可编辑类别和划选弹窗，以及 Windows 本机 Codex/PDF 伴随组件。扩展清单版本仍为 1.0.1，构建标识为 ${name}。

先读 [INSTALL.md](INSTALL.md)。已安装的用户应在原扩展目录更新并重新加载；不要卸载旧扩展。包内没有配置你的 API Key，也不包含 Zotero 原文、标注训练集、模型原始响应或浏览器数据。

## 本次更新

- 三个默认阅读情境：快速主线、批判精读、综述阅读。直接显示情境中的类别，取消原有核心/拓展/全部密度选择与 family 分组。
- 设置中可新增、删除、编辑、复制、恢复情境；内置与自定义类别可编辑名称、颜色、定义、正反例、证据槽位与角色。情境作为类别组合，复用同一定义类别的已有结果。
- 划选弹窗同步同一套情境/类别；设置更新后重新划选即可看到变化，历史批注保留原类别快照。
- 原句/否定/证据校验、逐句提示词及缺段续读；只有 LLM 能处理的类别会明确提示，不冒充正则能力。显式重定义内置语义时遵循新配置。

## 验证与已知限制

源码全套 3673/3673、最终缓存等相关检查 51/51 通过。打包后又从本包运行设置 7、划选 9、亮文入口 10 项隔离浏览器检查，零外部/API请求。划选使用网页真实 Selection/Range；无头鼠标拖动未选中文字，未将其算作原生鼠标验收。

前一轮四个最终模型评估运行共 120 次真实 DeepSeek 请求，模型为 deepseek-v4-flash、关闭推理。助手银标的情境补充测试：快速主线 P/R 87.4%/61.9%，批判精读 49.8%/25.6%，综述阅读 60.1%/39.3%。不是人工金标准；每组 12 窗口，36 段中的 16 段因歧义排除。批判/综述细类别尚不能宣称高准确率。

此前暂停的 r7 机制链持久化/恢复故障仍未通过验收，本包不声明解决该问题。没有在你的日常浏览器里执行真实升级；未重新测试所有模型、整篇出版社论文或全部解图链路。

附带完整 [本轮评估报告](docs/2026-09-08-scenario-prompts-and-evaluation.md) 和 PACKAGE_INFO.json 文件清单/哈希。构建后端为本地未签名组件；仅在使用本机 Codex/PDF 功能时需要安装它。
`;
const install=`# r8 本地安装与升级

## 已安装旧版本

1. 先在旧扩展设置里导出“整机迁移”；重要论文再导出文献档案。迁移文件含 API Key，请妥善保管。
2. 在 edge://extensions/（Chrome 为 chrome://extensions/）记录当前扩展 ID 和加载目录。不要点击“移除/卸载”。
3. 等待正在执行的任务结束或取消，备份旧加载目录。把本 ZIP 解压到临时文件夹，将其中完整内容替换进原加载目录，确保 manifest.json 仍直接位于该目录。不要只覆盖少数 JS 文件。
4. 在扩展管理页对原来的 Brevess 点击“重新加载”，再刷新论文网页、重新打开侧栏。
5. 核对原 API 设置、文献笔记、历史批注是否保留。若需导入迁移文件，导入后重新选择本地保存目录。

本包保留固定公钥，开发版预期 ID 为 finhfnjbpidfakpmkghkfjlfcfpoandh。以你扩展管理页的实际 ID 为准。如果旧版来自商店或 ID 不同，不要假设加载新目录就能自动读取旧存储；先做好迁移导出。

## 首次安装

1. 解压 ZIP。
2. 在 edge://extensions/ 或 chrome://extensions/ 开启“开发人员模式”。
3. 点击“加载解压缩的扩展程序”，选择直接包含 manifest.json 的文件夹。
4. 打开论文 HTML 全文页，点击 Brevess 图标。进入亮文，选择阅读情境；LLM 模式需先配置自己的模型/API。

## 使用本机 Codex / PDF 组件

包内 native-host 包含 Windows x64 伴随程序和 PDF 运行时。使用这些功能或原安装路径发生变化时，在新版 native-host 文件夹打开 PowerShell，运行：

\`\`\`powershell
.\\install.ps1 -ExtensionId 你的实际扩展ID
\`\`\`

然后重新加载扩展。登录与“测试连接”步骤见 [CODEX_LOCAL_SETUP.md](CODEX_LOCAL_SETUP.md)；测试连接会发起真实模型请求。仅使用远程 API 的 HTML 亮文功能不需要安装本机组件。

## 新功能入口

亮文 → 阅读情境 → 编辑情境与类别。划选文章文字后的弹窗也可切换情境。旧的自定义组合会保留，不会被升级强行覆盖；需要新版默认组合时，在设置里主动恢复内置情境。

## 回退

保留迁移文件和旧加载目录备份；回退时在同一目录恢复旧版本完整内容并重新加载。若需要恢复数据，使用升级前导出的迁移文件。浏览器本地数据不存放在本 ZIP 里，文件回退不等于数据回退。
`;
fs.writeFileSync(path.join(target,'README.md'),readme);
fs.writeFileSync(path.join(target,'INSTALL.md'),install);
const extraSource=['docs/2026-09-08-scenario-prompts-and-evaluation.md'];
for(const file of extraSource) fs.copyFileSync(path.join(root,file),path.join(target,file));
const packageManifest=JSON.parse(fs.readFileSync(path.join(target,'manifest.json')));
assert.deepEqual(packageManifest,JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))));
assert.equal(packageManifest.manifest_version,3);assert.ok(packageManifest.key);
const keyHash=createHash('sha256').update(Buffer.from(packageManifest.key,'base64')).digest('hex').slice(0,32);
const extensionId=keyHash.replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const rootFiles=['manifest.json','background.js','content.js','content.css','popup.html','popup.js','popup.css',
  'action-popup.html','action-popup.js','action-popup.css','logic-map.html','logic-map.js','logic-map.css',
  'pdf-reader.html','pdf-reader.js', 'pdf-reader-ui.js', 'pdf-reader-notices.js','pdf-reader.css','pdf-native-reader.mjs','offline-reader.html','offline-reader.js','offline-reader.css',
  'options.html','options.js','options.css','options-local-library.js','options-local-library.css',
  'offscreen.html','offscreen.js','offscreen-network-worker.js','LICENSE','THIRD_PARTY_NOTICES.md','OPEN_SOURCE.md','README.md','INSTALL.md','BUILD39_OPTIMIZATION.md','CODEX_LOCAL_SETUP.md'];
const sourceFiles=[...rootFiles,...extraSource];
for(const dir of ['core','providers','vendor','icons','_locales','docs/changelog','native-host/pdffigures2','native-host/runtime']) sourceFiles.push(...walk(path.join(root,dir)).map(f=>dir+'/'+f));
for(const file of ['host.js','install.ps1','login.ps1','uninstall.ps1','catalog-extension-ids.txt',
  'Install-Brevess-Codex-Bridge.cmd','Uninstall-Brevess-Codex-Bridge.cmd','README-STORE.md',
  'bin/brevess-codex-host.exe','runtime-version.json']) sourceFiles.push('native-host/'+file);
const actual=walk(target).filter(f=>f!=='PACKAGE_INFO.json');
assert.deepEqual([...actual].sort(),[...sourceFiles].sort(),'Package file inventory mismatch');
const documentationOverrides=new Set(['README.md','INSTALL.md']);
const files=actual.map(file=>{
  const fileHash=sha(path.join(target,file));
  if(!documentationOverrides.has(file)) assert.equal(fileHash,sha(path.join(root,file)),`Source mismatch: ${file}`);
  if(/\.(?:js|mjs|json|html|css|md|txt)$/i.test(file)) {
    const text=fs.readFileSync(path.join(target,file),'utf8');
    if(/\bsk-[a-zA-Z0-9_-]{20,}\b/.test(text)) throw new Error(`Possible credential in package file: ${file}`);
  }
  return {file,bytes:fs.statSync(path.join(target,file)).size,sha256:fileHash,sourceMatched:!documentationOverrides.has(file)};
});
let referencesChecked=0;
function checkReference(owner,ref) {
  if(!ref || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(ref)) return;
  const clean=decodeURIComponent(ref.split(/[?#]/)[0]); if(!clean) return;
  const resolved=path.resolve(path.dirname(path.join(target,owner)),clean);
  assert.ok(resolved.startsWith(target+path.sep)&&fs.existsSync(resolved),`Missing package resource: ${owner}: ${ref}`);
  referencesChecked++;
}
for(const owner of actual.filter(f=>f.endsWith('.html'))) {
  const html=fs.readFileSync(path.join(target,owner),'utf8');
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) checkReference(owner,match[1]);
}
const background=fs.readFileSync(path.join(target,'background.js'),'utf8');
for(const match of background.matchAll(/importScripts\(([\s\S]*?)\)/g)) for(const ref of match[1].matchAll(/["']([^"']+\.js)["']/g)) checkReference('background.js',ref[1]);
for(const ref of [packageManifest.background.service_worker,packageManifest.action.default_popup,packageManifest.options_ui.page,
  packageManifest.side_panel?.default_path,...Object.values(packageManifest.icons||{})].filter(Boolean)) checkReference('manifest.json',ref);

const nativeState=path.join(root,'tmp','package-r8-native-smoke');fs.mkdirSync(nativeState,{recursive:true});
const child=spawn(path.join(target,'native-host/bin/brevess-codex-host.exe'),['chrome-extension://'+extensionId+'/'],
  {cwd:target,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,LOCALAPPDATA:nativeState,APPDATA:nativeState}});
const nativeMessages=[];let buffer=Buffer.alloc(0);let rejectNative;let timeout;
const nativePromise=new Promise((resolve,reject)=>{
  rejectNative=reject;timeout=setTimeout(()=>reject(new Error('Native package smoke timeout')),20000);
  child.on('error',reject);child.stdout.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){
      const size=buffer.readUInt32LE(0);const message=JSON.parse(buffer.subarray(4,size+4));buffer=buffer.subarray(size+4);
      nativeMessages.push(message);if(nativeMessages.length===2)resolve();
    }
  });
});
child.stderr.on('data',()=>{});
for(const message of [{type:'package.protocol.probe',requestId:'protocol'},{type:'pdf.figure.health',requestId:'pdf'}]) {
  const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([header,body]));
}
try{await nativePromise;}finally{clearTimeout(timeout);child.stdin.end();child.kill();}
assert.equal(nativeMessages.find(m=>m.requestId==='protocol')?.error?.code,'INVALID_SETTINGS');
const pdf=nativeMessages.find(m=>m.requestId==='pdf');assert.equal(pdf?.available,true);assert.equal(pdf?.crossPageRecoveryAvailable,true);
const browserReports={};
for(const name of ['reading','settings','selection']) {
  const report=JSON.parse(fs.readFileSync(path.join(reportRoot,name,'report.json')));
  assert.equal(report.status,'PASS');assert.equal(report.externalRequests,0);
  browserReports[name]={status:report.status,checks:report.checks.length,externalRequests:report.externalRequests,
    selectionMethod:report.selection?.initialMethod||null};
}
const info={build:name,version:packageManifest.version,builtAt:new Date().toISOString(),extensionId,
  sourceBaseCommit:'a932d14a96359a7d0170483c3d3e05ffbbe1251d',workingTreeChangesIncluded:true,
  verification:{status:'PASS',sourceMatchedFiles:files.filter(f=>f.sourceMatched).length,
    documentationOverrides:[...documentationOverrides],referencesChecked,browserReports,
    nativeProtocol:'PASS',pdfRuntimeAvailable:pdf.available,pdfCrossPageRecoveryAvailable:pdf.crossPageRecoveryAvailable,
    nativeModelCallPerformed:false,newApiRequests:0},files};
fs.writeFileSync(path.join(target,'PACKAGE_INFO.json'),JSON.stringify(info,null,2));
fs.writeFileSync(path.join(reportRoot,'package-integrity.json'),JSON.stringify(info,null,2));
console.log(JSON.stringify({status:'PASS',build:name,files:files.length,sourceMatchedFiles:info.verification.sourceMatchedFiles,referencesChecked,extensionId,nativeProtocol:'PASS',pdfRuntimeAvailable:true,browserReports}));
