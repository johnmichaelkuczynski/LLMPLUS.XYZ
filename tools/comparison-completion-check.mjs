import assert from 'node:assert/strict';
import { runComparisonLane, streamComparisonResponse } from '../server/comparison-lane.js';
import { createRequestLifetime } from '../server/request-lifecycle.js';
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { directOutputBudget } from '../server/direct-chat-prompt.js';

const frame = event => 'data: ' + JSON.stringify(event);
const prefix = 'The evidence suggests caution. '.repeat(8) + 'The position would be';
function response(model, text, reason = 'end_turn', fail = false) {
  const events = model === 'claude' ?
    [{type:'content_block_delta',delta:{type:'text_delta',text}},
      ...(reason ? [{type:'message_delta',delta:{stop_reason:reason}}] : [])] :
    [{choices:[{delta:{content:text}}]},
      ...(reason ? [{choices:[{delta:{},finish_reason:reason === 'end_turn' ? 'stop' :
        reason === 'max_tokens' ? 'length' : reason}]}] : [])];
  if (fail) events.push({error:{message:'Synthetic stream failure'}});
  const bytes = new TextEncoder().encode(events.map(frame).join('\n\n'));
  return new Response(new ReadableStream({start(c) {
    for (let i=0;i<bytes.length;i+=3) c.enqueue(bytes.slice(i,i+3));
    c.close();
  }}));
}
let checks = 0;
async function trial(model, lane, initial, ending, options={}) {
  const calls=[], events=[], controller = new AbortController();
  const messages=[{role:'user',content:'Synthetic source: only caution is warranted.'}];
  const result = await runComparisonLane({
    lane,model,messages,system:'Original source and stance '+lane,maxTokens:1200,format:'prose',
    request:options.request || 'Explain the evidence.',openAI:model !== 'claude',
    signal:controller.signal,send:event=>events.push(event),
    canFit:(received, system, budget)=>{
      assert.deepEqual(received.slice(0,1),messages);
      assert.equal(system,'Original source and stance '+lane);
      assert.equal(budget,256);
      return options.room !== false;
    },
    call:async(received,system,stream,budget)=>{
      calls.push({received,system,stream,budget});
      if (calls.length===2 && options.stop) controller.abort();
      if (calls.length===2 && options.reject) throw new Error('Synthetic ending failure');
      const item=calls.length===1?initial:ending;
      assert.ok(item,'No unexpected extra provider calls');
      return response(model,...item);
    }
  });
  assert.ok(calls.length<=2);
  assert.ok(events.every(e=>e.lane===lane && e.model===model));
  assert.equal(events.filter(e=>e.type==='lane_end').length,options.stop?0:1);
  if(calls.length===2) {
    assert.equal(calls[1].budget,256);
    assert.deepEqual(calls[1].received.slice(0,messages.length),messages);
    assert.match(calls[1].received.at(-1).content,/within 80 words/);
  }
  checks++;
  return {...result,calls,events};
}
for(const model of ['claude','chatgpt','deepseek','grok','venice']) {
  for(const lane of ['A','B']) {
    for(const reason of ['max_tokens',null,'end_turn']) {
      const t=await trial(model,lane,[prefix,reason],[' uncertain.','end_turn']);
      assert.equal(t.status,'completed');assert.equal(t.calls.length,2);
      assert.equal(t.text,prefix+' uncertain.');
    }
    const complete=await trial(model,lane,['Complete café answer.','end_turn']);
    assert.equal(complete.calls.length,1);assert.equal(complete.status,'completed');
    const failed=await trial(model,lane,[prefix,'max_tokens'],[' uncertain because','end_turn']);
    assert.equal(failed.status,'incomplete');assert.equal(failed.calls.length,2);
    const budget=await trial(model,lane,[prefix,null],null,{room:false});
    assert.equal(budget.status,'incomplete');assert.equal(budget.calls.length,1);
    const exact=await trial(model,lane,[prefix,'end_turn'],null,{request:'Reply exactly with this quotation'});
    assert.equal(exact.status,'completed');assert.equal(exact.calls.length,1);
    const exactCap=await trial(model,lane,[prefix,'max_tokens'],null,{request:'Reply exactly with this quotation'});
    assert.equal(exactCap.status,'incomplete');assert.equal(exactCap.calls.length,1);
    const safety=await trial(model,lane,[prefix,'content_filter']);
    assert.equal(safety.status,'incomplete');assert.equal(safety.calls.length,1);
    const partial=await trial(model,lane,[prefix,'max_tokens'],[' uncertain',null,true]);
    assert.equal(partial.status,'incomplete');assert.equal(partial.text,prefix+' uncertain');
    const rejected=await trial(model,lane,[prefix,null],['unused'],{reject:true});
    assert.equal(rejected.status,'incomplete');assert.equal(rejected.text,prefix);
    const empty=await trial(model,lane,[prefix,'max_tokens'],['','end_turn']);
    assert.equal(empty.status,'incomplete');
    const stopped=await trial(model,lane,[prefix,'max_tokens'],['unused'],{stop:true});
    assert.equal(stopped.status,'cancelled');
  }
  console.log('PASS: '+model+' both lanes: fragmented UTF-8, unterminated final frames, bounded endings, failures, exact output, budgets and Stop');
}

