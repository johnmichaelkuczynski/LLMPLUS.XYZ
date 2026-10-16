import crypto from 'node:crypto';
import { abortable } from './request-lifecycle.js';

const definitions = [
  {id:'claude',label:'Claude',base:'https://api.anthropic.com',prefixes:['ANTHROPIC'],integration:'ANTHROPIC',header:'x-api-key'},
  {id:'chatgpt',label:'ChatGPT',base:'https://api.openai.com',prefixes:['OPENAI'],integration:'OPENAI',header:'authorization'},
  {id:'deepseek',label:'DeepSeek',base:'https://api.deepseek.com',prefixes:['DEEPSEEK'],header:'authorization'},
  {id:'grok',label:'Grok',base:'https://api.x.ai',prefixes:['XAI','GROK'],header:'authorization'},
  {id:'venice',label:'Venice',base:'https://api.venice.ai/api',prefixes:['VENICE'],header:'authorization'}
];

function baseURL(value) { return String(value).replace(/\/+$/,'').replace(/\/v1$/,''); }
function entries(definition, env) {
  const result = [];
  const add = (alias,base) => {
    const key=String(env[alias] || '').trim();
    if (!key || !base) return;
    const entry = {alias,key,base:baseURL(base)};
    entry.identity = crypto.createHash('sha256').update(entry.base+'\0'+entry.key).digest('hex');
    if (!result.some(x=>x.key===entry.key)) result.push(entry);
  };
  const integration = () => {
    if (!definition.integration) return;
    const prefix = 'AI_INTEGRATIONS_'+definition.integration;
    add(prefix+'_API_KEY',env[prefix+'_BASE_URL']);
  };
  if (definition.id==='claude') integration();
  for (const prefix of definition.prefixes) {
    add(prefix+'_API_KEY',definition.base);
    add(prefix+'_API_KEY_BACKUP',definition.base);
    const numbered = Object.keys(env).filter(name=>new RegExp('^'+prefix+'_API_KEY_(?:[2-9]|[1-9][0-9]+)$').test(name))
      .sort((a,b)=>Number(a.split('_').at(-1))-Number(b.split('_').at(-1)));
    for (const alias of numbered) add(alias,definition.base);
  }
  if (definition.id!=='claude') integration();
  return result;
}

function retryAt(response, now) {
  const seconds = response.headers.get('retry-after');
  const milliseconds = response.headers.get('retry-after-ms');
  if (milliseconds!==null && Number.isFinite(Number(milliseconds))) return now+Math.max(1000,Number(milliseconds));
  if (seconds!==null) {
    if (Number.isFinite(Number(seconds))) return now+Math.max(1000,Number(seconds)*1000);
    const date = Date.parse(seconds);
    if (Number.isFinite(date)) return Math.max(now+1000,date);
  }
  return now+([401,402,403].includes(response.status)?300000:response.status===429?60000:15000);
}

export class CredentialPoolError extends Error {
  constructor(definition, count, status, retryAfterSeconds) {
    const reason = status===429?'rate-limited':status===401||status===403?'authentication rejected':
      status===402?'quota or credit unavailable':'temporarily unavailable';
    super(`${definition.label} is ${reason}. ${count>1?'All configured credentials are currently unavailable.':
      'No available backup credential is configured.'} Your message has been retained; no different model was substituted.`);
    this.name = 'CredentialPoolError';
    this.status = status || 503;
    this.provider = definition.id;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createCredentialRouter({environment=()=>process.env,now=()=>Date.now(),fetchImpl=(url,options)=>fetch(url,options)}={}) {
  const states = new Map();
  function pools() { return definitions.map(definition=>({definition,credentials:entries(definition,environment())})); }
  function health() {
    return pools().map(({definition,credentials})=>({
      provider:definition.id,label:definition.label,configuredCredentials:credentials.length,
      availableCredentials:credentials.filter(c=>(states.get(c.identity)?.until || 0)<=now()).length,
      credentials:credentials.map(c=>{
        const state=states.get(c.identity);
        return {alias:c.alias,status:(state?.until || 0)>now()?'cooling_down':
          state?.successAt!==undefined?'last_attempt_succeeded':state?'ready_to_retry':'not_yet_tested',
          lastHttpStatus:state?.status || null,retryAfterSeconds:Math.max(0,Math.ceil(((state?.until || 0)-now())/1000))};
      })
    }));
  }
  async function routedFetch(url, options={}, send=fetchImpl) {
    const all=pools();
    // Match complete configured roots, not loose host substrings. A managed
    // proxy's token must never be forwarded to the provider's native endpoint.
    const matches=[];
    for (const pool of all) {
      for (const root of new Set([baseURL(pool.definition.base),...pool.credentials.map(c=>c.base)])) {
        if (String(url).startsWith(root+'/')) matches.push({pool,root});
      }
    }
    matches.sort((a,b)=>b.root.length-a.root.length);
    if (!matches.length) return send(url,options);
    const {pool,root}=matches[0];
    const suffix=String(url).slice(root.length);
    const {definition,credentials}=pool;
    const ready=credentials.filter(c=>(states.get(c.identity)?.until || 0)<=now());
    // Prefer the last proven key, not a failing primary on every new message.
    ready.sort((a,b)=>(states.get(b.identity)?.successAt || 0)-(states.get(a.identity)?.successAt || 0));
    const signal=options.signal;
    let lastStatus=states.get(credentials[0]?.identity)?.status || 503;
    for (const credential of ready) {
      signal?.throwIfAborted();
      const headers=new Headers(options.headers);
      headers.delete('authorization');
      headers.delete('x-api-key');
      headers.set(definition.header,definition.header==='authorization'?'Bearer '+credential.key:credential.key);
      const target=credential.base+suffix;
      let response;
      try {
        response=await abortable(()=>send(target,{...options,headers},
          {provider:definition.id,credentialAlias:credential.alias}),signal);
      } catch (error) {
        if (signal?.aborted || error.name==='AbortError' || error.name==='TimeoutError') throw error;
        const code=String(error.cause?.code || error.code || '');
        if (!(error instanceof TypeError) && !/^(ECONN|EHOST|ENET|EPIPE|EAI_AGAIN|ETIMEDOUT|UND_ERR)/.test(code)) throw error;
        lastStatus=503;
        states.set(credential.identity,{status:503,until:now()+15000});
        continue;
      }
      if (![401,402,403,408,429].includes(response.status) && response.status<500) {
        if (response.ok) states.set(credential.identity,{status:response.status,until:0,successAt:now()});
        return response;
      }
      lastStatus=response.status;
      states.set(credential.identity,{status:response.status,until:retryAt(response,now())});
      // Drain small error responses so the audit records each real failure.
      // Never replay a successful response after any output has been delivered.
      try {
        await abortable(()=>response.text(),AbortSignal.any([signal,AbortSignal.timeout(5000)].filter(Boolean)));
      } catch (error) {
        if (signal?.aborted) throw error;
        response.body?.cancel().catch(()=>{});
      }
    }
    signal?.throwIfAborted();
    const earliest=credentials.length?Math.min(...credentials.map(c=>states.get(c.identity)?.until || now())):now();
    throw new CredentialPoolError(definition,credentials.length,lastStatus,Math.max(1,Math.ceil((earliest-now())/1000)));
  }
  return {fetch:routedFetch,health,primary:id=>{
    const pool=pools().find(p=>p.definition.id===id);
    return pool?.credentials[0] || null;
  }};
}

export const credentialRouter = createCredentialRouter();
export const rotatingProviderFetch = (url,options,send) => credentialRouter.fetch(url,options,send);
export const providerCredentialHealth = () => credentialRouter.health();
