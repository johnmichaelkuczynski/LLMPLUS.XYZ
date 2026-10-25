import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {looksUnfinished,needsResponseCompletion,joinCompletion,completionMessages} from '../server/response-completion.js';
const source=await fs.readFile(new URL('../server/index.js',import.meta.url),'utf8');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS: '+name);}
const prefix='The original evidence must be distinguished from speculation. '.repeat(8)+'The position would be';
check('Detect a dangling sentence even when the provider says end_turn',()=>{
  assert.equal(needsResponseCompletion('end_turn',prefix,'prose'),true);
  assert.equal(looksUnfinished('The analyst would be'),true);
});
check('Leave short answers, complete prose, lists, code and headings alone',()=>{
  for(const text of ['Yes.','George Washington','It is what it is','## The evidence','```js\nconst a=1;\n```',
    'Evidence is limited. '.repeat(30)+'\n- Court record',
    prefix+' uncertain.'])assert.equal(looksUnfinished(text),false,text);
  assert.equal(needsResponseCompletion('end_turn',prefix,'prose','Reply exactly with the supplied unfinished quotation.'),false);
});
check('Token caps and missing stream endings require completion; safety stops do not trigger expansion',()=>{
  assert.equal(needsResponseCompletion('max_tokens','A complete sentence.'),true);
  assert.equal(needsResponseCompletion('stream_interrupted','Partial output'),true);
  assert.equal(needsResponseCompletion('content_filter',prefix),false);
});
check('Preserve original text and join the missing ending without duplicated overlap',()=>{
  assert.equal(joinCompletion(prefix,' uncertain.'),prefix+' uncertain.');
  assert.equal(joinCompletion(prefix,'uncertain.'),prefix+' uncertain.');
  assert.equal(joinCompletion(prefix,'The position would be uncertain.'),prefix+' uncertain.');
});

const parserStart=source.indexOf('async function streamOpenAICompatibleCall(');
const parserEnd=source.indexOf('function getLastNWords(',parserStart);
assert.ok(parserStart>0&&parserEnd>parserStart);
const parserFactory=vm.compileFunction(source.slice(parserStart,parserEnd)+'; return streamOneCall;',
  ['modelChoice','callOpenAI','callDeepSeek','callGrok','callVenice','callClaude','systemPrompt','lengthMaxTokens','clientClosed','bufferShortResponse','res']);
const frame=data=>'data: '+JSON.stringify(data);
function response(body){
  const bytes=new TextEncoder().encode(body);
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}));
}
async function parse(provider,body){
  const call=async()=>response(body);
  return parserFactory(provider,call,call,call,call,call,'source context',1200,false,false,{write(){}})([]);
}
for(const provider of ['chatgpt','deepseek','grok','venice']) {
  const text='Complete text with unicode: café.';
  const body=frame({choices:[{delta:{content:text}}]})+'\n\n'+frame({choices:[{delta:{},finish_reason:'stop'}]});
  const result=await parse(provider,body);
  assert.equal(result.segmentText,text);assert.equal(result.stopReason,'end_turn');
  passed++;console.log('PASS: '+provider+' parses fragmented UTF-8 and the final frame without a newline');
}
const claudeText=frame({type:'content_block_delta',delta:{type:'text_delta',text:prefix}});
const claudeEnd=frame({type:'message_delta',delta:{stop_reason:'end_turn'}});
const actual=await parse('claude',claudeText+'\n\n'+claudeEnd);
assert.equal(actual.segmentText,prefix);assert.equal(actual.stopReason,'end_turn');
assert.equal(needsResponseCompletion(actual.stopReason,actual.segmentText,'prose'),true);
passed++;console.log('PASS: Actual Claude stream parser reproduces and detects the reported false-finished sentence');
for(const provider of ['claude','chatgpt']){
  const partial=provider==='claude'?claudeText:frame({choices:[{delta:{content:prefix}}]});
  const result=await parse(provider,partial);
  assert.equal(result.segmentText,prefix);assert.equal(result.stopReason,'stream_interrupted');
  passed++;console.log('PASS: '+provider+' never treats an abruptly closed stream as a completed answer');
}