// Hold B while A repairs; one lane's ending must never contaminate the other.
const pair=await Promise.all([
  trial('claude','A',[prefix,'max_tokens'],[' uncertain.','end_turn']),
  trial('claude','B',['Independent B answer.','end_turn'])
]);
assert.equal(pair[0].calls.length,2);assert.equal(pair[1].calls.length,1);
assert.equal(pair[1].text,'Independent B answer.');
console.log('PASS: Concurrent lanes retain independent text, call counts and terminal state');

// A stopped stalled reader must return without waiting for the next provider byte.
const controller=new AbortController();
let cancelled=false;
const stalled=new Response(new ReadableStream({cancel(){cancelled=true;}}));
const reading=streamComparisonResponse(stalled,{openAI:true,signal:controller.signal});
controller.abort(new DOMException('Stopped','AbortError'));
await assert.rejects(reading,{name:'AbortError'});
assert.equal(cancelled,true);
const req=new EventEmitter(), res=new EventEmitter();
res.writableEnded=false;
const lifetime=createRequestLifetime(req,res);
req.emit('close');assert.equal(lifetime.signal.aborted,false);
res.emit('close');assert.equal(lifetime.signal.aborted,true);
lifetime.dispose();
console.log('PASS: Stop cancels stalled provider reads; ordinary POST close is not a disconnect');

// Exercise the actual Express handler too, with every DB/provider dependency synthetic.
const source=await readFile(new URL('../server/index.js',import.meta.url),'utf8');
const start=source.indexOf("app.post('/api/chat/compare',");
const end=source.indexOf('\nasync function loadIdeaDiaryContext',start);
assert.ok(start>0 && end>start);
const traces=new AsyncLocalStorage(), captured=[], budgets=[];
const request=new EventEmitter(), output=new EventEmitter();
request.userId='fixture-owner';
request.body={sessionId:'fixture-session',projectId:'fixture-project',message:'Explain the evidence.',
  stanceA:'neutral',stanceB:'mildly_critical',model:'deepseek',responseLength:'normal'};
output.setHeader=()=>{};output.flushHeaders=()=>{};
output.write=text=>{captured.push(text);};output.end=()=>{output.writableEnded=true;};
let handler;
const context={
  app:{post(path,fn){assert.equal(path,'/api/chat/compare');handler=fn;}},
  createRequestLifetime,contextTrace:traces,runComparisonLane,setInterval,clearInterval,
  console:{log(){},error(){}},MAX_TOKENS:16384,CONTEXT_LIMITS:{deepseek:65536},
  directOutputBudget,
  normalizeAnalysisMode:()=> 'moderate',verifySessionInProject:async()=>true,
  pool:{query:async()=>({rows:[{tractatus_tree:{},pinned_context:'',ground_rules:''}]})},
  loadTieredMemory:async()=>({}),loadRecentTranscript:async()=>[],
  getArchiveStats:async()=>({}),computeMemoryHealthFromData:()=>({}),
  loadAuditLessons:async()=>[],
  buildSystemPrompt:(...args)=>'Synthetic original context. Stance: '+args[6],
  groundRulesFinalReminder:()=>'',extractRequestedWordCount:()=>0,
  countClaudeInput:()=>{},countGrokInput:()=>{},
  prepareOriginalContext:async options=>{
    assert.equal(options.signal.aborted,false);
    return {messages:[{role:'user',content:request.body.message}],system:options.system,
      metadata:{source:'synthetic'},health:{},evidence:[]};
  },
  conservativeTokenEstimate:()=>1000,checkAnswerConsistency:()=>[],
};
const laneCalls=new Map();
const provider=async(messages,system,stream,budget)=>{
  const lane=system.includes('mildly_critical')?'B':'A';
  const trace=traces.getStore();
  assert.equal(trace.metadata.lane,lane);
  assert.equal(trace.abortSignal.aborted,false);
  const count=(laneCalls.get(lane)||0)+1;
  laneCalls.set(lane,count);budgets.push({lane,budget});
  if(lane==='B')return response('deepseek','Independent B café.','end_turn');
  return count===1?response('deepseek',prefix,'max_tokens'):
    response('deepseek',' uncertain because','end_turn');
};
for(const name of ['callClaude','callOpenAI','callGrok','callVenice'])
  context[name]=()=>{throw new Error('Wrong model selected');};
context.callDeepSeek=provider;
vm.runInNewContext(source.slice(start,end),context);
await traces.run({metadata:{},traceIds:[],results:[]},()=>handler(request,output));
const events=captured.join('').split('\n').filter(line=>line.startsWith('data: {'))
  .map(line=>JSON.parse(line.slice(6)));
assert.equal(events.find(e=>e.type==='error')?.error,undefined,'Actual route error: '+captured.join(''));
assert.equal(events.find(e=>e.type==='lane_end'&&e.lane==='A').status,'incomplete');
assert.equal(events.find(e=>e.type==='lane_end'&&e.lane==='B').status,'completed');
assert.equal(laneCalls.get('A'),2);assert.equal(laneCalls.get('B'),1);
assert.deepEqual(budgets.filter(b=>b.lane==='A').map(b=>b.budget),[directOutputBudget('normal'),256]);
assert.ok(captured.join('').endsWith('data: [DONE]\n\n'));
assert.equal(output.writableEnded,true);
console.log('PASS: Actual comparison route preserves per-lane completion, budgets, cancellation signals and model/trace attribution');
console.log(`${checks} synthetic comparison lane checks passed; no database or real provider used`);
