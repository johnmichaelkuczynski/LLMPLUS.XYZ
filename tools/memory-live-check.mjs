import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pool } from '../server/db.js';

const base = 'https://'+process.env.REPLIT_DEV_DOMAIN;
const results = [];
const projectIds = [];
async function json(path, body) {
  const res = await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data = await res.json();
  if(!res.ok) throw new Error(path+': '+(data.error || res.status));
  return data;
}
async function chat(sessionId,projectId,model,message) {
  const response = await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionId,projectId,model,message,responseLength:'concise',responseFormat:'prose',stance:'neutral',analysisMode:'moderate'}),
    signal:AbortSignal.timeout(150000)});
  const raw = await response.text();
  let text='',health=null,traceIds=[];
  for(const line of raw.split('\n')) {
    if(!line.startsWith('data:') || line.includes('[DONE]')) continue;
    const e=JSON.parse(line.slice(5));
    if(e.type==='text') text+=e.text;
    if(e.type==='context_health') health=e;
    if(e.type==='context_trace') traceIds=e.traceIds;
    if(e.type==='error') throw new Error(e.error);
  }
  assert.ok(text.trim(),'No assistant response');
  return {text,health,traceIds};
}
function comparisonResult(trace) {
  const data=JSON.parse(trace.response);
  return {model:data.model,usage:data.usage,
    text:(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('')};
}
try {
  const auth=await json('/api/auth/me');
  assert.ok(auth.authenticated && auth.user.id);
  const p=(await pool.query("INSERT INTO projects(name,user_id,tractatus_tree,created_at) VALUES('Memory repair verification',$1,'{}','2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  projectIds.push(p);
  const raw=await fs.readFile("attached_assets/Carolina's_Improper_Contact_Before_Accounting_Hearing_1791911655929.txt",'utf8');
  const history=[...raw.matchAll(/(?:^|\n)(USER|ASSISTANT):\n([\s\S]*?)(?=\n-{20,}\n|$)/g)].map(m=>({role:m[1].toLowerCase(),content:m[2].trim()}));
  const s=(await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
    [p,'Uploaded failure: provider verification',JSON.stringify(history)])).rows[0].id;
  const question='Using my explicit corrections and the actual hearing transcript, answer briefly: Who is David Lease, and who is the trustee? Were the 30-day objection and 60-day response periods already completed? What is established about when Shelton analyzed the document, and what exact date is unknown? Does the hearing transcript guarantee that Lease will be assigned the next hearing? Do not predict outcomes or turn earlier assistant assertions into facts.';
  const previous = process.env.RESUME_MEMORY_LIVE === 'true' ?
    (await pool.query(`SELECT id,metadata FROM context_diagnostics WHERE user_id=$1 AND status='complete'
      AND metadata->>'mode'='full' AND metadata->>'historySnapshotMaxOrdinal'=$2
      ORDER BY created_at DESC LIMIT 1`,[auth.user.id,String(history.length)])).rows[0] : null;
  let actual;
  if(previous) {
    const saved=await json('/api/admin/context-diagnostics/'+previous.id);
    const text=saved.response.split('\n').filter(l=>l.startsWith('data:')).flatMap(l=>{
      try{const e=JSON.parse(l.slice(5));return e.type==='content_block_delta'?[e.delta.text||'']:[];}catch{return[];}
    }).join('');
    actual={text,health:saved.metadata,traceIds:[previous.id]};
  } else actual=await chat(s,p,'claude',question);
  assert.match(actual.text,/Lease.{0,70}judge|judge.{0,70}Lease/is);
  assert.match(actual.text,/Carolina.{0,70}trustee|trustee.{0,70}Carolina/is);
  assert.match(actual.text,/(?:already|completed|elapsed|passed|happened).{0,150}(?:30|60|period)|(?:30|60|period).{0,150}(?:already|completed|elapsed|passed|happened)/is);
  assert.ok(!/whether.{0,70}(?:period|completed|happened).{0,100}(?:not in|unknown)|(?:completion|completed).{0,70}(?:not (?:established|in)|unknown)/is.test(actual.text),
    'A historical transcript must not erase a later explicit completed-period update');
  assert.match(actual.text,/two months|2 months|exact.*(?:date|unknown)|date.*(?:unknown|not|haven)/i);
  assert.match(actual.text,/not guaranteed|does not guarantee|doesn.t guarantee|administrative judge|may.*(?:assign|another)|not.*(?:guarantee|certain)/is);
  results.push({name:'Uploaded failed chat: real repaired Claude response',passed:true,...actual});
  console.log('PASS: Uploaded failed chat / '+actual.health.historyMessagesIncluded+' of '+actual.health.totalMessages+
    ' original messages / preflight '+actual.health.inputTokens+' ('+actual.health.countMethod+')');
  try {
    const existing=(await pool.query(`SELECT id,metadata FROM context_diagnostics WHERE user_id=$1 AND status='complete'
      AND metadata->>'comparisonSourceTrace'=$2 ORDER BY created_at DESC`,[auth.user.id,actual.traceIds[0]])).rows;
    const d=existing.find(t=>t.metadata.purpose==='direct_full_history_comparison');
    const a=existing.find(t=>t.metadata.purpose==='application_request_replay');
    let comparison;
    if(previous && d && a) {
      const direct=await json('/api/admin/context-diagnostics/'+d.id);
      const app=await json('/api/admin/context-diagnostics/'+a.id);
      const params=r=>{const b={...r};delete b.messages;return b;};
      assert.deepEqual(params(direct.request),params(app.request));
      comparison={direct:comparisonResult(direct),application:comparisonResult(app),
        selectedModel:direct.request.model,sameParameters:true,sameSystemPrompt:direct.request.system===app.request.system,
        sameReturnedModel:comparisonResult(direct).model===comparisonResult(app).model,
        fullHistoryMessages:history.length,applicationHistoryMessages:history.length,traceIds:[d.id,a.id],
        note:'Previously completed identical-model comparison reused; no redundant provider calls.'};
    } else comparison=await json('/api/admin/context-comparison',{traceId:actual.traceIds[0],sessionId:s,projectId:p});
    assert.ok(comparison.sameReturnedModel);
    assert.ok(comparison.sameParameters && comparison.sameSystemPrompt);
    assert.match(comparison.direct.text,/Lease.{0,70}judge|judge.{0,70}Lease/is);
    assert.match(comparison.application.text,/Lease.{0,70}judge|judge.{0,70}Lease/is);
    results.push({name:'Same-provider direct/full-history versus application replay',passed:true,...comparison});
    console.log('PASS: Direct/application comparison; same returned model '+comparison.direct.model+
      '; direct input '+(comparison.direct.usage?.input_tokens??comparison.direct.usage?.prompt_tokens)+
      '; application input '+(comparison.application.usage?.input_tokens??comparison.application.usage?.prompt_tokens));
  } catch(err) { results.push({name:'Same-provider direct/full-history versus application replay',passed:false,error:err.message}); console.log('BLOCKED: '+err.message); }
  // New chat, contaminated tree and an unrelated recent tail: only the source
  // ledger can retain the older correction across session boundaries.
  await pool.query('UPDATE projects SET tractatus_tree=$1,compression_count=25 WHERE id=$2',
    [JSON.stringify({'1.0':'ASSERTS: David Lease is a female trustee. Shelton report September 2024.'}),p]);
  const drift=[];
  for(let i=0;i<70;i++) drift.push({role:i%2?'assistant':'user',content:'Unrelated astronomy topic '+i});
  const fresh=(await pool.query('INSERT INTO sessions(project_id,title,transcript,ground_rules) VALUES($1,$2,$3,$4) RETURNING id',
    [p,'Fresh chat after compression',JSON.stringify(drift),'Answer in one paragraph.'])).rows[0].id;
  try {
    const continuity=await chat(fresh,p,'claude','Who is Lease? Is Lease the trustee? Do you have a verified exact date for Shelton’s report?');
    assert.match(continuity.text,/Lease.{0,70}judge|judge.{0,70}Lease/is);
    assert.match(continuity.text,/not.*trustee|trustee.*Carolina|Carolina.*trustee/is);
    assert.match(continuity.text,/unknown|not.{0,50}(?:known|provided|verified|established|confirmed|specified)|no.{0,50}(?:verified|established|confirmed|provided|given|date)|(?:can.t|cannot).{0,50}(?:give|provide|establish)/is);
    results.push({name:'New chat and contaminated compaction: real model continuity',passed:true,...continuity});
    console.log('PASS: Fresh chat retained corrected identities and did not adopt invented report date');
  } catch(err) {
    const t=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[fresh])).rows[0].transcript;
    results.push({name:'New chat and contaminated compaction: real model continuity',passed:false,error:err.message,
      text:t.at(-1).role==='assistant'?t.at(-1).content:null});
    console.log('BLOCKED: Fresh chat check failed; protected evidence retained');
  }
  const small=[{role:'user',content:'Avery is the judge. Blake is the trustee. No forensic report date has been established.'},
    {role:'assistant',content:'Avery is a trustee. The report date is September 2024.'}];
  for(let i=0;i<40;i++) small.push({role:i%2?'assistant':'user',content:'Unrelated gardening discussion '+i});
  for(const model of ['chatgpt','grok','deepseek','venice']) {
    const q=(await pool.query('INSERT INTO projects(name,user_id,tractatus_tree,created_at) VALUES($1,$2,$3,$4) RETURNING id',
      ['Isolated '+model+' memory check',auth.user.id,JSON.stringify({'1.0':'MODEL-INFERENCE: Avery is trustee; report date September 2024.'}),'2000-01-01'])).rows[0].id;
    projectIds.push(q);
    const ss=(await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
      [q,'Provider check',JSON.stringify(small)])).rows[0].id;
    try {
      const answer=await chat(ss,q,model,'Who is Avery? Who is Blake? Give the exact forensic report date only if established by me, not by previous assistant claims.');
      assert.match(answer.text,/Avery.{0,60}judge|judge.{0,60}Avery/is);
      assert.match(answer.text,/Blake.{0,60}trustee|trustee.{0,60}Blake/is);
      assert.match(answer.text,/unknown|no.{0,50}(?:verified|established|confirmed|provided|given|specified|date)|not.{0,50}(?:verified|established|confirmed|provided|given|known|specified)|(?:hasn.t|has not|haven.t|have not).{0,50}(?:established|verified|provided|given|confirmed)|(?:can.t|cannot).{0,50}(?:give|provide|establish)/is);
      const health=await json('/api/sessions/'+ss+'/context-health');
      results.push({name:model+' live source-memory check',passed:true,...answer,health});
      console.log('PASS: '+model+'; actual delivered input '+health.deliveredInputTokens+'; '+health.historyMessagesIncluded+' originals');
    } catch(err) {
      const status=err.message.match(/(?:API error|HTTP)\s*(\d{3})/);
      const safe=status?'Provider HTTP '+status[1]:err.message.includes('key not configured')?'Provider credentials not configured':'Provider check failed; details available in protected owner traces';
      results.push({name:model+' live source-memory check',passed:false,error:safe});
      console.log('BLOCKED/FAILED: '+model+': '+safe);
      const failed=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[ss])).rows[0].transcript;
      if (failed.at(-1).role==='user') {
        assert.equal(failed.at(-1).content,'Who is Avery? Who is Blake? Give the exact forensic report date only if established by me, not by previous assistant claims.');
        results.push({name:model+' failure preserves original input without a fabricated assistant response',passed:true});
      } else {
        results.at(-1).error='Actual model response failed the factual expectation';
        results.at(-1).text=failed.at(-1).content;
      }
    }
  }
  const allTraces=await json('/api/admin/context-diagnostics');
  assert.ok(allTraces.some(t=>actual.traceIds.includes(t.id)));
  const trace=await json('/api/admin/context-diagnostics/'+actual.traceIds[0]);
  assert.equal(trace.request.messages.at(-1).content,question);
  assert.ok(!JSON.stringify(trace).includes('x-api-key'));
  const parsedResponse=trace.response.split('\n').filter(l=>l.startsWith('data:')).map(l=>{
    try{return JSON.parse(l.slice(5));}catch{return null;}
  }).filter(Boolean).filter(e=>e.type==='content_block_delta').map(e=>e.delta.text||'').join('');
  assert.equal(parsedResponse,actual.text,'App substantively rewrote provider response');
  results.push({name:'Owner exact request/response trace: original user text and unmodified model response',passed:true,
    usage:trace.metadata.usage,model:trace.metadata.returnedModel});
  console.log('PASS: Original submission and complete provider response preserved verbatim');
  await fs.mkdir('generated-artifacts',{recursive:true});
  await fs.writeFile('generated-artifacts/memory-live-check.json',JSON.stringify({results},null,2));
  if(results.some(r=>r.passed===false)) process.exitCode=1;
} finally {
  // Preserve encrypted owner traces for inspection while removing only test
  // fixtures. Never touch the user's original legal project or chats.
  for(const p of projectIds) {
    await pool.query('UPDATE context_diagnostics SET project_id=NULL,session_id=NULL WHERE project_id=$1',[p]);
    await pool.query('DELETE FROM projects WHERE id=$1',[p]);
  }
  await pool.end();
}