// Execute the production route's completion block, not a reimplemented policy.
const blockStart=source.indexOf('// At most ONE short repair:');
const blockEnd=source.indexOf('if(outputIncomplete)',blockStart);
assert.ok(blockStart>0&&blockEnd>blockStart);
const execute=vm.compileFunction(`return (async()=>{
  var clientClosed=closed, fullText=initial.segmentText, lastResult=initial;
  var lengthMaxTokens=1200, bufferShortResponse=false, trace=null, calls=0, events=[];
  var msgs=[{role:'user',content:'Original source and question, unchanged.'}];
  var responseFormat='prose', userOwnWords='', systemPrompt='Normal: stay concise.', modelChoice='claude';
  var CONTEXT_LIMITS={claude:200000}, reliableContext={metadata:{}};
  var conservativeTokenEstimate=()=>estimated;
  var res={write:event=>events.push(event)};
  async function streamOneCall(messages){
    calls++; assert.equal(lengthMaxTokens,512); assert.equal(bufferShortResponse,true);
    assert.equal(messages[0],msgs[0]);
    assert.equal(messages.at(-2).content,fullText);
    assert.match(messages.at(-1).content,/STOP within 80 words/);
    if(addition.fail) {
      const error=new Error('Fixture provider disconnected');
      error.partialResponse=addition.segmentText;
      throw error;
    }
    return addition;
  }
  try { ${source.slice(blockStart,blockEnd)} }
  catch(error){return {calls,fullText,events,errorPartial:error.partialResponse,lengthMaxTokens,bufferShortResponse};}
  return {calls,fullText,events,outputIncomplete,lengthMaxTokens,bufferShortResponse};
})();`,['initial','addition','closed','estimated','assert','needsResponseCompletion','joinCompletion','completionMessages']);
async function finish(initial,addition,closed=false,estimated=100){
  return execute(initial,addition,closed,estimated,assert,needsResponseCompletion,joinCompletion,completionMessages);
}
const repaired=await finish(actual,{segmentText:' uncertain.',stopReason:'end_turn'});
assert.equal(repaired.calls,1);assert.equal(repaired.fullText,prefix+' uncertain.');
assert.equal(repaired.outputIncomplete,false);
assert.equal(repaired.lengthMaxTokens,1200);assert.equal(repaired.bufferShortResponse,false);
assert.match(repaired.events.join(''),/replace_text/);
passed++;console.log('PASS: Production route finishes the false end_turn with ONE bounded call and preserves the entire original');
const capped=await finish({segmentText:prefix,stopReason:'max_tokens'},{segmentText:' uncertain.',stopReason:'end_turn'});
assert.equal(capped.calls,1);assert.equal(capped.outputIncomplete,false);
passed++;console.log('PASS: Normal token-limit cutoff gets a short ending, not an unbounded essay');
const stillPartial=await finish(actual,{segmentText:' uncertain because',stopReason:'end_turn'});
assert.equal(stillPartial.calls,1);assert.equal(stillPartial.outputIncomplete,true);
passed++;console.log('PASS: A failed finishing attempt stays explicitly incomplete; it cannot loop forever');
const noRoom=await finish(actual,{segmentText:' unused',stopReason:'end_turn'},false,200000);
assert.equal(noRoom.calls,0);assert.equal(noRoom.outputIncomplete,true);
const stopped=await finish({segmentText:prefix,stopReason:'aborted'},{},true);
assert.equal(stopped.calls,0);assert.equal(stopped.outputIncomplete,false);
const complete=await finish({segmentText:'A complete answer.',stopReason:'end_turn'},{});
assert.equal(complete.calls,0);assert.equal(complete.outputIncomplete,false);
passed++;console.log('PASS: Preserve source budgets and user Stop; already complete answers make no extra provider call');
const failed=await finish(actual,{segmentText:'uncertain because',fail:true});
assert.equal(failed.calls,1);assert.equal(failed.fullText,prefix+' uncertain because');
assert.equal(failed.errorPartial,'');assert.equal(failed.bufferShortResponse,false);
assert.equal(failed.lengthMaxTokens,1200);
passed++;console.log('PASS: Disconnect during finishing preserves the partial ending without duplicating or merging words');
console.log(`${passed} completion checks passed`);
