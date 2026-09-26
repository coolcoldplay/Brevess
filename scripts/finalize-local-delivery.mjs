import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {releaseInventory} from './release-inventory.mjs';
import {checkLocalReferences,findCredentialPattern,deriveExtensionId} from './finalize-local-pdf-package.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write=(p,v)=>fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n','utf8');
function git(root,args){const r=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false',...args],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:30*1024*1024});if(r.status!==0)throw new Error('SOURCE_PROVENANCE_GIT_FAILED');return r.stdout;}
function filesUnder(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const rel=prefix+e.name,p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('STAGING_LINK');return e.isDirectory()?filesUnder(p,rel+'/'):[rel];}).sort();}

function checkedPath(root,target){
 root=path.resolve(root);target=path.resolve(target);
 const rel=path.relative(root,target);
 if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('ISOLATED_NATIVE_PATH');
 let current=root;
 for(const part of ['',...rel.split(path.sep)]){
  if(part)current=path.join(current,part);
  if(fs.lstatSync(current).isSymbolicLink())throw new Error('ISOLATED_NATIVE_LINK');
 }
 return target;
}
function readBoundedJson(file){if(!fs.statSync(file).isFile()||fs.statSync(file).size>1024*1024)throw new Error('ISOLATED_NATIVE_MANIFEST_INVALID');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/u,''));}
function deliveryRoot(root,releaseRoot,buildName){
 if(!/^Brevess-[A-Za-z0-9._-]+$/.test(buildName)||path.dirname(releaseRoot)!==path.join(root,'dist')||path.basename(releaseRoot)!==buildName)throw new Error('INVALID_DELIVERY_ROOT');
}
export function validateIsolatedNativeBuild({root=ROOT,manifestPath}){
 root=path.resolve(root);
 if(typeof manifestPath!=='string'||!manifestPath)throw new Error('ISOLATED_NATIVE_MANIFEST_REQUIRED');
 manifestPath=checkedPath(path.join(root,'output'),path.resolve(root,manifestPath));
 if(path.basename(manifestPath)!=='build-manifest.json')throw new Error('ISOLATED_NATIVE_MANIFEST_INVALID');
 const directory=path.dirname(manifestPath), manifest=readBoundedJson(manifestPath);
 for(const key of ['sourceSha256','configSha256','exeSha256','blobSha256','nodeSha256'])if(!/^[a-f0-9]{64}$/.test(manifest[key]||''))throw new Error('ISOLATED_NATIVE_MANIFEST_INVALID');
 if(!Number.isSafeInteger(manifest.exeBytes)||manifest.exeBytes<=0||!/^v\d+\.\d+\.\d+/.test(manifest.nodeVersion||'')||
    typeof manifest.postjectVersion!=='string'||!manifest.postjectVersion||!Number.isFinite(Date.parse(manifest.builtAt))||
    manifest.installed!==false||manifest.registered!==false||manifest.published!==false)throw new Error('ISOLATED_NATIVE_MANIFEST_INVALID');
 const artifact=name=>checkedPath(root,path.join(directory,name));
 const sourcePath=artifact('host.js'),configPath=artifact('sea-config.json'),executablePath=artifact('brevess-codex-host.exe'),blobPath=artifact('brevess-codex-host.blob');
 const currentSource=checkedPath(root,path.join(root,'native-host/host.js')),currentConfig=checkedPath(root,path.join(root,'native-host/sea-config.json'));
 if(sha(currentSource)!==manifest.sourceSha256||sha(sourcePath)!==manifest.sourceSha256)throw new Error('ISOLATED_NATIVE_SOURCE_CHANGED');
 if(sha(configPath)!==manifest.configSha256||sha(executablePath)!==manifest.exeSha256||sha(blobPath)!==manifest.blobSha256||fs.statSync(executablePath).size!==manifest.exeBytes)throw new Error('ISOLATED_NATIVE_ARTIFACT_CHANGED');
 const sourceConfig=readBoundedJson(currentConfig);
 if(sourceConfig.main!=='native-host/host.js'||sourceConfig.output!=='native-host/bin/brevess-codex-host.blob')throw new Error('ISOLATED_NATIVE_CONFIG_CHANGED');
 const expectedConfig={...sourceConfig,main:sourcePath,output:blobPath};
 if(!isDeepStrictEqual(readBoundedJson(configPath),expectedConfig))throw new Error('ISOLATED_NATIVE_CONFIG_CHANGED');
 const protocolReportPath=artifact('native-protocol-report-system-root.json'),protocol=readBoundedJson(protocolReportPath);
 if(protocol.status!=='PASS'||protocol.actualExecutableProtocol!==true||protocol.exeSha256!==manifest.exeSha256||
    protocol.networkRequests!==0||protocol.modelCalls!==0||protocol.installed!==false||protocol.registered!==false||
    !Array.isArray(protocol.checks)||!protocol.checks.length||protocol.checks.some(check=>check.passed!==true)||
    protocol.newProcess?.exit?.code!==0)throw new Error('ISOLATED_NATIVE_VERIFICATION_INVALID');
 const relative=file=>path.relative(root,file).split(path.sep).join('/');
 return {executablePath,manifestPath,provenance:{manifest:relative(manifestPath),manifestSha256:sha(manifestPath),
  source:relative(sourcePath),sourceSha256:manifest.sourceSha256,sourceSeaConfigSha256:sha(currentConfig),
  config:relative(configPath),configSha256:manifest.configSha256,executable:relative(executablePath),exeSha256:manifest.exeSha256,
  blob:relative(blobPath),blobSha256:manifest.blobSha256,protocolReport:relative(protocolReportPath),protocolReportSha256:sha(protocolReportPath),
  builtAt:manifest.builtAt,nodeVersion:manifest.nodeVersion,nodeExecutableSha256:manifest.nodeSha256,postjectVersion:manifest.postjectVersion,
  verificationScope:'Isolated executable protocol checks; packaged regression and Explorer success remain separate'}};
}
export function stageIsolatedNativeBuild({root=ROOT,releaseRoot,buildName,manifestPath}){
 root=path.resolve(root);releaseRoot=path.resolve(releaseRoot);deliveryRoot(root,releaseRoot,buildName);
 const selected=validateIsolatedNativeBuild({root,manifestPath});
 checkedPath(root,releaseRoot);
 for(const file of ['release-manifest.json','browser-extension/PACKAGE_INFO.json','native-companion/COMPONENT_INFO.json'])if(fs.existsSync(path.join(releaseRoot,file)))throw new Error('ISOLATED_NATIVE_STAGE_NOT_FRESH');
 const target=checkedPath(root,path.join(releaseRoot,'native-companion/bin/brevess-codex-host.exe'));
 if(fs.statSync(target).nlink!==1)throw new Error('ISOLATED_NATIVE_STAGE_LINK');
 if(sha(target)!==sha(checkedPath(root,path.join(root,'native-host/bin/brevess-codex-host.exe'))))throw new Error('ISOLATED_NATIVE_STAGE_NOT_FRESH');
 fs.copyFileSync(selected.executablePath,target);
 if(sha(target)!==selected.provenance.exeSha256)throw new Error('ISOLATED_NATIVE_STAGE_COPY_FAILED');
 return selected;
}
function deliverySource(root,entry,isolated){return isolated&&entry.source==='native-host/bin/brevess-codex-host.exe'?isolated.executablePath:path.join(root,entry.source);}
function deliveryRecords(root,dir,list,isolated){return list.map(e=>{
 const source=deliverySource(root,e,isolated),sourceSha256=sha(source),stagedSha256=sha(path.join(dir,e.path));
 return {file:e.path,bytes:fs.statSync(path.join(dir,e.path)).size,sha256:stagedSha256,source:e.source,
  ...(source!==path.join(root,e.source)?{sourcePath:path.relative(root,source).split(path.sep).join('/'),repositorySourceSha256:sha(path.join(root,e.source))}:{}),
  sourceSha256,sourceMatched:stagedSha256===sourceSha256};
 });}
