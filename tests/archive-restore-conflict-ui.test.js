const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
function fn(name, deps = {}) {
  let start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  return Function(...Object.keys(deps), `return (${source.slice(start, next < 0 ? source.length : start + 1 + next).trim()});`)(...Object.values(deps));
}

test('ARCH-009 conflicting local copy has an actionable Chinese explanation from structured error code',()=>{
 const describe=fn('describeArticleWorkspaceRestoreError');
 const error=Object.assign(new Error('Directory and local assets differ'),{code:'ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT'});
 const text=describe(error);assert.match(text,/本机.*目录.*不同/);assert.match(text,/保留/);assert.match(text,/停止.*恢复/);
});
for(const code of ['ARTICLE_WORKSPACE_RESTORE_LOCAL_CONFLICT','WORKSPACE_STORE_UNAVAILABLE'])test(`ARCH-009 ${code} stops before applying or falling back to an archive`,async()=>{
 const calls=[];const describe=fn('describeArticleWorkspaceRestoreError');
 const load=fn('loadArticleArchiveForContext',{
  currentArticleArchiveIdentity:()=>({documentId:'doc:paper'}),isCurrentPanelContext:()=>true,
  currentArticleArchiveProbe:{found:true,figureCount:14},setArticleArchivePrompt:value=>calls.push(value),
  restoreCurrentArticleWorkspaceFromDirectory:async()=>{throw Object.assign(new Error('Restore refused'),{code});},
  sendLlmMessage:()=>{throw Error('must not load older fallback');},
  applyLoadedArticleArchive:()=>{throw Error('must not apply older values');},
  describeArticleWorkspaceRestoreError:describe,showStatus:(message,type)=>calls.push({message,type})
 });
 await load({panelContext:{tabId:4},permissionTicket:null});
 assert.equal(calls.at(-2).restoreState,'failed');assert.equal(calls.at(-1).type,'error');assert.match(calls.at(-1).message,new RegExp(code));
});
