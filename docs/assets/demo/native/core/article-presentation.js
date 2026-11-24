(function (root, factory) {
  const clients = typeof module === 'object' && module.exports ? require('./agent-setup-prompt.js').getAgentSetupClients() : root.SciLLM?.getAgentSetupClients?.() || [];
  const api = factory(clients);
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM ||= {}, { articlePresentation: api });
})(globalThis, function (clients) {
  'use strict';
  const agents = Object.freeze(Object.assign({workbuddy:'WorkBuddy',codex:'Codex',dsh:'DeepSeek Harness'},
    Object.fromEntries(clients.filter(c=>!['workbuddy','codex','dsh'].includes(c.id)).map(c=>[c.id,c.label]))));
  const preset = 'agent_journal_club_ppt';
  function requested(text) {
    const q = String(text || '').normalize('NFKC');
    if (!/pptx?|powerpoint|幻灯片|slide\s*deck/i.test(q)) return false;
    if (/暂不制作|不要(?:制作|生成|下载)|只(?:需|要).{0,8}(?:大纲|建议|讲稿)|如何(?:制作|生成)|怎么(?:制作|做)|how (?:do|can|should) I|do not (?:create|generate)/i.test(q)) return false;
    if (/(?:pptx?|powerpoint|幻灯片).{0,6}(?:大纲|提示词|讲稿|建议)|(?:审核|评估|优化|核对).{0,8}(?:PPT|幻灯片)/i.test(q) && !/下载|\.pptx/i.test(q)) return false;
    return /(?:生成|制作|做成|做一|做个|帮.{0,5}做|导出|下载|create|make|generate|build|download|export)[\s\S]{0,100}(?:pptx?|powerpoint|幻灯片|slide\s*deck)|(?:pptx?|powerpoint|幻灯片|slide\s*deck)[\s\S]{0,45}(?:做出来|做成|制作|生成|下载)/i.test(q);
  }
  function grant(value) {
    if (!value || !Object.hasOwn(agents, value.agent)) return null;
    return {agent: value.agent, history: value.history === true, notes: value.notes === true};
  }
  const key = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/i.test(value) &&
    !['__proto__','constructor','prototype'].includes(value);
  const short = (text, limit) => typeof text === 'string' && !!text.trim() && text.length <= limit;
  function questionSet(input) {
    if (!key(input?.requestId) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 6) return null;
    const questions = [], ids = new Set();
    for (const q of input.questions) {
      if (!key(q?.id) || ids.has(q.id) || !short(q.prompt, 360) || !Array.isArray(q.options) || q.options.length > 10) return null;
      if (!q.options.length && q.allowText !== true) return null;
      ids.add(q.id);
      const options = [], optionIds = new Set();
      for (const option of q.options) {
        if (!key(option?.id) || optionIds.has(option.id) || !short(option.label, 120) ||
            (option.description != null && (typeof option.description !== 'string' || option.description.length > 200))) return null;
        optionIds.add(option.id);
        options.push({id:option.id, label:option.label.trim(), ...(option.description?.trim() ? {description:option.description.trim()} : {})});
      }
      const heading=q.heading ?? q.header;
      questions.push({id:q.id, prompt:q.prompt.trim(), ...(short(heading,120)?{heading:heading.trim()}:{}), multiple:q.multiple === true, allowText:q.allowText === true, options});
    }
    return {requestId:input.requestId, questions};
  }
  function answersFor(set, input) {
    if (!set || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== set.questions.length) return null;
    const answers = {};
    for (const q of set.questions) {
      const a = Object.hasOwn(input, q.id) && input[q.id];
      if (!a || !Array.isArray(a.selected) || (!q.multiple && a.selected.length > 1) ||
          new Set(a.selected).size !== a.selected.length || a.selected.some(id => !q.options.some(option => option.id === id))) return null;
      const text = a.text ?? '';
      if (typeof text !== 'string' || text.length > 1000 || (text.trim() && !q.allowText) || (!a.selected.length && !text.trim())) return null;
      answers[q.id] = {selected:q.options.filter(option => a.selected.includes(option.id)).map(option => option.id), text:text.trim()};
    }
    return answers;
  }
  function interaction(value) {
    const set = questionSet(value);
    if (!set || !['waiting','answered','dismissed'].includes(value.state)) return null;
    if (value.state !== 'answered') return {...set, state:value.state};
    // Agent-supplied IDs are data. Keeping them as array values also allows a
    // legitimate topic ID such as "headers" to round-trip through private stores.
    let input=value.answers;
    if(Array.isArray(value.responses)){
      if(value.responses.length!==set.questions.length || value.responses.some(row=>!key(row?.id)))return null;
      input=Object.fromEntries(value.responses.map(row=>[row.id,row]));
    }
    const answers=answersFor(set,input);
    return answers ? {...set, state:'answered', responses:set.questions.map(({id})=>({id,...answers[id]}))} : null;
  }
  function dialogue(value, turnId) {
    const current = interaction(value?.interaction);
    if (!current || value.id !== turnId || !short(value.documentHash,160)) return null;
    const previous = Array.isArray(value.previous) ? value.previous.slice(-6).map(interaction).filter(q=>q&&q.state!=='waiting') : [];
    return {id:turnId, documentHash:value.documentHash, interaction:current, previous};
  }
  function readerChoices(rows) {
    return (Array.isArray(rows)?rows:[]).slice(-6).map(interaction).filter(q=>q&&q.state!=='waiting').flatMap(q=>
      q.questions.map(item=>{
        const a=q.responses?.find(row=>row.id===item.id);
        return {question:item.prompt, skipped:q.state==='dismissed', choices:a?item.options.filter(o=>a.selected.includes(o.id)).map(o=>o.label):[], note:a?.text||''};
      }));
  }
  // A publisher may update counters or reference text between visits. A detached
  // task keeps its original material hash. Only the same DOI, exact canonical
  // page and local document generation can reopen that task across revisions.
  function paperBinding(workspace, documentId=workspace?.documentId) {
    if (!workspace || !short(workspace.workspaceId,300) || !short(documentId,300) ||
        !Number.isSafeInteger(workspace.workspaceGeneration) || workspace.workspaceGeneration < 1 ||
        !short(workspace.canonicalUrl,4000)) return null;
    const doi = String(workspace.doi || workspace.aliases?.find?.(a=>a?.type==='doi')?.value || '').toLowerCase();
    if (!/^10\.\d{4,9}\/[^\s?#]{1,460}$/i.test(doi)) return null;
    try {
      const u=new URL(workspace.canonicalUrl);
      if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
    } catch { return null; }
    return {workspaceId:workspace.workspaceId,workspaceGeneration:workspace.workspaceGeneration,
      documentId,canonicalUrl:workspace.canonicalUrl,doi};
  }
  function samePaperBinding(a,b) {
    const left=paperBinding(a), right=paperBinding(b);
    return !!left && !!right && Object.keys(left).every(key=>left[key]===right[key]);
  }
  function receipt(value) {
    if (!value || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value.id) || !Object.hasOwn(agents,value.agent)) return null;
    const latest = interaction(value.interaction);
    const previous = Array.isArray(value.previous) ? value.previous.slice(-6).map(interaction)
      .filter(q=>q && q.state !== 'waiting' && q.requestId !== latest?.requestId) : [];
    const paper = paperBinding(value.paper);
    return {id: value.id, agent: value.agent, documentHash: String(value.documentHash || '').slice(0,160), ...(paper ? {paper} : {}), ...(value.kind==='chat'?{kind:'chat'}:{}), ...(latest ? {interaction:latest} : {}),
      ...(previous.length ? {previous} : {}), ...(short(value.progress, 360) ? {progress:value.progress.trim()} : {}),
      state: ['preparing','pending','working','ready','failed','cancelled','expired'].includes(value.state) ? value.state : 'pending'};
  }
  function handoff(job, runtime) {
    const info = receipt(job);
    if (!info) throw Error('PPT_JOB_INVALID');
    const chat=info.kind==='chat', steps = [
      '领取 BREVESS 当前论文的任务 ' + info.id + '。调用 '+(chat?'brevess_claim_task':'brevess_claim_ppt')+'，读取返回目录中的 brief.md 和 paper.json。',
      chat?'在同一任务中用 brevess_complete_task 把最终回答送回原来的问答。':'按 brief.md 排版，将可编辑的 PowerPoint 保存到领取结果中的 output 路径，然后调用 brevess_deliver_ppt 交回这条问答。只处理这个任务。',
      '需要读者选择时，用 brevess_ask_user 把单选、多选或补充输入发到当前 BREVESS 问答；用 brevess_get_user_answer 取得选择后继续。'
    ];
    if (runtime?.command && Array.isArray(runtime.args) && runtime.args[1] === info.agent) {
      const windows = runtime.platform === 'win32';
      const quote = value => "'" + String(value).replaceAll("'", windows ? "''" : "'\\''") + "'";
      const launch = (windows ? '& ' : '') + [runtime.command, ...runtime.args].map(quote).join(' ');
      steps.push('若当前对话尚未载入 MCP 工具，直接用终端执行以下命令。', launch + ' --claim ' + info.id,
        '询问读者可执行', launch + ' --ask ' + info.id + ' <JSON>', launch + ' --wait-answer ' + info.id + ' <requestId>',
        '交回结果时执行', launch + (chat?' --reply '+info.id+' <回答>':' --deliver ' + info.id));
    }
    return steps.join('\n');
  }
  return { agents, preset, requested, grant, receipt, handoff, questionSet, answersFor, interaction, dialogue, readerChoices, paperBinding, samePaperBinding };
});
