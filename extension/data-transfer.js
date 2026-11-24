(() => {
  'use strict';
  const $=id=>document.getElementById(id),C=BrevessLocalSnapshot,B=BrevessLocalSnapshotBrowser;
  let snapshot=null,busy=false;
  const status=(message,error=false)=>{$('status').textContent=message;$('status').dataset.error=String(error);};
  const messages={SNAPSHOT_TARGET_CONFLICT:'目标已有不同内容。原数据保持，请使用空白目标，或先单独备份并核对现有资料。',SNAPSHOT_DATABASE_VERSION_CONFLICT:'目标数据库版本不同；为防止不安全降级，本次未恢复。',SNAPSHOT_UNSUPPORTED_TYPE:'存在尚未支持的数据对象，本次没有生成不完整备份。请保留原安装与完整保存目录，并记录此错误。',SNAPSHOT_RECOVERY_PENDING:'存在另一份备份的未完成恢复。请先选回原备份处理。',SNAPSHOT_RECOVERY_RESUME_REQUIRED:'恢复已进入配置写入阶段，请用同一备份继续完成；不会撤除可能已编辑的配置。',SNAPSHOT_SOURCE_CHANGED_CLOSE_OTHER_WINDOWS:'读取期间数据发生变化。请关闭其他扩展页面和任务后重新备份。',SNAPSHOT_DECRYPT_FAILED:'口令不正确或备份已损坏；未写入用户库。'};
  Object.assign(messages,{SNAPSHOT_NEWER_DATABASE_UNSUPPORTED:'备份包含此版本不能读取的较新数据库；请使用对应新版应用，尚未写入目标。',SNAPSHOT_RECORD_KEY_INVALID:'备份记录的主键不一致或不受支持；尚未写入目标。',SNAPSHOT_BROWSER_SYNC_CONSENT_REQUIRED:'备份包含浏览器同步设置。请先阅读并单独选择同步授权；本次未写入目标。'});
  async function isolated(){
    if(!globalThis.chrome?.runtime?.id||!chrome.runtime.getContexts)throw Error('请从扩展设置打开此页；此浏览器需要支持扩展上下文检查。');
    const contexts=await chrome.runtime.getContexts({contextTypes:['TAB','POPUP','SIDE_PANEL','OFFSCREEN_DOCUMENT']});
    if(contexts.length!==1||contexts[0].documentUrl!==location.href)throw Error('请先关闭其他 BREVESS 阅读、设置、工作台与侧栏页面，再继续。');
  }
  const adapter=()=>B.createBrowserAdapter();
  function buttons(){for(const id of ['export','inspect'])$(id).disabled=busy;$('restore').disabled=busy||!snapshot||!$('confirm-destination').checked;$('rollback').disabled=busy||!snapshot||!$('confirm-destination').checked;}
  async function run(fn){if(busy)return;busy=true;buttons();try{await fn();}catch(e){status((messages[e.code||e.message]||e.message||'操作未完成')+'\n'+(e.code||''),true);}finally{busy=false;buttons();}}
  const invalidate=()=>{snapshot=null;$('summary').textContent='';$('confirm-destination').checked=false;buttons();};
  $('import-file').addEventListener('change',invalidate);$('import-passphrase').addEventListener('input',invalidate);$('confirm-destination').addEventListener('change',buttons);
  $('export').onclick=()=>run(async()=>{
    if($('export-passphrase').value.length<12||$('export-passphrase').value!==$('export-confirm').value)throw Error('请填写至少 12 个字符且两次一致的口令。');
    await isolated();status('正在读取与核对浏览器数据…');
    const data=await adapter().exportSnapshot(),sealed=await C.encrypt(data,$('export-passphrase').value);
    const blob=new Blob([JSON.stringify(sealed)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='Brevess-browser-'+new Date().toISOString().replace(/[:.]/g,'-')+'.brvlocal';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('export-passphrase').value='';$('export-confirm').value='';status('已生成加密浏览器备份。请确认下载完成，并另行保存外部目录副本。目录授权需在目标浏览器重新建立。');
  });
  $('inspect').onclick=()=>run(async()=>{
    invalidate();const file=$('import-file').files[0];if(!file)throw Error('请先选择备份文件。');
    status('正在验证口令、文件格式与附件哈希…');snapshot=await C.decrypt(JSON.parse(await file.text()),$('import-passphrase').value);
    const data=await C.read(snapshot),count=data.databases.reduce((n,d)=>n+d.stores.reduce((m,s)=>m+s.entries.length,0),0);
    $('summary').textContent=`文件已核验：${data.databases.length} 个数据库，${count} 条记录。导出于 ${snapshot.createdAt}。此统计不是无损恢复结论；恢复后还会逐值读回核对。`;
    status('检查完成；尚未写入目标。请核对外部目录副本和当前目标。');
  });
  $('restore').onclick=()=>run(async()=>{
    if(!snapshot||!$('confirm-destination').checked)return;await isolated();status('正在恢复；请保持此页打开。');
    await adapter().restore(snapshot,{allowBrowserSync:$('allow-browser-sync').checked});status('研究资料和恢复后的配置已逐值读回一致。旧 MCP 配对配置已作为历史记录保留，未自动启用。请重新授权保存目录、重新配对 MCP，并从正常入口核对文献、附件、笔记和工作台。');
  });
  $('rollback').onclick=()=>run(async()=>{
    if(!snapshot||!$('confirm-destination').checked)return;await isolated();status('正在核对本次未完成写入…');await adapter().rollback(snapshot);status('已撤回本次尚未完成且内容未被修改的数据库新增记录；空库结构保留。');
  });
})();
