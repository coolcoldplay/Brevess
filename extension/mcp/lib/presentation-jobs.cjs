'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {agents: agentNames, questionSet, answersFor} = require('../../core/article-presentation.js');
const ids = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const agents = new Set(Object.keys(agentNames));
const maxFile = 96 * 1024 * 1024;
const maxAge = 7 * 86400000;
const filename = 'presentation.pptx';
function error(code) { return Object.assign(new Error(code), {code}); }
function defaultRoot() {
  const base = process.platform === 'darwin' ? path.join(os.homedir(),'Library','Application Support') :
    process.platform === 'win32' ? process.env.LOCALAPPDATA || os.homedir() : process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local','share');
  return path.join(base,'BREVESS','presentation-jobs');
}
async function atomic(file, value) {
  const tmp = file+'.'+crypto.randomUUID()+'.tmp';
  try { await fsp.writeFile(tmp,value,{mode:0o600,flag:'wx'}); await fsp.rename(tmp,file); }
  catch (failure) {
    if (failure.code !== 'EEXIST') await fsp.rm(tmp,{force:true}).catch(()=>{});
    throw failure;
  }
}
async function regular(file, limit) {
  const fh = await fsp.open(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const s=await fh.stat(); if(!s.isFile() || s.nlink!==1 || s.size>limit) throw error('PPT_FILE_INVALID');
    return await fh.readFile(); } finally { await fh.close(); }
}
// Check the central directory and the actual presentation parts before advertising a download.
function verifyDeck(buf) {
  if(buf.length<64 || buf.length>maxFile || buf.readUInt32LE(0)!==0x04034b50) throw error('PPT_FILE_INVALID');
  let end=buf.length-22;
  for(;end>=Math.max(0,buf.length-65557);end--) if(buf.readUInt32LE(end)===0x06054b50 && end+22+buf.readUInt16LE(end+20)===buf.length) break;
  if(end<Math.max(0,buf.length-65557)) throw error('PPT_FILE_INVALID');
  const names=new Map();let p=buf.readUInt32LE(end+16); const count=buf.readUInt16LE(end+10);
  if(count>10000 || buf.readUInt32LE(end+12)!==end-p) throw error('PPT_FILE_INVALID');
  for(let i=0;i<count;i++){
    if(p+46>end || buf.readUInt32LE(p)!==0x02014b50) throw error('PPT_FILE_INVALID');
    const len=buf.readUInt16LE(p+28), name=buf.toString('utf8',p+46,p+46+len);
    if(names.has(name) || /(?:^|\/)\.\.(?:\/|$)|^\/|\\|vbaProject\.bin$/i.test(name)) throw error('PPT_FILE_INVALID');
    names.set(name,{offset:buf.readUInt32LE(p+42),length:buf.readUInt32LE(p+20),method:buf.readUInt16LE(p+10)});
    p+=46+len+buf.readUInt16LE(p+30)+buf.readUInt16LE(p+32);
  }
  function xml(name){
    const x=names.get(name); if(!x || x.offset+30>end || buf.readUInt32LE(x.offset)!==0x04034b50) throw error('PPT_FILE_INVALID');
    const start=x.offset+30+buf.readUInt16LE(x.offset+26)+buf.readUInt16LE(x.offset+28);
    if(x.length>4*1024*1024 || start+x.length>end) throw error('PPT_FILE_INVALID');
    const bytes=buf.subarray(start,start+x.length);
    if(x.method===8)return zlib.inflateRawSync(bytes,{maxOutputLength:8*1024*1024}).toString();
    if(x.method===0)return bytes.toString();
    throw error('PPT_FILE_INVALID');
  }
  const slides=[...names.keys()].filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));
  if(p!==end || !slides.length || !xml('[Content_Types].xml').includes('presentationml.presentation.main+xml') ||
     !xml('ppt/presentation.xml').includes('sldIdLst') || !names.has('ppt/_rels/presentation.xml.rels') ||
     !/<(?:[\w]+:)?sld[\s>]/.test(xml(slides[0]))) throw error('PPT_FILE_INVALID');
  return {slides:slides.length,bytes:buf.length,sha256:crypto.createHash('sha256').update(buf).digest('hex')};
}
function createStore(root=defaultRoot()){
  const folder=id=>{if(!ids.test(id))throw error('PPT_JOB_INVALID');return path.join(root,id);};
  const file=(id,name)=>path.join(folder(id),name);
  const read=async(id)=>JSON.parse((await regular(file(id,'job.json'),8192)).toString());
  const save=r=>atomic(file(r.id,'job.json'),JSON.stringify(r));
  async function resolved(id,agent){const r=await read(id);if(agent && r.agent!==agent)throw error('PPT_JOB_NOT_FOUND');return r;}
  async function questions(id) {
    try {return JSON.parse(await regular(file(id,'questions.json'),256*1024));}
    catch (e) {if (e.code === 'ENOENT') return []; throw e;}
  }
  async function saveQuestions(id, rows) {
    const json = JSON.stringify(rows);
    if (rows.length > 32 || Buffer.byteLength(json) > 256*1024) throw error('AGENT_QUESTION_LIMIT');
    await atomic(file(id,'questions.json'),json);
  }
  async function list(agent){
    if(!agents.has(agent))throw error('PPT_AGENT_REQUIRED');await fsp.mkdir(root,{recursive:true,mode:0o700});
    const found=[];
    for(const d of await fsp.readdir(root,{withFileTypes:true})){
      if(!d.isDirectory()||!ids.test(d.name))continue;
      try {const r=await read(d.name);if(Date.now()-r.updated>maxAge){await fsp.rm(folder(r.id),{recursive:true,force:true});continue;}
        if(r.kind!=='live' && r.agent===agent && ['pending','working'].includes(r.state))found.push(r); }catch{}
    }
    return found.sort((a,b)=>a.updated-b.updated);
  }
  async function open({id,agent,documentHash,instructions,materials,kind='ppt'}){
    if(!['ppt','chat'].includes(kind))throw error('PPT_JOB_INVALID');
    if(!agents.has(agent)||typeof documentHash!=='string'||!documentHash||documentHash.length>160)throw error('PPT_JOB_INVALID');
    const payload=JSON.stringify(materials);if(typeof instructions!=='string'||Buffer.byteLength(instructions)>128000||!payload||Buffer.byteLength(payload)>8*1024*1024)throw error('PPT_MATERIAL_LIMIT');
    await list(agent); const dir=folder(id);await fsp.mkdir(dir,{mode:0o700});
    try {await fsp.mkdir(file(id,'figures'),{mode:0o700});await atomic(file(id,'brief.md'),instructions);await atomic(file(id,'paper.json'),payload);
      const row={id,agent,documentHash,...(kind==='chat'?{kind}:{}),state:'preparing',updated:Date.now()};await save(row);return row;}
    catch(e){await fsp.rm(dir,{recursive:true,force:true});throw e;}
  }
  async function withLock(id,fn){
    const lock=file(id,'job.lock');let handle;
    for(let i=0;i<100;i++){try{handle=await fsp.open(lock,'wx',0o600);break;}catch(e){if(e.code!=='EEXIST')throw e;const s=await fsp.stat(lock).catch(()=>null);if(s && Date.now()-s.mtimeMs>120000)await fsp.unlink(lock).catch(()=>{});await new Promise(r=>setTimeout(r,50));}}
    if(!handle)throw error('PPT_JOB_BUSY');try{return await fn();}finally{await handle.close();await fsp.unlink(lock).catch(()=>{});}
  }
  async function command(op,args,agent){
    if(op==='open')return open(args);
    if(op==='openLive'){
      if(!agents.has(agent)||!args.documentHash||typeof args.documentHash!=='string'||args.documentHash.length>160)throw error('PPT_JOB_INVALID');
      await list(agent);await fsp.mkdir(folder(args.id),{mode:0o700});
      const row={id:args.id,agent,documentHash:args.documentHash,kind:'live',state:'working',updated:Date.now()};
      await save(row);return row;
    }
    if(op==='list')return list(agent);
    const {id}=args;
    if(op==='status'){
      const row=await resolved(id,agent);
      const history = row.state === 'cancelled' ? [] : await questions(id);
      const latest = history.at(-1);
      const answer=row.kind==='chat' && row.state==='ready' ? (await regular(file(id,'answer.txt'),96*1024)).toString() : '';
      return {...row,...(latest ? {interaction:latest,previous:history.slice(-7,-1)} : {}),...(answer?{answer}:{})};
    }
    if(op==='answer'){
      if(!agents.has(agent))throw error('PPT_AGENT_REQUIRED');
      const row=await resolved(id,agent);
      if(row.state==='cancelled')return {requestId:args.requestId,state:'cancelled'};
      const q=(await questions(id)).find(q=>q.requestId===args.requestId);
      if(!q)throw error('AGENT_QUESTION_NOT_FOUND');
      return q;
    }
    if(op==='read'){
      const r=await resolved(id);if(r.state!=='ready')throw error('PPT_FILE_NOT_READY');
      const pos=args.offset;if(!Number.isSafeInteger(pos)||pos<0||pos>=r.bytes)throw error('PPT_CHUNK_INVALID');
      const fh=await fsp.open(file(id,'verified.pptx'),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      try{const buf=Buffer.alloc(Math.min(196608,r.bytes-pos));const part=await fh.read(buf,0,buf.length,pos);
        if(part.bytesRead!==buf.length)throw error('PPT_FILE_INVALID');return {data:buf.toString('base64'),next:pos+buf.length};}finally{await fh.close();}
    }
    return withLock(id,async()=>{
      const r=await resolved(id,agent);
      if(op==='closeLive' && r.kind==='live' && agents.has(agent)){
        await save({...r,state:'cancelled',updated:Date.now()});await fsp.rm(file(id,'questions.json'),{force:true});return {};
      }
      if(r.kind==='live' && !['ask','respond','cancel'].includes(op))throw error('PPT_JOB_STATE');
      if (op === 'progress') {
        if (!agents.has(agent) || r.state !== 'working') throw error('PPT_JOB_STATE');
        if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 360) throw error('AGENT_PROGRESS_INVALID');
        const progress = args.message.trim();
        if (r.progress !== progress) await save({...r,progress,updated:Date.now()});
        return {id,state:r.state,progress};
      }
      if(op==='ask'){
        if(!agents.has(agent)||r.state!=='working')throw error('PPT_JOB_STATE');
        const set=questionSet(args);if(!set)throw error('AGENT_QUESTION_INVALID');
        const all=await questions(id), prior=all.find(q=>q.requestId===set.requestId);
        if(prior){
          if(JSON.stringify(questionSet(prior)?.questions)!==JSON.stringify(set.questions))throw error('AGENT_QUESTION_CHANGED');
          return prior;
        }
        if(all.at(-1)?.state==='waiting')throw error('AGENT_QUESTION_PENDING');
        const q={...set,state:'waiting'};
        await saveQuestions(id,[...all,q]);await save({...r,updated:Date.now()});
        return q;
      }
      if(op==='respond'){
        if(agent||!args.documentHash||r.documentHash!==args.documentHash)throw error('AGENT_QUESTION_WRONG_PAPER');
        if(r.state==='cancelled')throw error('PPT_JOB_STATE');
        const all=await questions(id), q=all.at(-1);
        if(!q||q.requestId!==args.requestId)throw error('AGENT_QUESTION_STALE');
        const target=args.dismissed===true?'dismissed':'answered';
        const answers=target==='answered'?answersFor(q,args.answers):null;
        if(target==='answered'&&!answers)throw error('AGENT_ANSWER_INVALID');
        if(q.state!=='waiting'){
          if(q.state===target && (target==='dismissed'||JSON.stringify(answers)===JSON.stringify(q.answers)))return q;
          throw error('AGENT_QUESTION_SETTLED');
        }
        if(r.state!=='working')throw error('PPT_JOB_STATE');
        q.state=target;if(answers)q.answers=answers;
        await saveQuestions(id,all);await save({...r,updated:Date.now()});return q;
      }
      if(op==='image'){
        if(r.state!=='preparing'||!/^figure-[a-z0-9_-]{1,55}\.(?:png|jpg|webp)$/i.test(args.name))throw error('PPT_ASSET_INVALID');
        if(typeof args.data!=='string'||args.data.length>8*1024*1024)throw error('PPT_MATERIAL_LIMIT');
        const img=Buffer.from(args.data,'base64');if(img.length>5*1024*1024)throw error('PPT_MATERIAL_LIMIT');
        const dir=file(id,'figures');if((await fsp.readdir(dir)).length>=160)throw error('PPT_MATERIAL_LIMIT');
        await atomic(path.join(dir,args.name),img);
        await save({...r,updated:Date.now()});return {};
      }
      if(op==='publish'&&r.state==='preparing')r.state='pending';
      else if(op==='claim'&&['pending','working'].includes(r.state)){r.state='working';await save({...r,updated:Date.now()});
        return {id,kind:r.kind||'ppt',directory:folder(id),brief:file(id,'brief.md'),materials:file(id,'paper.json'),...(r.kind==='chat'?{}:{output:file(id,filename)})};}
      else if(op==='complete'&&r.kind==='chat'&&r.state==='working'){
        if((await questions(id)).at(-1)?.state==='waiting')throw error('AGENT_QUESTION_PENDING');
        if(typeof args.answer!=='string'||!args.answer.trim()||Buffer.byteLength(args.answer)>96*1024)throw error('AGENT_ANSWER_INVALID');
        await atomic(file(id,'answer.txt'),args.answer.trim());r.state='ready';
      }else if(op==='complete'&&r.kind==='chat'&&r.state==='ready'){
        if((await regular(file(id,'answer.txt'),96*1024)).toString()!==String(args.answer||'').trim())throw error('PPT_JOB_STATE');
        return r;
      }
      else if(op==='deliver'&&['pending','working'].includes(r.state)){
        if(r.kind==='chat')throw error('PPT_JOB_STATE');
        if((await questions(id)).at(-1)?.state==='waiting')throw error('AGENT_QUESTION_PENDING');
        const buf=await regular(file(id,filename),maxFile);Object.assign(r,verifyDeck(buf));await atomic(file(id,'verified.pptx'),buf);r.state='ready';
      }else if(op==='cancel'&&['preparing','pending','working'].includes(r.state))r.state='cancelled';
      else if((op==='deliver'&&r.state==='ready')||(op==='publish'&&r.state==='pending')||(op==='cancel'&&r.state==='cancelled'))return r;
      else throw error('PPT_JOB_STATE');
      r.updated=Date.now();await save(r);
      if(['ready','cancelled'].includes(r.state)){for(const name of ['brief.md','paper.json','figures',filename])await fsp.rm(file(id,name),{recursive:true,force:true}).catch(()=>{});}
      if(r.state==='cancelled')await fsp.rm(file(id,'questions.json'),{force:true});
      return r;
    });
  }
  return {command,list};
}
module.exports={createStore,verifyDeck,defaultRoot};
