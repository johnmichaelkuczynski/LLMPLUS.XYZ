import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequestLifetime,abortable,releaseGenerationLock } from '../server/request-lifecycle.js';
import { contextTrace,auditedProviderFetch,providerDelay } from '../server/context-diagnostics.js';

let count=0;
async function check(name,fn){await fn();console.log('PASS '+name);count++;}
await check('A fully received POST closing does not cancel its response',async()=>{
  const req=new EventEmitter(),res=new EventEmitter(),life=createRequestLifetime(req,res);
  req.emit('close');assert.equal(life.signal.aborted,false);life.dispose();
});
await check('Closing the response cancels pending work',async()=>{
  const req=new EventEmitter(),res=new EventEmitter(),life=createRequestLifetime(req,res);
  const pending=abortable(()=>new Promise(()=>{}),life.signal);
  res.emit('close');await assert.rejects(pending,{name:'AbortError'});life.dispose();
});
await check('A completed response closing is not a cancellation',async()=>{
  const req=new EventEmitter(),res=new EventEmitter();res.writableEnded=true;
  const life=createRequestLifetime(req,res);res.emit('close');assert.equal(life.signal.aborted,false);life.dispose();
});
await check('Cancellation before work prevents starting it',async()=>{
  const c=new AbortController();c.abort();let started=false;
  await assert.rejects(abortable(()=>{started=true;},c.signal),{name:'AbortError'});assert.equal(started,false);
});
await check('Deadline interrupts an otherwise permanently pending request',async()=>{
  const life=createRequestLifetime(new EventEmitter(),new EventEmitter(),20);
  const keepAlive=setTimeout(()=>{},100);
  await assert.rejects(abortable(()=>new Promise(()=>{}),life.signal),{name:'TimeoutError'});
  clearTimeout(keepAlive);life.dispose();
});
await check('Successful unlock returns a clean connection',async()=>{
  let released;await releaseGenerationLock({query:async()=>({rows:[{unlocked:true}]}),release:x=>{released=x;}},'fixture');
  assert.equal(released,false);
});
await check('Failed unlock destroys its connection rather than pooling a stale lock',async()=>{
  let released;await releaseGenerationLock({query:async()=>{throw Error('connection failed');},release:x=>{released=x;}},'fixture');
  assert.equal(released,true);
});
await check('Provider retry backoff is cancelled immediately',async()=>{
  const c=new AbortController();
  await contextTrace.run({abortSignal:c.signal},async()=>{
    const p=providerDelay(60000);c.abort();await assert.rejects(p,{name:'AbortError'});
  });
});
const originalFetch=globalThis.fetch;
try {
  await check('A provider stalled before headers is interrupted',async()=>{
    const c=new AbortController();globalThis.fetch=()=>new Promise(()=>{});
    await contextTrace.run({abortSignal:c.signal,traceIds:[],metadata:{}},async()=>{
      const pool={query:async sql=>sql.includes('RETURNING id')?{rows:[{id:'fixture'}]}:{rows:[]}};
      const p=auditedProviderFetch(pool,'https://provider.invalid',{body:JSON.stringify({model:'fixture',messages:[]})});
      await new Promise(r=>setImmediate(r));c.abort();await assert.rejects(p,{name:'AbortError'});
    });
  });
  await check('A stalled provider stream is interrupted and marked aborted',async()=>{
    const c=new AbortController();let cancelled=false;
    globalThis.fetch=async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}));
    const trace={abortSignal:c.signal,traceIds:[],metadata:{}};
    await contextTrace.run(trace,async()=>{
      const pool={query:async sql=>sql.includes('RETURNING id')?{rows:[{id:'fixture'}]}:{rows:[]}};
      const response=await auditedProviderFetch(pool,'https://provider.invalid',{body:JSON.stringify({model:'fixture',messages:[]})});
      const p=response.body.getReader().read();c.abort();await assert.rejects(p,{name:'AbortError'});
      assert.equal(cancelled,true);assert.equal(trace.results[0].status,'aborted');
    });
  });
}finally{globalThis.fetch=originalFetch;}
console.log(count+' lifecycle checks passed');
