const test = require('node:test');
const assert = require('node:assert/strict');
require('../extension/providers/provider-utils.js');
require('../extension/core/article-chat-web-sources.js');
const { createDeepSeekAdapter } = require('../extension/providers/deepseek.js');
const url = 'https://www.nature.com/articles/s41586-025-09984-y';
const call = { index: 0, id: 'tool-1', type: 'deepseek_web_search', kind: 'deep_search',
  status: 'completed', action: { type: 'search', queries: ['macrophage prior work'] },
  sources: [{ url, title: 'Public paper', snippet: 'Macrophages modulate pathology.' }] };
const chunk = extra => ({ id: 'chatcmpl-research', model: 'deepseek-flash', object: 'chat.completion.chunk', ...extra });
const nativeStream = (ending = 'complete') => {
  const frames = [chunk({ choices: [{ index: 0, delta: {}, server_tool_event: { type: 'call_started', call } }] }),
    chunk({ choices: [{ index: 0, delta: { content: 'Evidence summary.' } }] })];
  if (ending === 'error') frames.push({ error: { code: 'server_error' }, choices: [], usage: { prompt_tokens: 100 } });
  else if (ending === 'complete') frames.push(chunk({ choices: [{ index: 0, delta: { server_tool_calls: [{ calls: [call] }],
    annotations: [{ type: 'url_citation', url_citation: { url, title: 'Public paper', start_index: 0, end_index: 8 } }] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 40, server_tool_use: { tool_search: 2, tool_fetch: 3, web_search_requests: 90 } } }));
  return new Response(frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join('') + (ending === 'complete' ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
};
async function run({ large = false, ending, question = 'Find prior work', mode = 'deep', cancel = false } = {}) {
  const requests = [], controller = new AbortController();
  if (cancel) controller.abort();
  const adapter = createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'fixture' }, async (endpoint, init) => {
    const body = JSON.parse(init.body); requests.push({ endpoint, body });
    if (body.tools) {
      if (!large) return nativeStream(ending);
      const sources=Array.from({length:40},(_,i)=>({url:`https://www.nature.com/articles/uncited/${i}`,title:`Uncited ${i}`,snippet:'Paper'}));
      const annotations=Array.from({length:20},(_,i)=>({type:'url_citation',url_citation:{url:`https://www.nature.com/articles/cited/${i}`,title:`Cited ${i}`}}));
      const frame=chunk({choices:[{index:0,delta:{content:'Evidence',server_tool_calls:[{calls:[{...call,sources}]}],annotations},finish_reason:'stop'}]});
      return new Response('data: '+JSON.stringify(frame)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }
    if (endpoint.endsWith('/fetch')) return new Response(JSON.stringify({ content: 'Publisher page: macrophages modulate pathology.' }));
    return new Response(JSON.stringify({ id: 'chatcmpl-final', object: 'chat.completion', model: 'deepseek-flash',
      choices: [{ message: { role: 'assistant', content: 'Macrophages modulate pathology [S1].' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 70, completion_tokens: 20 } }));
  });
  const events = [];
  for await (const event of adapter.generateWebSearchTextStream({ webSearch: { mode }, webSearchQuestion: question,
    userPrompt: question, maxOutputTokens: 4096, signal: controller.signal })) events.push(event);
  return { requests, events };
}
test('native deep research retrieves pages and returns a strictly bound answer with billed tool counts', async () => {
  const { requests, events } = await run();
  assert.equal(events.at(-1).type, 'completed');
  assert.deepEqual(requests[0].body.tools.map(t => t.type), ['deepseek_web_search', 'deepseek_read_url']);
  assert.equal(requests[0].body.thinking.type, 'enabled');
  assert.equal(requests[0].body.response_format, undefined);
  assert.equal(requests[1].body.url, url);
  assert.equal(events.find(e => e.type === 'usage').usage.webSearchRequests, 2);
  assert.equal(events.find(e => e.type === 'usage').usage.webFetchRequests, 3);
  assert.equal(events.find(e => e.type === 'usage').usage.inputTokens, 170);
  assert.equal(events.find(e => e.type === 'web_grounding').grounding.sources[0].url, url);
  assert.ok(!events.some(e => e.type.startsWith('provider_tool')));
});
test('an explicit URL on ordinary network mode enables URL reading without deep search', async () => {
  const { requests, events } = await run({ mode: 'on', question: 'Read ' + url });
  assert.equal(events.at(-1).type, 'completed');
  assert.deepEqual(requests[0].body.tools, [{ type: 'deepseek_read_url' }]);
  assert.equal(requests[0].body.thinking.type, 'disabled');
});
for (const ending of ['error', 'truncated']) test('native ' + ending + ' cannot be reported as a grounded completion', async () => {
  const { requests, events } = await run({ ending });
  assert.equal(events.at(-1).type, 'error');
  assert.equal(requests.length, 1);
  assert.ok(!events.some(e => e.type === 'web_grounding'));
});
test('cancelled deep research performs no request', async () => {
  const { requests, events } = await run({ cancel: true });
  assert.equal(requests.length, 0);
  assert.equal(events.at(-1).error.code, 'CANCELLED');
});
test('deep mode survives input and filter routing without enabling network in display editing', () => {
  const route = require('../extension/web-filters-general/ux-context.js').route;
  assert.equal(route({ webSearch: { mode: 'deep' } }).webSearch.enabled, true);
  assert.equal(route({ adjusting: true, webSearch: { mode: 'deep' } }).webSearch.enabled, false);
});

test('large native results retain cited sources without violating bounded grounding inputs', async()=>{
 const {requests,events}=await run({large:true});assert.equal(events.at(-1).type,'completed',JSON.stringify(events.at(-1))); 
 const reads=requests.filter(x=>x.endpoint.endsWith('/fetch'));assert.ok(reads.length<=16);assert.ok(reads.every(x=>x.body.url.includes('/cited/')));
});
test('author research fetches a missing current bibliography and grounds direct citation in it',async()=>{
 const title='Brain region-specific susceptibility of Lewy body pathology';
 const prior='https://www.nature.com/articles/prior';let finalPrompt='';const reads=[];
 const adapter=createDeepSeekAdapter({model:'deepseek-flash',apiKey:'fixture'},async(endpoint,init)=>{
  const body=JSON.parse(init.body);
  if(body.tools){const frame=chunk({choices:[{index:0,delta:{content:'Evidence summary',server_tool_calls:[{calls:[{...call,sources:[{url:prior,title,snippet:'Original research'}]}]}]},finish_reason:'stop'}]});return new Response('data: '+JSON.stringify(frame)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
  if(endpoint.endsWith('/fetch')){reads.push(body.url);return new Response(JSON.stringify({content:body.url===url?'# Current paper\n'+ 'Body. '.repeat(500)+'\n## References\n64. '+title+' (2022).\n## Author information\nAuthors':'Original study. '.repeat(300)}));}
  finalPrompt=body.messages[1].content;
  return new Response(JSON.stringify({id:'chat-final',object:'chat.completion',model:'deepseek-flash',choices:[{message:{role:'assistant',content:'| Paper | Year | Relation |\n|---|---|---|\n| '+title+' | 2022 | 直接引用 [S1] [S2] |'},finish_reason:'stop'}]}));
 });
 const events=[];for await(const event of adapter.generateWebSearchTextStream({webSearch:{mode:'deep'},webSearchQuestion:'Author prior work',userPrompt:'Current article without references',authorResearch:{url,title:'Current paper',authors:[],referenceText:''}}))events.push(event);
 assert.equal(events.at(-1).type,'completed',JSON.stringify(events.at(-1)));
 assert.equal(reads.filter(x=>x===url).length,1);
 assert.ok(finalPrompt.includes('CURRENT_ARTICLE_BIBLIOGRAPHY'));
 assert.ok(finalPrompt.includes('64. '+title+' (2022).'));
});
