(function(){'use strict';const R=globalThis.BrevessRadar;
 R.createRadarSourceQueries=function({document:doc,source,query}){
  const box=doc.createElement('section');box.className='radar-source-queries';const heading=doc.createElement('strong');heading.textContent='选择文献来源';const choices=doc.createElement('div');choices.className='radar-source-choices';const fields=doc.createElement('div');box.append(heading,choices,fields);source.before(box);
  let selected=new Set(['pubmed']),drafts=new Map(),epoch=0;
  source.hidden=true;query.hidden=true;query.required=false;doc.querySelector('label[for=source]').hidden=true;doc.querySelector('label[for=query]').hidden=true;doc.getElementById('source-hint').hidden=true;doc.getElementById('preview-query').parentElement.hidden=true;
  const values=()=>[...selected].map(id=>({source:id,query:drafts.get(id)||''}));
  function sync(){const first=values()[0];if(first){source.value=first.source;query.value=first.query;}query.dispatchEvent(new Event('input'));}
  function render(){choices.replaceChildren();fields.replaceChildren();for(const [id,def]of Object.entries(R.RADAR_SOURCES)){
    const label=doc.createElement('label'),check=doc.createElement('input');check.type='checkbox';check.value=id;check.checked=selected.has(id);check.dataset.radarSource=id;label.append(check,def.name);choices.append(label);
    check.onchange=()=>{if(check.checked)selected.add(id);else selected.delete(id);epoch++;render();source.dispatchEvent(new Event('change'));};
   }
   for(const id of selected){const def=R.RADAR_SOURCES[id],row=doc.createElement('label');row.className='radar-source-query';row.append(def.name+' · 独立检索式');const input=doc.createElement('textarea');input.rows=3;input.maxLength=4000;input.required=true;input.spellcheck=false;input.dataset.sourceQuery=id;input.setAttribute('aria-label',def.name+' 检索式');input.placeholder=def.example;input.value=drafts.get(id)||'';input.oninput=()=>{drafts.set(id,input.value);sync();};row.append(input);
    const hint=doc.createElement('small');hint.textContent=['biorxiv','medrxiv'].includes(id)?'通过 Europe PMC 预印本索引；使用 TITLE_ABS 与布尔检索。':def.credential?'需在“来源连接”配置 API 授权。':id==='crossref'||id==='asta'?'使用普通关键词。':'使用该来源的检索语法。';hint.textContent+=' 日期口径：'+def.date;row.append(hint);const link=doc.createElement('a');link.textContent='来源语法与能力 ↗';link.href=def.help;link.target='_blank';link.rel='noopener noreferrer';row.append(link);fields.append(row);
   }sync();
  }
  render();return {values,get epoch(){return epoch;},reset(radar){epoch++;const rows=radar?R.radarSourceQueries(radar):[{source:'pubmed',query:''}];selected=new Set(rows.map(r=>r.source));drafts=new Map(rows.map(r=>[r.source,r.query]));render();},candidate(id,value,previous,generation){if(epoch!==generation||!selected.has(id)||drafts.get(id)!==previous&&!(drafts.get(id)===undefined&&previous===''))return false;drafts.set(id,value);const input=fields.querySelector('[data-source-query="'+id+'"]');if(input)input.value=value;sync();return true;}};
 };
})();
