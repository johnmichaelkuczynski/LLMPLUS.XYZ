import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { abortable } from './request-lifecycle.js';
import { credentialRouter, providerCredentialHealth } from './provider-credentials.js';

export const contextTrace = new AsyncLocalStorage();

export function providerSignal() { return contextTrace.getStore()?.abortSignal; }
export function providerDelay(ms) { return delay(ms,undefined,{signal:providerSignal()}); }

function key() {
  if (!process.env.SESSION_SECRET) throw new Error('Secure context diagnostics require SESSION_SECRET');
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET + ':context-diagnostics').digest();
}

export function encryptTrace(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',key(),iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b => b.toString('base64')).join('.');
}

export function decryptTrace(value) {
  const [iv,tag,encrypted] = value.split('.').map(b => Buffer.from(b,'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm',key(),iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8'));
}

export function readProviderUsage(raw) {
  let usage = {};
  let returnedModel = null;
  const pieces = raw.startsWith('data:') || raw.includes('\ndata:') ?
    raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()) : [raw];
  for (const p of pieces) {
    try {
      const e = JSON.parse(p);
      const u = e.usage || e.message?.usage;
      if (u) usage = {...usage,...u};
      returnedModel = e.model || e.message?.model || returnedModel;
    } catch {}
  }
  return {usage,returnedModel};
}

// Only the request BODY and response BODY are captured. Authorization headers,
// cookies, provider URLs/keys and session secrets are never written to a trace.
export async function auditedProviderFetch(pool,url,options,router=credentialRouter) {
  const signal=AbortSignal.any([options.signal,providerSignal(),AbortSignal.timeout(15*60*1000)].filter(Boolean));
  return router.fetch(url,{...options,signal},(target,settings,credential)=>
    auditedSingleProviderFetch(pool,target,settings,credential));
}

async function auditedSingleProviderFetch(pool,url,options,credential) {
  const trace = contextTrace.getStore();
  const signal=AbortSignal.any([AbortSignal.timeout(15*60*1000),options.signal,providerSignal()].filter(Boolean));
  options={...options,signal};
  if (!trace) return abortable(()=>fetch(url,options),signal);
  const request = JSON.parse(options.body);
  const metadata = {...trace.metadata,purpose:trace.purpose || 'chat',
    requestMessageCount:request.messages?.length || 0,
    requestCharacters:JSON.stringify(request).length,
    maxOutputTokens:request.max_tokens, selectedModel:request.model,
    credentialAlias:credential?.credentialAlias || null};
  const inserted = await pool.query(`INSERT INTO context_diagnostics(user_id,session_id,project_id,model,status,metadata,encrypted_payload)
    VALUES($1,$2,$3,$4,'pending',$5,$6) RETURNING id`,
  [trace.userId,trace.sessionId,trace.projectId,request.model,JSON.stringify(metadata),encryptTrace({request,response:null})]);
  const id = inserted.rows[0].id;
  trace.traceIds.push(id);
  let raw = '';
  let finished = false;
  async function finish(status,error) {
    if (finished) return;
    finished = true;
    const parsed = readProviderUsage(raw);
    trace.results ||= [];
    trace.results.push({id,model:request.model,status,...parsed});
    await pool.query(`UPDATE context_diagnostics SET status=$1,metadata=$2,encrypted_payload=$3 WHERE id=$4`,
      [status,JSON.stringify({...metadata,...parsed,error:error || null}),
        encryptTrace({request,response:raw}),id]);
  }
  let response;
  try { response = await abortable(()=>fetch(url,options),signal); }
  catch (err) { await finish(signal.aborted?'aborted':'network_error',err.message); throw err; }
  if (!response.body) { await finish('empty'); return response; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const next = await abortable(()=>reader.read(),AbortSignal.any([signal,AbortSignal.timeout(90000)]));
        if (next.done) {
          raw += decoder.decode();
          await finish(response.ok?'complete':'provider_error');
          controller.close();
        } else {
          raw += decoder.decode(next.value,{stream:true});
          controller.enqueue(next.value);
        }
      } catch (err) {
        reader.cancel(err).catch(()=>{});
        try { await finish(signal.aborted?'aborted':'stream_error',err.message); } catch {}
        controller.error(err);
      }
    },
    async cancel() { await reader.cancel(); await finish('aborted'); }
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

export function registerContextDiagnostics(app,pool,isOwner) {
  app.get('/api/admin/provider-health',async (req,res) => {
    if (!isOwner(req)) return res.status(403).json({error:'Owner access required'});
    res.set('Cache-Control','no-store');
    res.json({providers:providerCredentialHealth(),modelSubstitution:false});
  });
  app.get('/api/admin/context-diagnostics',async (req,res) => {
    if (!isOwner(req)) return res.status(403).json({error:'Owner access required'});
    res.set('Cache-Control','no-store');
    try {
      const rows = await pool.query(`SELECT id,created_at,model,status,metadata,project_id,session_id
        FROM context_diagnostics WHERE user_id=$1 ORDER BY created_at DESC LIMIT 60`,[req.userId]);
      res.json(rows.rows);
    } catch (err) { res.status(500).json({error:err.message}); }
  });
  app.get('/api/admin/context-diagnostics/:id',async (req,res) => {
    if (!isOwner(req)) return res.status(403).json({error:'Owner access required'});
    res.set('Cache-Control','no-store');
    try {
      const rows = await pool.query(`SELECT * FROM context_diagnostics WHERE id=$1 AND user_id=$2`,[req.params.id,req.userId]);
      if (!rows.rows[0]) return res.status(404).json({error:'Trace not found'});
      const row = rows.rows[0];
      const payload = decryptTrace(row.encrypted_payload);
      delete row.encrypted_payload;
      res.json({...row,...payload});
    } catch (err) { res.status(500).json({error:err.message}); }
  });
}
