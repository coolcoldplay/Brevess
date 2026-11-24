/* Whole-document workspace. All PDF and image data stay within this page. */
const PaperBatch=(()=>{
  const $=id=>document.getElementById(id);
  const tick=()=>new Promise(done=>setTimeout(done,0));
  const element=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e;};
  const action=(title,handler,icon)=>{const b=element('button',title);b.type='button';b.onclick=handler;return icon?PanelIcons.set(b,icon,title):b;};
  let job=null,region=null,previewRecord=null,previewIndex=-1,previewRequest=0,objectUrl='',pageRequest=0;
  function locked(){return !!job&&job.phase!=='ready';}
  function changed(){if(job?.active&&job.phase==='ready')job.active.dirty=true;}
  function phase(j,value,message){
    if(j!==job)return;
    j.phase=value;const busy=locked();
    $('imageDesk').inert=busy||!j.active?.box;
    for(const id of ['batchReview','addFigure','locateFigure','reframe','previewReframe'])$(id).disabled=busy;
    $('paperPpt').disabled=busy||!j.entries.length;
    $('figureNav').inert=busy;
    $('pdfProgress').hidden=!['read','detect','split'].includes(value);
    if(message)$('pdfSummary').textContent=message;
    PanelEditor.controls();
  }
  function destroy(task){if(task)Promise.resolve(task.destroy()).catch(()=>{});}
  function leave(restore=true){
    if(!job)return;
    const j=job;job=null;region=null;previewRecord=null;pageRequest++;
    $('reframe').hidden=$('previewReframe').hidden=$('locateFigure').hidden=true;
    for(const id of ['batchDialog','pageDialog','pngDialog'])if($(id).open)$(id).close();
    $('pdfDesk').hidden=true;$('imageDesk').hidden=false;$('imageDesk').inert=false;$('figureNav').replaceChildren();$('batchGallery').replaceChildren();
    if(j.prior?.model&&restore)PanelEditor.mount(j.prior.model,j.prior);
    else PanelEditor.clear();
    destroy(j.loading||j.doc);
    if(restore)PanelEditor.status(j.prior?.model?'已关闭 PDF。':'');PanelEditor.controls();
  }
  async function modelFor(j,rec){
    const fused=await PaperFusion.analyze(j.doc,rec,j.pages,()=>j===job);
    const source=fused.source;
    try{
      if(j!==job)throw Error('已取消');
      const {w,h,owners,visible,paper,items}=fused.model;
      items.forEach((p,id)=>p.autoId=id);
      if(!items.length)items.push({label:'整图',whole:true,shape:{type:'rect',box:[0,0,source.width,source.height]},review:true,description:''});
      if(!rec.saved&&rec.outputs)for(const p of rec.outputs)if(items[p.id])items[p.id].pack=p.selected;
      return {w,h,owners,visible,paper,source,name:rec.name+' · PDF 第 '+rec.page+' 页',automaticItems:items,items:rec.saved?.items??structuredClone(items),
        evidence:rec.evidence,fusion:rec.fusion,pdfPage:rec.page,pdfBox:rec.box.slice(),
        physical:[rec.box[2]-rec.box[0],rec.box[3]-rec.box[1]]};
    }catch(e){source.width=source.height=1;throw e;}
  }
  async function generate(j,rec,keep=false,manual=false){
    const m=await modelFor(j,rec);
    try{
      const outputs=await PanelFiles.outputs(m,rec.saved?.pad??0,rec.saved?.paper||'paper');
      if(j!==job)throw Error('已取消');
      Object.assign(rec,{outputs,size:[m.source.width,m.source.height],physical:m.physical});
      if(j.hash)await BrevessPanelEditor.record(j,rec,m,manual);
      return keep?m:null;
    }finally{if(!keep||j!==job)m.source.width=m.source.height=1;}
  }
  async function flush(j){
    const rec=j.active;if(!rec?.box||!j.mounted)return;
    const s=PanelEditor.snapshot();
    rec.saved={items:s.model.items,selected:s.selected,history:s.history,blankMode:s.blankMode,restoreIndex:s.restoreIndex,pad:s.pad,paper:s.paper};
    if(!rec.dirty)return;
    const outputs=await PanelFiles.outputs(s.model,s.pad,s.paper);
    if(j===job){
      if(j.hash)await BrevessPanelEditor.record(j,rec,s.model,true);
      rec.outputs=outputs;rec.dirty=false;
    }
  }
  function mount(j,rec,m){
    j.active=rec;j.mounted=!!m;
    $('pdfSelection').hidden=false;
    $('sourcePage').textContent='第 '+rec.page+' 页'+(rec.captionPage&&rec.captionPage!==rec.page?' · 图注在第 '+rec.captionPage+' 页':'')+(rec.uncertain?' · 请核对整图范围':'');
    $('reframe').hidden=!m;$('locateFigure').hidden=!!m;$('imageDesk').hidden=!m;
    showEvidence(rec);
    if(m)PanelEditor.mount(m,{...rec.saved,figureName:rec.name});
    else if($('pixelDialog').open)$('pixelDialog').close();
  }
  function nav(j){
    $('figureNav').replaceChildren();
    for(const r of j.entries){
      const b=action(r.name,()=>switchTo(r));b.setAttribute('aria-pressed',String(j.active===r));
      const info=!r.outputs?.length?'待定位':r.outputs.length===1&&r.outputs[0].whole?'整图':r.outputs.length+' Panel';
      b.append(element('small','P'+r.page+' · '+info+(r.fusion?.issues.length||r.evidence?.issues?.length?' · 待核对':'')));$('figureNav').append(b);
    }
    const available=j.entries.filter(r=>r.outputs?.length),names=new Set(available.map(r=>r.group||r.name));
    const scan=j.pages.filter(p=>p.scan).length,failed=j.pages.filter(p=>p.failed).length;
    const unsure=j.entries.filter(r=>r.uncertain||!r.outputs?.length).length;
    $('pdfSummary').textContent=j.doc.numPages+' 页 · '+names.size+' 幅候选 Figure · '+available.reduce((n,r)=>n+r.outputs.length,0)+' 张图像'+(unsure?' · '+unsure+' 个位置待复核':'')+(scan?' · '+scan+' 张扫描页可手动补选':'')+(failed?' · '+failed+' 页自动读取失败，可从 PDF 页补选':'');
  }
  async function switchTo(rec){
    const j=job;if(!j||locked()||j.active===rec)return;
    phase(j,'switch','正在载入 '+rec.name+'…');
    try{await flush(j);const m=rec.box&&rec.outputs?await modelFor(j,rec):null;if(j!==job)return;mount(j,rec,m);}
    catch(e){if(j===job)PanelEditor.status('载入整图失败。'+e.message,'warn');}
    finally{if(j===job){phase(j,'ready');nav(j);}}
  }
  function stepFigure(step){
    const j=job;if(!j?.active)return false;
    const next=j.entries[j.entries.indexOf(j.active)+step];
    if(next&&!locked())switchTo(next);
    return true;
  }
  function safeFile(s){return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,85)||'Figures';}
  async function load(file, options={}){
    const prior=job?.prior||PanelEditor.snapshot();leave(false);
    const j={file,prior,pages:[],entries:[],phase:'read',...options};job=j;
    $('pdfDesk').hidden=false;$('pdfSelection').hidden=true;$('imageDesk').hidden=true;$('pdfName').textContent=file.name;
    $('archiveName').value=safeFile(file.name.replace(/\.pdf$/i,''));$('pdfProgress').removeAttribute('value');
    phase(j,'read','正在打开 PDF…');PanelEditor.status('正在本机读取论文…','busy');
    try{
      j.doc=await PaperPDF.open(file,(update,reason)=>{
        if(j!==job)return;const pw=prompt(reason===2?'密码有误，请重新输入 PDF 密码':'请输入 PDF 打开密码');
        if(pw===null){leave(true);return;}update(pw);
      },t=>{if(j===job)j.loading=t;else destroy(t);});
      if(j!==job)return;
      for(let p=1;p<=j.doc.numPages;p++){
        phase(j,'detect','正在定位图像与图注 · 第 '+p+' / '+j.doc.numPages+' 页');$('pdfProgress').max=j.doc.numPages;$('pdfProgress').value=p-1;
        try{j.pages.push(await PaperPDF.scanPage(j.doc,p));}
        catch(e){
          if(j!==job)return;
          const page=await j.doc.getPage(p),v=page.getViewport({scale:1});
          j.pages.push({page:p,w:v.width,h:v.height,caps:[],blocks:[],letters:[],tables:[],failed:true});
        }
        if(j!==job)return;await tick();
      }
      j.entries=PaperPDF.collect(j.pages);
      try{PaperCaption.attach(j.entries,j.pages,j.doc.fingerprints?.[0]||'');}
      catch(e){for(const r of j.entries)r.evidence={text:r.caption||'',title:'',expected:[],complete:false,sources:[],issues:['完整图注读取失败，保留视觉结果。']};}
      if(j.hash){
        for(const row of j.priorRecords.values()){
          if(row.edit&&row.restore?.manualRegion&&!j.entries.some(r=>SciLLM.PdfPanelEvidence.key(r)===row.key)&&!row.figureId){
            j.entries.push({brevessKey:row.key,name:row.name,kind:'manual',page:row.page,captionPage:null});
          }
        }
        j.entries.forEach(rec=>BrevessPanelEditor.restore(j,rec));
      }
      if(j.indexOnly){
        const matches=j.entries.filter(r=>SciLLM.PdfPanelEvidence.figureId(r)===j.preferred);
        if(matches.length===1 && matches[0].box){
          const m=await modelFor(j,matches[0]);
          try { if(j===job)await BrevessPanelEditor.record(j,matches[0],m); }
          finally { m.source.width=m.source.height=0; }
        }
        return;
      }
      let first;
      const priority=j.entries.find(r=>SciLLM.PdfPanelEvidence.figureId(r)===j.preferred);
      const work=priority?[priority,...j.entries.filter(r=>r!==priority)]:j.entries;
      for(const [i,rec] of work.entries()){
        rec.enabled=rec.kind!=='unknown'&&!!rec.box;
        phase(j,'split','正在提取 '+rec.name+' · '+(i+1)+' / '+j.entries.length);$('pdfProgress').max=j.entries.length;$('pdfProgress').value=i;
        if(rec.box){
          try{const m=await generate(j,rec,!first);if(!first)first={rec,m};}
          catch(e){if(j!==job)return;rec.problem=e.message;rec.enabled=false;rec.uncertain=true;}
        }
        if(j!==job)return;await tick();
      }
      if(first)mount(j,first.rec,first.m);
      else if(j.entries.length)mount(j,j.entries[0],null);
      if(j.hash&&!j.pages.some(p=>p.failed)&&!j.entries.some(r=>r.problem))await SciLLM.PdfPanelEvidence.complete(j.hash);
      phase(j,'ready');nav(j);
      PanelEditor.status(first?'可逐图校正，或打开「预览与导出整篇」。':'未自动定位到可导出的整图，可从 PDF 页补选。',first?'ok':'warn');
    }catch(e){if(j===job){leave(true);PanelEditor.status('打开 PDF 失败。'+(e.message||'文件无法解析'),'warn');if(j.hash)throw e;}}
  }
  function showImage(blob,title,info,record=job?.mounted?job.active:null,index=-1){
    previewRequest++;previewIndex=index;
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    previewRecord=job?.entries.includes(record)?record:null;
    $('previewReframe').hidden=!previewRecord;
    objectUrl=URL.createObjectURL(blob);$('pngImage').src=objectUrl;$('pngTitle').textContent=title;
    $('pngInfo').textContent=info+(previewRecord?' · PDF 原图第 '+previewRecord.page+' 页':'');
    if(!$('pngDialog').open)$('pngDialog').showModal();
  }
  function showPanel(r,index){
    const p=r.outputs[index];
    showImage(p.blob,PanelFiles.filename(r.name,p),p.box[2]+' × '+p.box[3]+' px',r,index);
  }
  function showEvidence(rec){
    $('authorTitle').textContent=rec.evidence?.title||rec.caption||'未取得作者标题';
    const notes=[...(rec.fusion?.changes||[]),...(rec.fusion?.issues||[])];
    $('evidenceSummary').textContent='作者图注与识别核对'+(notes.length?' · '+notes.length+' 条记录':'');
    $('figureEvidenceBody').replaceChildren();
    const body=$('figureEvidenceBody'),e=rec.evidence;
    if(e?.expected.length)body.append(element('p','图注目录：'+e.expected.join(' · ')+'　图像：'+(rec.fusion?.observed||'未定位')));
    for(const note of notes){const row=element('p',note.message,'evidence-note');
      row.append(action('原页核对',()=>openRegion(rec,note.page||rec.page,note.label)));body.append(row);}
    for(const message of e?.issues||[])body.append(element('p',message,'evidence-warning'));
    const buttons=element('div',null,'small-row');buttons.append(action('查看原页与字母位置',()=>openRegion(rec)));
    for(const page of [...new Set(e?.sources.map(s=>s.page)||[])])buttons.append(action('图注原页 P'+page,()=>openRegion(rec,page)));
    body.append(buttons,element('p','字母一致不代表裁图边界已确认。请核对坐标轴、插图、比例尺和共用图例。'),element('p',e?.text||'未取得完整作者图注，可从原页手动核对。','author-caption'));
  }
  async function showEditorImage(blob,title,info){
    const j=job,record=j?.active;
    if(record?.dirty)await flush(j);
    if(j===job&&record===j?.active)showImage(blob,title,info);
  }
  async function showSlide(j,r){
    const token=++previewRequest;
    try{
      const all=sheets(j),s=all.find(s=>s.parts.includes(r));
      if(!s){$('batchMessage').textContent='请先勾选本 Figure 及其 Panel。';return;}
      const blob=await PanelSlides.preview(s,all);
      if(token===previewRequest&&j===job&&j.entries.includes(r)&&($('batchDialog').open||$('pngDialog').open)&&!$('pageDialog').open)
        showImage(blob,s.name,'PPT 排版 · '+s.outputs.length+' 张独立图片',r);
    }catch(e){if(j===job)$('batchMessage').textContent=e.message;}
  }
  function navigatePreview(horizontal,step,target){
    const j=job,large=$('pngDialog').open;
    if(!j||(!large&&!$('batchDialog').open)||(large&&!previewRecord))return false;
    if(locked())return true;
    const groups=[...$('batchGallery').children],group=target.closest('.figure-group');
    const record=large?previewRecord:group?j.entries[groups.indexOf(group)]:(j.active||j.entries[0]);
    if(!record)return false;
    const next=horizontal?record:j.entries[j.entries.indexOf(record)+step];
    if(!next)return true;
    const thumbs=group?[...group.querySelectorAll('.thumb')]:[];
    const current=large?previewIndex:thumbs.indexOf(target.closest('.thumb'));
    const count=next.outputs?.length||0;
    const index=horizontal?Math.max(0,Math.min(count-1,current+step)):0;
    const row=groups[j.entries.indexOf(next)];
    if(!large||!count){
      if(large&&!count){
        if(!$('batchDialog').open)return true;
        $('pngDialog').close();
      }
      const focus=row?.querySelectorAll('.thumb button')[index]||row?.querySelector('.group-head button');
      focus?.focus();
    }else if(!horizontal&&previewIndex<0&&next.enabled&&next.outputs.some(p=>p.selected)){
      showSlide(j,next);
    }else showPanel(next,index);
    return true;
  }
  function setPack(j,r,p,on){
    p.selected=on;if(r.saved?.items[p.id])r.saved.items[p.id].pack=on;
    if(j.active===r&&j.mounted){const item=PanelEditor.snapshot().model.items[p.id];if(item)item.pack=on;}
  }
  function sheets(j){
    const groups=new Map();
    for(const r of j.entries)if(r.enabled&&r.outputs?.some(p=>p.selected)){
      const key=r.groupId||r;if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(r);
    }
    return [...groups.values()].map(parts=>{
      const key=parts[0].group||parts[0].name;
      if(parts.length===1){const r=parts[0];return {name:key,size:r.size,physical:r.physical,outputs:r.outputs.filter(p=>p.selected),parts};}
      const width=Math.max(...parts.map(r=>r.physical[0]));let y=0;const outputs=[],labels=new Set();
      for(const r of parts){
        const [w,h]=r.physical,[sw,sh]=r.size;
        for(const p of r.outputs.filter(p=>p.selected)){
          const [x0,y0,pw,ph]=p.box,base=p.whole?'整图':p.label;
          let label=base;if(labels.has(label.toUpperCase())){label=base+'-P'+r.page;let k=2;while(labels.has(label.toUpperCase()))label=base+'-P'+r.page+'-'+k++;}
          labels.add(label.toUpperCase());outputs.push({...p,part:r,label,whole:false,layoutBox:[(width-w)/2+x0*w/sw,y+y0*h/sh,pw*w/sw,ph*h/sh]});
        }
        y+=h+10;
      }
      return {name:key,size:[width,y-10],physical:[width,y-10],outputs,parts};
    });
  }
  function reviewState(j){
    const list=sheets(j),n=list.reduce((s,f)=>s+f.outputs.length,0);
    const pending=j.entries.filter(r=>!r.outputs?.length).length;
    $('batchSummary').textContent='已选 '+list.length+' 幅 Figure · '+n+' 张 PNG · '+list.length+' 页 PPT'+(pending?' · '+pending+' 个位置尚待补选':'');
    const names=list.map(s=>s.name.toLowerCase()),files=list.flatMap(s=>s.outputs.map(p=>(s.name+'/'+PanelFiles.filename(s.name,p)).toLowerCase()));
    const problem=!list.length?'请至少选择一个 Panel。':!PanelFiles.validName($('archiveName').value.trim())?'请输入有效的导出文件名。':
      list.some(s=>!PanelFiles.validName(s.name))?'请检查 Figure 文件名。':new Set(files).size!==files.length||new Set(names).size!==names.length?'Figure 或 Panel 文件名有重复，请改名。':'';
    $('batchMessage').textContent=problem;$('downloadPaper').disabled=$('downloadSlides').disabled=!!problem||j.phase==='export';
    return {list,problem};
  }
  function gallery(j){
    const root=$('batchGallery');root.replaceChildren();
    for(const r of j.entries){
      const sect=element('section',null,'figure-group'),head=element('div',null,'group-head');
      const cb=element('input');cb.type='checkbox';cb.checked=!!r.enabled;cb.disabled=!r.outputs?.length;cb.setAttribute('aria-label','导出 '+r.name);
      cb.onchange=()=>{r.enabled=cb.checked;reviewState(j);};
      const name=element('input');name.type='text';name.value=r.name;name.maxLength=80;name.setAttribute('aria-label','Figure 名称 '+r.name);
      name.oninput=()=>{r.name=name.value.trim();if(r.groupId)for(const q of j.entries.filter(q=>q.groupId===r.groupId))q.group=r.name;reviewState(j);};
      const meta=element('small','PDF 第 '+r.page+' 页'+(r.uncertain?' · 请复核范围':'')+(r.outputs?.some(p=>p.whole)?' · 保留整图':''));
      const frame=action('从原页重新框选',()=>openRegion(r));frame.dataset.caption='';
      head.append(cb,name,meta,PanelIcons.set(frame,'crop','从原页重新框选'));
      if(r.outputs?.length)head.append(action('校正 Panel',async()=>{$('batchDialog').close();await switchTo(r);},'sliders-horizontal'));
      if(r.outputs?.length)head.append(action('预览幻灯片',()=>showSlide(j,r),'eye'));
      sect.append(head);const grid=element('div',null,'thumb-grid');
      if(r.evidence?.title)sect.append(element('p',r.evidence.title,'gallery-caption'));
      for(const [index,p] of (r.outputs||[]).entries()){
        const cell=element('div',null,'thumb'),pic=action('',()=>showPanel(r,index));
        pic.setAttribute('aria-label','查看 '+r.name+' '+p.label+' PNG');const im=element('img');im.src=p.thumb;im.alt='';im.loading='lazy';pic.append(im);
        const l=element('label'),ch=element('input');ch.type='checkbox';ch.checked=p.selected;
        ch.onchange=()=>{setPack(j,r,p,ch.checked);if(ch.checked){r.enabled=true;cb.checked=true;}reviewState(j);};
        l.append(ch,document.createTextNode(p.whole?'整图':'Panel '+p.label));cell.append(pic,l);grid.append(cell);
      }
      if(!r.outputs?.length)grid.append(element('p',r.problem||'请在 PDF 页上定位整图范围。'));
      sect.append(grid);root.append(sect);
    }
    if(!j.entries.length)root.append(element('p','尚无可导出的 Figure。返回编辑后可从任意 PDF 页补选。'));
    reviewState(j);
  }
  async function review(){
    const j=job;if(!j||locked())return;
    phase(j,'switch','正在生成导出预览…');
    try{await flush(j);if(j!==job)return;gallery(j);$('batchDialog').showModal();}
    catch(e){if(j===job)PanelEditor.status('预览失败。'+e.message,'warn');}
    finally{if(j===job){phase(j,'ready');nav(j);}}
  }
  async function download(kind){
    const j=job;if(!j||locked())return;
    const inGallery=$('batchDialog').open;
    const report=(message,tone='busy')=>{
      if(j!==job)return;
      $('batchMessage').textContent=message;
      if(!inGallery)PanelEditor.status(message,tone);
    };
    phase(j,'export');$('batchGallery').inert=true;
    const controls=['batchAll','batchNone','archiveName','backToPaper','downloadPaper','downloadSlides'];
    for(const id of controls)$(id).disabled=true;
    report('正在准备整篇导出…');
    let invalid=false;
    try{
      await tick();await flush(j);if(j!==job)return;
      const {list,problem}=reviewState(j);
      if(problem){
        invalid=true;
        if(!inGallery){gallery(j);$('batchDialog').showModal();report(problem,'warn');}
        return;
      }
      const filename=$('archiveName').value.trim()+'.'+kind;
      const blob=kind==='pptx'?await PanelSlides.make(list,(n,t)=>report('正在写入幻灯片 '+n+' / '+t)):
        await PanelOutput.zip(list.flatMap(s=>s.outputs.map(p=>({name:s.name+'/'+PanelFiles.filename(s.name,p),blob:p.blob}))));
      if(j===job){PanelOutput.save(blob,filename);report('已生成 '+filename+'。','ok');}
    }catch(e){report('导出失败。'+e.message,'warn');}
    finally{if(j===job){
      phase(j,'ready');nav(j);$('batchGallery').inert=false;
      for(const id of controls)$(id).disabled=false;
      $('downloadPaper').disabled=$('downloadSlides').disabled=invalid;
    }}
  }
  function drawRegion(){
    if(!region?.source)return;
    const c=$('pageBoard'),ctx=c.getContext('2d'),m=job.pages[region.num-1];
    ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(region.source,0,0);
    const sx=c.width/m.w,sy=c.height/m.h,unit=c.width/Math.max(1,c.clientWidth);
    const original=region.num===region.record?.page&&region.record.box,b=region.box;
    if(original){
      const [x,y,right,bottom]=original;
      ctx.lineWidth=1.5*unit;ctx.strokeStyle='#657185';ctx.setLineDash([5*unit,4*unit]);
      ctx.strokeRect(x*sx,y*sy,(right-x)*sx,(bottom-y)*sy);ctx.setLineDash([]);
    }
    const rec=region.record;
    function outline(box,color,label){
      if(!box)return;
      const [l,t,r,b]=box;ctx.strokeStyle=color;ctx.lineWidth=1.5*unit;
      ctx.strokeRect(l*sx,t*sy,(r-l)*sx,(b-t)*sy);
      if(label){ctx.font=(12*unit)+'px Arial';ctx.fillStyle=color;ctx.fillText(label,l*sx,Math.max(14*unit,t*sy-3*unit));}
    }
    if(rec){
      for(const s of rec.evidence?.sources||[])if(s.page===region.num)outline(s.box,'#ad751d');
      if(rec.page===region.num){
        for(const v of rec.fusion?.changes||[])if(v.code==='anchor-corrected'&&(!region.label||v.label===region.label))outline(v.before,'#c14634',v.label+' 原候选');
        for(const p of rec.fusion?.anchors||[])outline(p.box,region.label===p.label?'#16589c':'#157b61',p.label);
        for(const note of rec.fusion?.issues||[])if(note.box&&(!region.label||note.label===region.label))outline(note.box,'#c14634');
      }
    }
    if(b){
      const x=b[0]*sx,y=b[1]*sy,w=(b[2]-b[0])*sx,h=(b[3]-b[1])*sy;
      ctx.fillStyle='rgba(33,91,160,.10)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#16589c';ctx.lineWidth=2*unit;ctx.strokeRect(x,y,w,h);
    }
    $('regionKey').hidden=!original;
    $('useRegion').disabled=!b||b[2]-b[0]<4||b[3]-b[1]<4||!!region.start||region.saving;
    $('regionInfo').textContent='第 '+region.num+' 页 · '+(b?'新范围 '+Math.round(b[2]-b[0])+' × '+Math.round(b[3]-b[1])+' pt':'拖动绘制新范围');
  }
  async function displayPage(n){
    const j=job,r=region;if(!j||!r||r.saving)return;
    const token=++pageRequest;n=Math.max(1,Math.min(j.pages.length,Math.round(Number(n)||1)));
    if(r.source)r.source.width=r.source.height=1;
    r.num=n;r.start=null;r.source=null;r.box=null;r.zoom=1;
    $('useRegion').disabled=true;$('regionKey').hidden=true;
    $('pageNum').value=n;$('pagePrev').disabled=n===1;$('pageNext').disabled=n===j.pages.length;
    $('regionInfo').textContent='正在渲染第 '+n+' 页…';
    const board=$('pageBoard');board.width=board.height=1;
    try{
      const source=await PaperPDF.render(j.doc,n,null,Math.min(1.8,1020/j.pages[n-1].w));
      if(region!==r||job!==j||token!==pageRequest){source.width=source.height=1;return;}
      r.source=source;board.width=source.width;board.height=source.height;zoomPage(1);
    }catch(e){if(region===r&&token===pageRequest)$('regionInfo').textContent=e.message;}
  }
  function zoomPage(factor){
    if(!region?.source||region.saving||region.start)return;
    const stage=$('pageStage'),c=$('pageBoard'),r=region;
    r.zoom=factor==='fit'?1:Math.max(1,Math.min(4,(r.zoom||1)*factor));
    const padding=parseFloat(getComputedStyle(stage).paddingLeft)||0;
    const fit=Math.max(1,Math.min(stage.clientWidth-padding*2,(stage.clientHeight-padding*2)*c.width/c.height));
    stage.dataset.zoomed=String(r.zoom>1);
    c.style.width=r.zoom>1?Math.round(fit*r.zoom)+'px':'';c.style.height=r.zoom>1?Math.round(fit*r.zoom*c.height/c.width)+'px':'';
    const p=job.pages[r.num-1],focus=r.num===r.record?.page&&
      (r.record.fusion?.anchors.find(a=>a.label===r.label)?.box||r.record.box);
    const center=focus?[(focus[0]+focus[2])/2/p.w,(focus[1]+focus[3])/2/p.h]:[.5,.5];
    stage.scrollLeft=Math.max(0,center[0]*c.clientWidth-stage.clientWidth/2);
    stage.scrollTop=Math.max(0,center[1]*c.clientHeight-stage.clientHeight/2);
    $('pageZoomOut').disabled=r.zoom===1;$('pageZoomIn').disabled=r.zoom===4;drawRegion();
  }
  function openRegion(rec,page=rec?.page,label=''){
    if(!job||locked()||$('pageDialog').open||(rec&&!job.entries.includes(rec)))return;
    const originPage=page||rec?.page||job.active?.page||1;
    const r=region={record:rec,originPage,saving:false,label};
    let i=1;while(job.entries.some(q=>q.name.toLowerCase()==='fig '+i))i++;
    $('regionName').value=rec?.name||'Fig '+i;$('pageNum').max=job.pages.length;$('pageTotal').textContent='/ '+job.pages.length;
    $('pageTitle').textContent=rec?'重新框选 '+rec.name:'从 PDF 原页补选 Figure';
    $('pageEvidence').textContent=rec?[
      rec.evidence?.title,
      label?PaperCaption.panel(rec.evidence,label).targetText:'',
      ...(rec.fusion?.changes||[]).filter(v=>!label||v.label===label).map(v=>v.message),
      ...(rec.fusion?.issues||[]).filter(v=>!label||v.label===label).map(v=>v.message),
      '蓝框：当前字母；绿框：其他自动字母；橙框：作者图注；红框：原候选或待核对位置。可放大原页核对；仅查看时关闭即可。'
    ].filter(Boolean).join('\n'):'';
    $('pageDialog').showModal();displayPage(r.originPage);
  }
  async function applyRegion(){
    const j=job,r=region;if(!j||!r?.source||!r.box||r.saving||locked()||$('useRegion').disabled)return;
    const prior=r.record,index=prior?j.entries.indexOf(prior):-1;if(prior&&index<0)return;
    const name=$('regionName').value.trim();
    if(!PanelFiles.validName(name)||j.entries.some(q=>q!==r.record&&q.name.toLowerCase()===name.toLowerCase())){$('regionInfo').textContent='请输入唯一且有效的 Figure 名称。';return;}
    r.saving=true;phase(j,'switch');$('pageDialog').querySelectorAll('button,input').forEach(b=>b.disabled=true);
    $('regionInfo').textContent='正在按新范围提取 Panel…';
    try{
      await flush(j);
      if(j!==job||r!==region)return;
      const settings=prior?.saved?{pad:prior.saved.pad,paper:prior.saved.paper}:null;
      const resolution=prior?.page===r.num&&prior.resolution?Math.max(3,prior.resolution):null;
      const rec={...prior,name,page:r.num,box:r.box.slice(),resolution,kind:prior?.kind||'manual',
        enabled:prior?.outputs?.length?prior.enabled:true,outputs:null,saved:settings,dirty:false,uncertain:false,problem:null,
        manualRegion:true,fusion:null,brevessKey:prior?SciLLM.PdfPanelEvidence.key(prior):'manual/'+crypto.randomUUID()};
      const m=await generate(j,rec,true,true);if(j!==job)return;
      const omitted=new Set(prior?.outputs?.filter(p=>!p.selected).map(p=>p.label.toLowerCase()));
      for(const p of rec.outputs)if(omitted.has(p.label.toLowerCase()))p.selected=m.items[p.id].pack=m.automaticItems[p.id].pack=false;
      if(rec.saved)rec.saved.items=m.items;
      if(rec.groupId&&name!==prior.name){
        for(const q of j.entries.filter(q=>q.groupId===rec.groupId))q.group=name;
        rec.group=name;
      }
      if(prior)j.entries.splice(index,1,rec);
      else{const at=j.entries.findIndex(q=>q.page>rec.page);j.entries.splice(at<0?j.entries.length:at,0,rec);}
      mount(j,rec,m);$('pageDialog').close();
      for(const id of ['pngDialog','saveDialog'])if($(id).open)$(id).close();
      if($('batchDialog').open)gallery(j);
      PanelEditor.status('已按第 '+r.num+' 页的新范围更新 '+name+'。');
    }catch(e){if(j===job)$('regionInfo').textContent='提取失败。'+e.message;}
    finally{if(j===job){
      r.saving=false;$('pageDialog').querySelectorAll('button,input').forEach(b=>b.disabled=false);
      $('pagePrev').disabled=r.num===1;$('pageNext').disabled=r.num===j.pages.length;
      phase(j,'ready');nav(j);
    }}
  }
  function init(){
    $('panelSource').onclick=()=>openRegion(job?.active,job?.active?.page,PanelEditor.snapshot().model?.items[PanelEditor.snapshot().selected]?.label);
    $('closePdf').onclick=()=>leave(true);$('batchReview').onclick=review;$('backToPaper').onclick=()=>$('batchDialog').close();
    $('downloadPaper').onclick=()=>download('zip');$('paperPpt').onclick=$('downloadSlides').onclick=()=>download('pptx');
    $('archiveName').oninput=()=>{if(job)reviewState(job);};
    for(const id of ['batchAll','batchNone'])$(id).onclick=()=>{
      if(!job)return;const yes=id==='batchAll';
      for(const r of job.entries){r.enabled=yes&&!!r.outputs?.length;for(const p of r.outputs||[])setPack(job,r,p,yes);}
      gallery(job);
    };
    $('batchDialog').oncancel=e=>{if(job?.phase==='export')e.preventDefault();};
    $('pngClose').onclick=()=>$('pngDialog').close();
    $('pngDialog').onclose=()=>{
      if($('pngDialog').open)return;
      // The close event is asynchronous. Do not steal focus if the user has
      // already started editing a Figure name after dismissing the preview.
      if($('batchDialog').open&&job&&previewRecord&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')){
        const row=$('batchGallery').children[job.entries.indexOf(previewRecord)];
        const focus=previewIndex<0?row?.querySelector('[data-icon="eye"]'):row?.querySelectorAll('.thumb button')[previewIndex];
        focus?.focus();
      }
      previewRequest++;if(objectUrl)URL.revokeObjectURL(objectUrl);
      objectUrl='';previewRecord=null;$('pngImage').removeAttribute('src');
    };
    $('addFigure').onclick=()=>openRegion(null);$('reframe').onclick=$('locateFigure').onclick=()=>openRegion(job?.active);
    $('previewReframe').onclick=()=>{if(previewRecord)openRegion(previewRecord);};
    $('resetRegion').onclick=()=>{if(region)displayPage(region.originPage);};
    $('pageZoomIn').onclick=()=>zoomPage(1.5);$('pageZoomOut').onclick=()=>zoomPage(1/1.5);$('pageFit').onclick=()=>zoomPage('fit');
    $('pageClose').onclick=()=>$('pageDialog').close();$('pageDialog').oncancel=e=>{if(region?.saving)e.preventDefault();};
    $('pageDialog').onclose=()=>{if($('pageDialog').open)return;pageRequest++;if(region?.source)region.source.width=region.source.height=1;region=null;const c=$('pageBoard');c.width=c.height=1;};
    $('pagePrev').onclick=()=>displayPage(region.num-1);$('pageNext').onclick=()=>displayPage(region.num+1);
    $('pageNum').onchange=()=>displayPage($('pageNum').value);$('useRegion').onclick=applyRegion;
    const c=$('pageBoard'),stage=$('pageStage');
    function at(e){const r=c.getBoundingClientRect(),p=job.pages[region.num-1];return [Math.max(0,Math.min(p.w,(e.clientX-r.left)*p.w/r.width)),Math.max(0,Math.min(p.h,(e.clientY-r.top)*p.h/r.height))];}
    function trace(e){if(!region?.start||region.pointer!==e.pointerId)return;
      const a=region.start,b=at(e);region.box=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];drawRegion();}
    stage.onpointerdown=e=>{
      if(!region?.source||region.saving||region.start||e.button!==0)return;
      const bounds=stage.getBoundingClientRect();
      if(e.clientX>=bounds.left+stage.clientLeft+stage.clientWidth||e.clientY>=bounds.top+stage.clientTop+stage.clientHeight)return;
      e.preventDefault();region.previous=region.box;region.start=at(e);region.pointer=e.pointerId;
      stage.setPointerCapture(e.pointerId);trace(e);
    };
    stage.onpointermove=trace;
    function finish(e,commit){
      if(!region?.start||region.pointer!==e.pointerId)return;
      if(commit)trace(e);
      const b=region.box;
      if(!commit||!b||b[2]-b[0]<4||b[3]-b[1]<4)region.box=region.previous;
      region.start=null;region.pointer=null;
      if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
      drawRegion();
    }
    stage.onpointerup=e=>finish(e,true);
    stage.onpointercancel=stage.onlostpointercapture=e=>finish(e,false);
  }
  async function selectEvidence(id,label){
    const j=job;
    if(!j||locked())return false;
    const records=j.entries.filter(r=>SciLLM.PdfPanelEvidence.figureId(r)===id);
    const rec=label?records.filter(r=>r.outputs?.some(p=>p.label.toUpperCase()===label.toUpperCase())):records;
    if(rec.length!==1)return false;
    await switchTo(rec[0]);
    if(j!==job||j.active!==rec[0])return false;
    if(label){
      const index=PanelEditor.snapshot().model?.items?.findIndex(p=>p.label.toUpperCase()===label.toUpperCase());
      if(!(index>=0))return false;
      PanelEditor.select(index);
    }
    return true;
  }
  async function saveCurrent(){
    if(job&&job.phase==='ready')await flush(job);
  }
  return {init,locked,changed,leave,load,selectEvidence,saveCurrent,showImage:showEditorImage,stepFigure,navigatePreview};
})();
