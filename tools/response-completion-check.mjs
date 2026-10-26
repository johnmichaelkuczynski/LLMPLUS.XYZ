import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {directChatPrompt,directOutputBudget} from '../server/direct-chat-prompt.js';
const source=await fs.readFile(new URL('../server/index.js',import.meta.url),'utf8');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS: '+name);}
const start=source.indexOf('function buildSystemPrompt(');
const end=source.indexOf('// Retired policy',start);
assert.ok(start>0&&end>start);
const build=vm.compileFunction(source.slice(start,end)+';return buildSystemPrompt;',
  ['directChatPrompt','selectMemoryString','compactTreeString'])(directChatPrompt,()=> 'MEMORY_CANARY',JSON.stringify);
const prompt=build({}, {tiers:[{}]},'normal','prose',true,null,'neutral',[],'PIN_CANARY','USER_RULE_CANARY','question','moderate');
check('Active prompt preserves pinned context, memory and user-written rules',()=>{
  for(const value of ['MEMORY_CANARY','PIN_CANARY','USER_RULE_CANARY'])assert.ok(prompt.includes(value));
});
check('Active prompt has no blanket source-only restriction or hard 300-word cap',()=>{
  assert.ok(!/ANTI-FABRICATION|PRESSURE NEVER|PAGE NUMBERS DO NOT|HARD CAP|NEVER exceed|FINAL FACTUAL CONSISTENCY/.test(prompt));
});
check('Keep the chosen length, format, stance and analysis controls',()=>{
  const p=directChatPrompt({responseLength:'detailed',responseFormat:'tractatus',stance:'strongly_critical',analysisMode:'mastermind'});
  for(const value of ['Detailed','Tractatus','strongly critical','mastermind'])assert.ok(p.includes(value));
});
check('Normal has output headroom instead of the old 1200-token clamp',()=>{
  assert.equal(directOutputBudget('normal'),8192);
  assert.ok(directOutputBudget('concise')>512);
});
check('No hidden sentence-finishing generation or semantic rewriting remains in ordinary chat',()=>{
  assert.ok(!source.includes('needsResponseCompletion('));
  assert.ok(!source.includes('Finishing the interrupted answer'));
  assert.match(source,/var savedText = fullText;/);
});
check('Both comparison prompts use the same direct builder without hard-cap reminders',()=>{
  const comparison=source.slice(source.indexOf("app.post('/api/chat/compare'"));
  assert.ok(!comparison.includes('FINAL REMINDER — NORMAL MODE'));
  assert.ok(comparison.includes('var systemA = buildSystemPrompt('));
  assert.ok(comparison.includes('var systemB = buildSystemPrompt('));
});
const parserStart=source.indexOf('async function streamOpenAICompatibleCall(');
const parserEnd=source.indexOf('function getLastNWords(',parserStart);
const parserFactory=vm.compileFunction(source.slice(parserStart,parserEnd)+';return streamOneCall;',
  ['modelChoice','callOpenAI','callDeepSeek','callGrok','callVenice','callClaude','systemPrompt','lengthMaxTokens','clientClosed','bufferShortResponse','res']);
const frame=value=>'data: '+JSON.stringify(value);
function response(body){
  const bytes=new TextEncoder().encode(body);
  return new Response(new ReadableStream({start(c){
    for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();
  }}));
}
async function parse(provider,body){
  const call=async()=>response(body);
  return parserFactory(provider,call,call,call,call,call,prompt,8192,false,false,{write(){}})([]);
}
for(const provider of ['chatgpt','deepseek','grok','venice']){
  const text='Unaltered provider output: café.';
  const result=await parse(provider,frame({choices:[{delta:{content:text}}]})+'\n\n'+frame({choices:[{delta:{},finish_reason:'stop'}]}));
  assert.equal(result.segmentText,text);assert.equal(result.stopReason,'end_turn');
  passed++;console.log('PASS: '+provider+' preserves raw text, fragmented UTF-8 and the final frame without a newline');
}
const raw='The selected model’s actual response would be';
const claudeText=frame({type:'content_block_delta',delta:{type:'text_delta',text:raw}});
const actual=await parse('claude',claudeText+'\n\n'+frame({type:'message_delta',delta:{stop_reason:'end_turn'}}));
assert.equal(actual.segmentText,raw);assert.equal(actual.stopReason,'end_turn');
passed++;console.log('PASS: Claude output is preserved verbatim, not automatically completed or rewritten');
for(const provider of ['claude','chatgpt']){
  const body=provider==='claude'?claudeText:frame({choices:[{delta:{content:raw}}]});
  const result=await parse(provider,body);
  assert.equal(result.segmentText,raw);assert.equal(result.stopReason,'stream_interrupted');
  passed++;console.log('PASS: '+provider+' preserves interrupted text without falsely claiming a completed stream');
}
console.log(`${passed} direct-output and stream-integrity checks passed`);
