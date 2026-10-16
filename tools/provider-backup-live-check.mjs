import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCredentialRouter } from '../server/provider-credentials.js';

// Inject a rate-limit response only for the primary in this isolated process.
// The backup makes a real request with the existing runtime credential. No
// credentials or application settings are changed or printed.
const attempts=[];
const router=createCredentialRouter({fetchImpl:async(url,options,info)=>{
  if(info.credentialAlias==='AI_INTEGRATIONS_ANTHROPIC_API_KEY') {
    attempts.push({credentialAlias:info.credentialAlias,status:429,simulated:true});
    return new Response('Injected rate limit for an isolated rotation check',{status:429,headers:{'Retry-After':'60'}});
  }
  const response=await fetch(url,options);
  attempts.push({credentialAlias:info.credentialAlias,status:response.status,simulated:false});
  return response;
}});
const health=router.health().find(p=>p.provider==='claude');
assert.ok(health.configuredCredentials>=2,'A second Claude credential is required for this live backup check');
let report;
try {
  const response=await router.fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:'claude-sonnet-4-5-20250929',max_tokens:16,
      messages:[{role:'user',content:'Reply with exactly BACKUP_READY and nothing else.'}]}),
    signal:AbortSignal.timeout(45000)
  });
  const data=await response.json();
  const reply=(data.content || []).map(c=>c.text || '').join('');
  report={primaryFailureInjected:true,attempts,returnedModel:data.model,reply,backupWorking:reply.includes('BACKUP_READY')};
  assert.match(reply,/BACKUP_READY/);
  assert.match(data.model,/^claude-/);
} catch(error) {
  report={primaryFailureInjected:true,attempts,backupWorking:false,error:error.message};
  process.exitCode=1;
}
await fs.mkdir('generated-artifacts',{recursive:true});
await fs.writeFile('generated-artifacts/provider-backup-live-check.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