export function validateDeliveryStage({root=ROOT,releaseRoot,specs,isolatedNativeBuild=null}){
 const records={};
 for(const [profile,entries]of Object.entries(specs)){
  const dir=path.join(releaseRoot,profile==='browser'?'browser-extension':'native-companion');
  checkedPath(root,dir);
  if(JSON.stringify(filesUnder(dir))!==JSON.stringify(entries.map(e=>e.path).sort()))throw new Error(`STAGE_INVENTORY_MISMATCH:${profile}`);
  records[profile]=deliveryRecords(root,dir,entries,isolatedNativeBuild);
  for(const entry of records[profile])if(!entry.sourceMatched)throw new Error(`STAGE_SOURCE_MISMATCH:${entry.file}`);
 }
 return records;
}

export function finalizeLocalDelivery({root=ROOT,releaseRoot,buildName,nativeBuildMode='verified-prebuilt',componentChangeReason='',isolatedNativeBuildManifest=''}){
 root=path.resolve(root);releaseRoot=path.resolve(releaseRoot);
 deliveryRoot(root,releaseRoot,buildName);
 if(!['verified-prebuilt','rebuilt','verified-isolated'].includes(nativeBuildMode)||
    Boolean(isolatedNativeBuildManifest)!==(nativeBuildMode==='verified-isolated')||
    (nativeBuildMode==='verified-isolated'&&!componentChangeReason.trim()))throw new Error('INVALID_NATIVE_BUILD_OPTIONS');
 const browser=path.join(releaseRoot,'browser-extension'),companion=path.join(releaseRoot,'native-companion');
 const specs={browser:releaseInventory(root,'browser'),companion:releaseInventory(root,'companion')};
 const isolated=nativeBuildMode==='verified-isolated'?stageIsolatedNativeBuild({root,releaseRoot,buildName,manifestPath:isolatedNativeBuildManifest}):null;
 validateDeliveryStage({root,releaseRoot,specs,isolatedNativeBuild:isolated});
 const manifest=JSON.parse(fs.readFileSync(path.join(browser,'manifest.json'),'utf8'));
 const extensionId=deriveExtensionId(manifest.key);
 if(extensionId!=='finhfnjbpidfakpmkghkfjlfcfpoandh')throw new Error('LOCAL_EXTENSION_ID_CHANGED');
 if(manifest.content_security_policy?.extension_pages!=="script-src 'self' 'wasm-unsafe-eval'; object-src 'self'")throw new Error('PDF_WASM_CSP_CHANGED');
 const readme=`# Brevess ${buildName}\n\n这是工程维护版本，扩展清单仍为 ${manifest.version}，固定扩展 ID 为 ${extensionId}。\n\n浏览器扩展包含网页/PDF阅读、高亮、J语义查找、问答、图解与笔记界面。模型功能沿用你的设置；本包没有API密钥、个人浏览器数据或私有论文。\n\n本次修复范围及逐项已测/未测证据见交付目录的 ACCEPTANCE.md；构建成功本身不代表全部功能已验收。\n\n基本PDF阅读使用包内PDF.js资源。增强PDF图解提取和Local Codex需要本地伴侣：离线的 native-companion / Windows伴侣ZIP 与本包一起提供；完整ZIP还将其放在 native-host。未自动联网下载、安装或注册组件。\n\n见 INSTALL.md。升级前在旧扩展导出必要资料；不要卸载旧扩展。\n`;
 const install=`# 安装与回退\n\n已有用户：保留原扩展ID和数据，先从旧扩展导出整机迁移及重要论文档案。迁移包可能含密钥，妥善保管。等任务结束后，将新浏览器扩展的完整内容替换到原加载目录并在扩展管理页重新加载；不卸载旧扩展，不只覆盖几个JS文件。本次工具未替你执行升级。\n\n首次使用：解压浏览器ZIP，加载直接含manifest.json的目录；或使用完整ZIP。两个版本的浏览器代码和固定身份相同。\n\n本地伴侣：如需增强PDF提取/Local Codex，在随附的 native-companion（或完整包native-host）目录运行 install.ps1 -ExtensionId 你的实际扩展ID。安装器将运行时复制到用户本地应用数据目录；已安装且版本一致的伴侣可以继续使用。没有设置默认模型请求，也没有自动安装。\n\n回退：保留的r15及迁移备份是恢复基线。在同一扩展目录恢复旧版完整文件后重新加载；文件回退不等于用户数据回退。\n`;
 write(path.join(browser,'README.md'),readme);write(path.join(browser,'INSTALL.md'),install);
 for(const [profile,entries]of Object.entries(specs)){
  const dir=profile==='browser'?browser:companion;
  for(const e of entries)if(/\.(?:js|mjs|json|html|css|md|txt|ps1|cmd)$/i.test(e.path)){
   const finding=findCredentialPattern(fs.readFileSync(path.join(dir,e.path),'utf8'));if(finding)throw new Error(`POSSIBLE_CREDENTIAL:${finding}:${e.path}`);
  }
 }
 const referencesChecked=checkLocalReferences(browser,specs.browser.map(e=>e.path));
 const provenance={head:git(root,['rev-parse','HEAD']).trim(),branch:git(root,['symbolic-ref','--short','HEAD']).trim(),workingTreeStatusSha256:crypto.createHash('sha256').update(git(root,['status','--porcelain=v1','-z','--untracked-files=all'])).digest('hex'),lockfileSha256:sha(path.join(root,'package-lock.json')),inventorySha256:sha(path.join(root,'scripts/release-inventory.json')),nodeVersion:process.version,nodeExecutableSha256:sha(process.execPath),nativeBuildMode,...(isolated?{isolatedNativeBuild:isolated.provenance}:{})};
 const records=(dir,list)=>deliveryRecords(root,dir,list,isolated);
  const browserFiles=records(browser,specs.browser),nativeFiles=records(companion,specs.companion);
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'scripts/release-component-baseline.json'),'utf8'));
 const bySource=new Map([...browserFiles,...nativeFiles].map(f=>[f.source,f]));
 const componentChanges=baseline.components.map(c=>{
  const prior=new Map(c.files.map(f=>[f.file,f]));
  const current=[...bySource.values()].filter(f=>f.source.startsWith(c.component+'/'));
  const changed=current.filter(f=>prior.get(f.source)?.sha256!==f.sourceSha256).map(f=>f.source);
  const missing=c.files.filter(f=>!bySource.has(f.file)).map(f=>f.file);
  const actualBytes=current.reduce((n,f)=>n+f.bytes,0);
  return {component:c.component,baselineBytes:c.bytes,actualBytes,deltaBytes:actualBytes-c.bytes,changed,missing};
 });
 const dependencyChange=componentChanges.some(c=>c.changed.length||c.missing.length);
 if(nativeBuildMode==='verified-prebuilt'&&componentChanges.some(c=>c.component==='native-host'&&
   [...c.changed,...c.missing].some(f=>['native-host/host.js','native-host/bin/brevess-codex-host.exe'].includes(f)))) {
  throw new Error('PREBUILT_NATIVE_SOURCE_CHANGED: rebuild and verify the companion before delivery');
 }
 if(dependencyChange&&!componentChangeReason.trim())throw new Error('DEPENDENCY_COMPONENT_CHANGED: explicit review reason required; see release-component-baseline.json');
 const shared={schemaVersion:1,build:buildName,version:manifest.version,builtAt:new Date().toISOString(),extensionId,source:provenance,verification:{status:'BUILD_VALIDATED',scope:'Source/resource checks at build time; functional acceptance is recorded alongside the immutable ZIPs in ACCEPTANCE.md and release-manifest.json',resourceReferencesChecked:referencesChecked,realApiCalls:0,installed:false,published:false}};
 write(path.join(browser,'PACKAGE_INFO.json'),{...shared,variant:'browser',companionDelivery:'Separate offline companion or full package; no automatic download',files:browserFiles});
 write(path.join(companion,'COMPONENT_INFO.json'),{...shared,variant:'windows-companion',nativeHostId:'com.sci_reader.codex_bridge',runtime:JSON.parse(fs.readFileSync(path.join(companion,'runtime-version.json'))),pdfFigures:JSON.parse(fs.readFileSync(path.join(companion,'pdffigures2/VERSION.json'))),files:nativeFiles});
 const fullEntries=[...filesUnder(browser).filter(f=>f!=='PACKAGE_INFO.json').map(f=>({file:f,source:path.join(browser,f)})),...filesUnder(companion).map(f=>({file:'native-host/'+f,source:path.join(companion,f)}))];
 const fullInfo={...shared,variant:'full',files:fullEntries.map(e=>({file:e.file,bytes:fs.statSync(e.source).size,sha256:sha(e.source)}))};
 const fullInfoPath=path.join(releaseRoot,'full-PACKAGE_INFO.json');write(fullInfoPath,fullInfo);
 fullEntries.push({file:'PACKAGE_INFO.json',source:fullInfoPath});
 write(path.join(releaseRoot,'full-archive-inputs.json'),fullEntries);
 const components=[{component:'browser',bytes:browserFiles.reduce((n,f)=>n+f.bytes,0)},{component:'native-companion',bytes:nativeFiles.reduce((n,f)=>n+f.bytes,0)}];
 const artifacts={...shared,components,retention:{policy:'Keep current accepted version and rollback baseline; retire only explicit, restore-verified IDs; no automatic worktree/user-data deletion',noOverwritingBuilds:true},growthReview:{baseline:baseline.baseline,policy:baseline.policy,unchangedDependenciesRetained:!dependencyChange,componentChangeReason,components:componentChanges},artifacts:[]};
 artifacts.verification={...shared.verification,status:'AWAITING_PACKAGED_REGRESSION'};
 write(path.join(releaseRoot,'release-manifest.json'),artifacts);
 write(path.join(releaseRoot,'README.md'),`# ${buildName}\n\n- browser-extension / 浏览器ZIP：加载这里的manifest.json；保持原ID。\n- native-companion / Windows伴侣ZIP：离线增强PDF与Local Codex组件。\n- 完整ZIP：两者组合，伴侣位于native-host。\n\n浏览器模块与伴侣分开交付不代表减少了完整离线功能所需的总运行时。未自动安装或调用模型。最终验收结果见 ACCEPTANCE.md。\n`);
 return {buildName,releaseRoot,components,referencesChecked,extensionId};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='--verify-isolated-native'){
  if(args.length!==2)throw new Error('INVALID_NATIVE_BUILD_OPTIONS');
  console.log(JSON.stringify(validateIsolatedNativeBuild({manifestPath:args[1]}).provenance));
 }else{
  if(args.length<2||args.length>5)throw new Error('INVALID_NATIVE_BUILD_OPTIONS');
  const [releaseRoot,buildName,nativeBuildMode,componentChangeReason,isolatedNativeBuildManifest]=args;
  console.log(JSON.stringify(finalizeLocalDelivery({releaseRoot,buildName,nativeBuildMode,componentChangeReason,isolatedNativeBuildManifest})));
 }
}
