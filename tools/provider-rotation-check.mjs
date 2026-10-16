import assert from 'node:assert/strict';
import { createCredentialRouter, CredentialPoolError } from '../server/provider-credentials.js';
import { auditedProviderFetch, contextTrace, decryptTrace } from '../server/context-diagnostics.js';

const tests=[];
const test=(name,run)=>tests.push({name,run});
const native='https://api.anthropic.com/v1/messages';
const body=JSON.stringify({model:'claude-sonnet-4-5-20250929',messages:[{role:'user',content:'Keep this exact original.'}],max_tokens:16,stream:true});
const options={method:'POST',headers:{'x-api-key':'outdated-test-placeholder'},body};
const two={ANTHROPIC_API_KEY:'test-primary-not-real',ANTHROPIC_API_KEY_2:'test-backup-not-real'};

for (const status of [401,402,403,429,500,503]) {
  test(`HTTP ${status} rotates to the next credential without changing model, original body, or stream settings`,async()=>{
    const seen=[];
    const router=createCredentialRouter({environment:()=>two,fetchImpl:async(url,request,info)=>{
      seen.push({url,request,info});
      return new Response(seen.length===1?'unavailable':'working',{status:seen.length===1?status:200});
    }});
    const response=await router.fetch(native,options);
    assert.equal(await response.text(),'working');
    assert.equal(seen.length,2);
    assert.deepEqual(seen.map(x=>x.request.body),[body,body]);
    assert.equal(seen[1].request.headers.get('x-api-key'),two.ANTHROPIC_API_KEY_2);
    assert.equal(seen[1].url,native);
    assert.deepEqual(seen.map(x=>x.info.credentialAlias),['ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_2']);
  });
}
test('A managed Anthropic token stays paired with its proxy; a native backup uses only the native endpoint',async()=>{
  const env={AI_INTEGRATIONS_ANTHROPIC_API_KEY:'test-managed-not-real',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL:'https://proxy.example.test/anthropic',...two};
  const calls=[];
  const router=createCredentialRouter({environment:()=>env,fetchImpl:async(url,request)=>{
    calls.push({url,key:request.headers.get('x-api-key')});
    return new Response('test',{status:calls.length===1?429:200});
  }});
  await router.fetch(env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL+'/v1/messages',options);
  assert.deepEqual(calls,[{url:env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL+'/v1/messages',key:env.AI_INTEGRATIONS_ANTHROPIC_API_KEY},
    {url:native,key:two.ANTHROPIC_API_KEY}]);
});
test('Cooling-down keys are skipped and Retry-After is honored before a key is tried again',async()=>{
  let clock=1000; const calls=[];
  const router=createCredentialRouter({environment:()=>two,now:()=>clock,fetchImpl:async(url,request,info)=>{
    calls.push(info.credentialAlias);
    return new Response('test',{status:info.credentialAlias==='ANTHROPIC_API_KEY'?429:200,headers:{'Retry-After':'120'}});
  }});
  await router.fetch(native,options);
  await router.fetch(native,options);
  assert.deepEqual(calls,['ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_2','ANTHROPIC_API_KEY_2']);
  assert.equal(router.health().find(p=>p.provider==='claude').credentials[0].retryAfterSeconds,120);
  clock+=120000;
  assert.equal(router.health().find(p=>p.provider==='claude').availableCredentials,2);
});
test('An invalid request is not misclassified as a bad key or retried with another credential',async()=>{
  let calls=0;
  const router=createCredentialRouter({environment:()=>two,fetchImpl:async()=>{
    calls++; return new Response('bad request',{status:400});
  }});
  assert.equal((await router.fetch(native,options)).status,400);
  assert.equal(calls,1);
});
test('Duplicate secrets are not retried as independent keys, and numbered keys are ordered numerically',async()=>{
  const env={...two,ANTHROPIC_API_KEY_BACKUP:two.ANTHROPIC_API_KEY,ANTHROPIC_API_KEY_10:'test-tenth-not-real'};
  const router=createCredentialRouter({environment:()=>env});
  assert.deepEqual(router.health().find(p=>p.provider==='claude').credentials.map(x=>x.alias),
    ['ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_2','ANTHROPIC_API_KEY_10']);
});
test('A duplicated proxy token is not forwarded to a native endpoint under a second alias',async()=>{
  const router=createCredentialRouter({environment:()=>({
    AI_INTEGRATIONS_ANTHROPIC_API_KEY:'test-same-not-real',
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL:'https://proxy.example.test/anthropic',
    ANTHROPIC_API_KEY:'test-same-not-real'
  })});
  assert.equal(router.health().find(p=>p.provider==='claude').configuredCredentials,1);
});
test('A real transport failure rotates, but an application or audit database error is not misreported as a bad key',async()=>{
  let sends=0;
  const router=createCredentialRouter({environment:()=>two,fetchImpl:async()=>{
    if (++sends===1) throw new TypeError('fetch failed');
    return new Response('recovered');
  }});
  assert.equal(await(await router.fetch(native,options)).text(),'recovered');
  const broken=createCredentialRouter({environment:()=>two,fetchImpl:async()=>{
    throw Object.assign(new Error('audit database unavailable'),{code:'42P01'});
  }});
  await assert.rejects(broken.fetch(native,options),/audit database unavailable/);
  assert.equal(broken.health().find(p=>p.provider==='claude').availableCredentials,2);
});
test('Exhaustion returns a truthful failure, exposes no credentials, and does not substitute another LLM',async()=>{
  let calls=0;
  const router=createCredentialRouter({environment:()=>({...two,OPENAI_API_KEY:'test-other-provider-not-real'}),fetchImpl:async(url)=>{
    calls++; assert.equal(url,native); return new Response('bad',{status:429});
  }});
  await assert.rejects(router.fetch(native,options),error=>{
    assert.ok(error instanceof CredentialPoolError);
    assert.equal(error.provider,'claude');
    assert.equal(error.status,429);
    assert.ok(error.message.includes('no different model was substituted'));
    assert.ok(!error.message.includes('test-primary'));
    return true;
  });
  assert.equal(calls,2);
  await assert.rejects(router.fetch(native,options),CredentialPoolError);
  assert.equal(calls,2);
  assert.ok(!JSON.stringify(router.health()).includes('test-primary'));
});
test('Stop aborts the pending call without starting the backup or marking the key bad',async()=>{
  const controller=new AbortController(); let calls=0;
  let started;
  const pending=new Promise(resolve=>{started=resolve;});
  const router=createCredentialRouter({environment:()=>two,fetchImpl:async()=>{
    calls++; started(); return new Promise(()=>{});
  }});
  const work=router.fetch(native,{...options,signal:controller.signal});
  await pending;
  controller.abort(new DOMException('Stopped','AbortError'));
  await assert.rejects(work,{name:'AbortError'});
  assert.equal(calls,1);
  assert.equal(router.health().find(p=>p.provider==='claude').availableCredentials,2);
});
test('A successful stream that fails later is never replayed and duplicated',async()=>{
  let calls=0;
  const router=createCredentialRouter({environment:()=>two,fetchImpl:async()=>{
    calls++;
    let reads=0;
    return new Response(new ReadableStream({pull(controller){
      if (!reads++) controller.enqueue(new TextEncoder().encode('partial original answer'));
      else controller.error(new Error('connection lost'));
    }}));
  }});
  const response=await router.fetch(native,options);
  await assert.rejects(response.text(),/connection lost/);
  assert.equal(calls,1);
});
for (const [provider,env,url] of [
  ['chatgpt',{OPENAI_API_KEY:'test-a',OPENAI_API_KEY_2:'test-b'},'https://api.openai.com/v1/chat/completions'],
  ['deepseek',{DEEPSEEK_API_KEY:'test-a',DEEPSEEK_API_KEY_2:'test-b'},'https://api.deepseek.com/chat/completions'],
  ['grok',{XAI_API_KEY:'test-a',GROK_API_KEY:'test-b'},'https://api.x.ai/v1/chat/completions'],
  ['venice',{VENICE_API_KEY:'test-a',VENICE_API_KEY_2:'test-b'},'https://api.venice.ai/api/v1/chat/completions']
]) {
  test(`${provider} rotates its bearer credential without sending Anthropic authentication headers`,async()=>{
    let calls=0;
    const router=createCredentialRouter({environment:()=>env,fetchImpl:async(target,request)=>{
      calls++;
      assert.equal(target,url);
      assert.equal(request.headers.has('x-api-key'),false);
      assert.equal(request.headers.get('authorization'),'Bearer test-'+(calls===1?'a':'b'));
      return new Response('test',{status:calls===1?401:200});
    }});
    assert.equal((await router.fetch(url,options)).status,200);
    assert.equal(calls,2);
  });
}
test('Each rotated attempt has an encrypted exact-body trace with only its credential alias, never its secret',async()=>{
  const original=globalThis.fetch; const recorded=[]; let sends=0;
  const router=createCredentialRouter({environment:()=>two});
  const pool={query:async(sql,params)=>{
    recorded.push({sql,params});
    return {rows:[{id:'trace-'+recorded.length}]};
  }};
  globalThis.fetch=async()=>new Response(++sends===1?'rate-limited':'data: {"usage":{"input_tokens":7}}\n\n',{status:sends===1?429:200});
  try {
    await contextTrace.run({userId:'fixture-user',projectId:'fixture-project',sessionId:'fixture-session',metadata:{},traceIds:[]},async()=>{
      const response=await auditedProviderFetch(pool,native,options,router);
      await response.text();
    });
    const inserts=recorded.filter(x=>x.sql.startsWith('INSERT'));
    assert.equal(inserts.length,2);
    assert.deepEqual(inserts.map(x=>JSON.parse(x.params[4]).credentialAlias),['ANTHROPIC_API_KEY','ANTHROPIC_API_KEY_2']);
    for (const row of inserts) assert.deepEqual(decryptTrace(row.params[5]).request,JSON.parse(body));
    assert.ok(!JSON.stringify(recorded).includes('test-primary-not-real'));
    assert.ok(!JSON.stringify(recorded).includes('test-backup-not-real'));
  } finally {globalThis.fetch=original;}
});

for (const {name,run} of tests) {
  await run();
  console.log('PASS '+name);
}
console.log(tests.length+' credential-rotation checks passed');
