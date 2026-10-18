const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
let inventory;
test.before(async()=>{inventory=await import('../scripts/release-inventory.mjs');});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-inventory-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const spec={browserRootFiles:['manifest.json'],browserDirectories:['core','vendor'],localDocumentationFiles:['LICENSE'],localDocumentationDirectories:[],nativeHostFiles:['native-host/install.ps1'],nativeHostDirectories:['native-host/runtime']};
 for(const file of ['manifest.json','core/main.js','vendor/font.bcmap','LICENSE','native-host/install.ps1','native-host/runtime/java.exe']){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'fixture');}
 return {root,spec};
}
test('browser-only retains local documentation and PDF assets without native runtime; full retains it',t=>{
 const {root,spec}=fixture(t);
 assert.deepEqual(inventory.releaseInventory(root,'browser',spec).map(x=>x.path),['LICENSE','core/main.js','manifest.json','vendor/font.bcmap']);
 assert.ok(inventory.releaseInventory(root,'full',spec).some(x=>x.path==='native-host/runtime/java.exe'));
 assert.deepEqual(inventory.releaseInventory(root,'companion',spec).map(x=>x.path),['install.ps1','runtime/java.exe']);
});
test('development artifacts and nested output in an otherwise allowed runtime directory fail closed',t=>{
 const {root,spec}=fixture(t);
 for(const file of ['vendor/old.zip','vendor/output/trace.json','core/debug.test.js','core/.env']){
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'must not ship');
  assert.throws(()=>inventory.releaseInventory(root,'full',spec),/FORBIDDEN_RELEASE_PATH/);
  fs.unlinkSync(path.join(root,file));
  if(file.includes('/output/'))fs.rmdirSync(path.join(root,'vendor/output'));
 }
});
test('source traversal and missing required files stop staging',t=>{
 const {root,spec}=fixture(t);
 assert.throws(()=>inventory.releaseInventory(root,'browser',{...spec,browserRootFiles:['../private.json']}),/INVALID_RELEASE_PATH/);
 fs.unlinkSync(path.join(root,'manifest.json'));
 assert.throws(()=>inventory.releaseInventory(root,'browser',spec),/ENOENT/);
});
test('private payment QR assets are never included',t=>{
 const {root,spec}=fixture(t);
 fs.mkdirSync(path.join(root,'icons/about'),{recursive:true});
 fs.writeFileSync(path.join(root,'icons/about/wechat-support-original.png'),'private');
 fs.writeFileSync(path.join(root,'icons/about/alipay-support-original.png'),'private');
 fs.writeFileSync(path.join(root,'icons/about/wechat-mark.svg'),'public');
 const files=inventory.releaseInventory(root,'browser',{...spec,browserDirectories:['icons']}).map(x=>x.path);
 assert.deepEqual(files,['LICENSE','icons/about/wechat-mark.svg','manifest.json']);
});
test('common release inventory includes all application entry points and licenses',()=>{
 const root=path.join(__dirname,'..'),files=inventory.releaseInventory(root,'browser').map(x=>x.path);
 for(const file of ['manifest.json','background.js','action-popup.html','popup.html','options.html','offscreen.html','pdf-reader.html','pdf-native-reader.mjs','semantic-find-controller.js','ui-swiss.css','LICENSE','THIRD_PARTY_NOTICES.md','vendor/pdfjs/build/pdf.worker.min.mjs'])assert.ok(files.includes(file),file);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 assert.ok(files.includes(manifest.background.service_worker));
 for(const entry of [manifest.action.default_popup,manifest.options_ui.page,manifest.side_panel.default_path])assert.ok(files.includes(entry));
});
