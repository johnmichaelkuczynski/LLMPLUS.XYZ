import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pool } from '../server/db.js';
import { initContextMemory, ensureProjectIndex, prepareOriginalContext, retrieveEvidence,
  extractClaims, selectOriginalMessages, userInstruction, checkAnswerConsistency } from '../server/context-memory.js';
import { encryptTrace, decryptTrace, readProviderUsage } from '../server/context-diagnostics.js';

const results = [];
async function check(name, fn) {
  await fn();
  results.push({name,passed:true});
  console.log('PASS: '+name);
}
const ids = {};
try {
  await check('Extract source-attributed roles without importing assistant facts',()=>{
    const claims = extractClaims('David Lease is the judge. Carolina is the trustee.');
    assert.equal(claims.find(c=>c.entity==='David Lease').value,'judge');
    assert.equal(claims.find(c=>c.entity==='Carolina').value,'trustee');
    assert.ok(claims.every(c=>c.classification==='user_statement'));
  });
  await check('Completed procedural periods have a sourced status, not an inferred date',()=>{
    const claims=extractClaims('3. Give you 30 days to file objections\n4. Give trustee 60 days to respond to objections THIS ALREADY HAPPENED');
    const events=claims.filter(c=>c.kind==='event_status');
    assert.deepEqual(events.map(c=>[c.entity,c.value]),
      [['30-day objection period','completed'],['60-day response period','completed']]);
    assert.ok(events.every(c=>c.classification==='user_statement' && c.quote.includes('THIS ALREADY HAPPENED')));
    assert.equal(extractClaims('Have the 30-day objection periods already completed?').find(c=>c.kind==='event_status').classification,'user_question');
  });
  await check('Attachment evidence is not misclassified as a user assertion',()=>{
    const text = '[Attached document: "hearing.txt"]\nAvery is the trustee.\nUser message: Avery is the judge.';
    assert.equal(userInstruction(text),'Avery is the judge.');
    assert.deepEqual(extractClaims(text).map(c=>c.value),['judge']);
  });
  await check('Questions, hypotheses and reported model claims are not established roles',()=>{
    assert.equal(extractClaims('You said Avery is the trustee.')[0].classification,'reported_model_claim');
    assert.equal(extractClaims('Avery is the trustee?')[0].classification,'user_question');
    assert.equal(extractClaims('I think Avery is the trustee.')[0].classification,'user_hypothesis');
  });
  await check('Complete messages retain corrections at their ends',()=>{
    const rows = [{ordinal:1,role:'user',content:'x'.repeat(8000)+' Avery is the judge.',is_correction:true},
      {ordinal:2,role:'assistant',content:'Old mistaken response',is_correction:false}];
    const selected = selectOriginalMessages(rows,9000);
    assert.equal(selected[0].content,rows[0].content);
    assert.ok(selected[0].content.endsWith('Avery is the judge.'));
  });
  await check('History selection preserves original role and chronology',()=>{
    const rows = [1,2,3,4].map(n=>({ordinal:n,role:n%2?'user':'assistant',content:'m'+n,is_correction:n===1}));
    const selected = selectOriginalMessages(rows,1000);
    assert.deepEqual(selected.map(m=>m.content),['m1','m2','m3','m4']);
  });
  await check('Traces encrypt full bodies and expose no encryption key',()=>{
    const value = {request:{model:'same-model',messages:[{role:'user',content:'Original source'}]},response:'Exact response'};
    const encrypted = encryptTrace(value);
    assert.ok(!encrypted.includes('Original source'));
    assert.deepEqual(decryptTrace(encrypted),value);
  });
  await check('Provider token usage is parsed from actual streaming responses',()=>{
    const raw = 'data: {"type":"message_start","message":{"model":"actual-version","usage":{"input_tokens":120}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":35}}\n\n';
    assert.deepEqual(readProviderUsage(raw),{usage:{input_tokens:120,output_tokens:35},returnedModel:'actual-version'});
  });
  await initContextMemory(pool);
  ids.user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  ids.project = (await pool.query("INSERT INTO projects(name,user_id,tractatus_tree) VALUES('Isolated memory regression',$1,'{}') RETURNING id",[ids.user])).rows[0].id;
  const history = [{role:'user',content:'Avery is the judge. Blake is the trustee. There is no verified forensic report date.'},
    {role:'assistant',content:'Avery is the trustee. The report was completed in September 2024.'}];
  for (let n=0;n<100;n++) history.push({role:n%2?'assistant':'user',content:'Unrelated discussion of astronomical observations '+n});
  history.push({role:'user',content:'Correction: Avery is the judge, not the trustee. No hearing has occurred. A status hearing is upcoming.'});
  ids.session = (await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Long regression',$2) RETURNING id",[ids.project,JSON.stringify(history)])).rows[0].id;
  ids.otherProject = (await pool.query("INSERT INTO projects(name,user_id) VALUES('Isolation control',$1) RETURNING id",[ids.user])).rows[0].id;
  await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Unrelated',$2)",[ids.otherProject,JSON.stringify([{role:'user',content:'Avery is the executor. SECRET_OTHER_PROJECT'}])]);
  // A large original source with the relevant passage past the old 300K prefix.
  await pool.query('INSERT INTO project_documents(project_id,name,raw_content) VALUES($1,$2,$3)',
    [ids.project,'Source beyond prefix','unrelated text '.repeat(24000)+'\nAvery said assignment to the next judge remains undecided. No scheduled hearing has occurred.']);
  await check('Backfill indexes every original message, not just the last 12',async()=>{
    await ensureProjectIndex(pool,ids.project);
    const rows = (await pool.query('SELECT role,content FROM memory_messages WHERE session_id=$1 ORDER BY ordinal',[ids.session])).rows;
    assert.deepEqual(rows,history);
  });
  await check('Assistant invented dates never enter the persistent fact ledger',async()=>{
    const rows = (await pool.query('SELECT c.* FROM memory_claims c WHERE session_id=$1',[ids.session])).rows;
    assert.ok(!rows.some(r=>r.quote.includes('September 2024')));
    assert.equal(rows.filter(r=>r.claim_key==='role:avery').at(-1).value,'judge');
  });
  let evidence;
  await check('Retrieve basic identities after 100 unrelated messages',async()=>{
    evidence = await retrieveEvidence(pool,ids.project,ids.session,'What will Avery do?',[]);
    assert.equal(evidence.identities.find(c=>c.claim_key==='role:avery').value,'judge');
    assert.ok(evidence.block.includes('No hearing has occurred'));
  });
  await check('Actual document passages beyond 300K are retrievable',async()=>{
    assert.ok(evidence.block.includes('assignment to the next judge remains undecided'));
    assert.ok(evidence.sources.some(s=>s.kind==='source_document' && s.offsetChars>300000));
  });
  await check('Other projects cannot leak identities or source excerpts',async()=>{
    assert.ok(!evidence.block.includes('SECRET_OTHER_PROJECT'));
    assert.ok(!evidence.identities.some(c=>c.value==='executor'));
  });
  await check('Edited documents invalidate old source chunks even at the same length',async()=>{
    const doc=(await pool.query('INSERT INTO project_documents(project_id,name,raw_content) VALUES($1,$2,$3) RETURNING id',
      [ids.project,'Editable source','Zeta is an old source.'])).rows[0].id;
    await ensureProjectIndex(pool,ids.project);
    await pool.query('UPDATE project_documents SET raw_content=$1 WHERE id=$2',['Zeta is a new source.',doc]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM memory_document_chunks WHERE document_id=$1',[doc])).rows[0].n,0);
    await ensureProjectIndex(pool,ids.project);
    const updated=await retrieveEvidence(pool,ids.project,ids.session,'Zeta',[]);
    assert.ok(updated.block.includes('Zeta is a new source.'));
    assert.ok(!updated.block.includes('Zeta is an old source.'));
  });
  await check('Detect role contradictions without rewriting or suppressing the answer',()=>{
    const issues = checkAnswerConsistency('Avery is the trustee.',evidence,[]);
    assert.equal(issues[0].kind,'identity_conflict');
    assert.equal(issues[0].userEstablishedRole,'judge');
  });
  await check('Flag unsupported years rather than treating model inventions as evidence',()=>{
    const issues = checkAnswerConsistency('The report was completed in 2024.',evidence,[]);
    assert.ok(issues.some(i=>i.kind==='unverified_year' && i.years.includes('2024')));
  });
  await check('Supply complete unmodified history when provider count fits',async()=>{
    const ctx = await prepareOriginalContext({pool,projectId:ids.project,sessionId:ids.session,
      message:'What will Avery do?',system:'Be accurate.',model:'claude',maxOutputTokens:512,
      countTokens:async()=>10000});
    assert.equal(ctx.health.mode,'full');
    assert.deepEqual(ctx.messages.slice(0,-1),history);
    assert.equal(ctx.messages.at(-1).content,'What will Avery do?');
    assert.equal(ctx.health.inputTokens,10000);
  });
  await check('Compaction cannot erase or override original corrections',async()=>{
    await pool.query("UPDATE projects SET tractatus_tree=$1,compression_count=99 WHERE id=$2",
      [JSON.stringify({'1.0':'ASSERTS: Avery is the trustee. Report date September 2024.'}),ids.project]);
    const after = await retrieveEvidence(pool,ids.project,ids.session,'What will Avery do?',[]);
    assert.equal(after.identities.find(c=>c.claim_key==='role:avery').value,'judge');
    assert.ok(after.block.includes('No hearing has occurred'));
  });
  await check('New statements in an older session supersede older working roles',async()=>{
    await pool.query("UPDATE sessions SET created_at='2000-01-01',transcript=transcript||$1::jsonb WHERE id=$2",
      [JSON.stringify([{role:'user',content:'Correction: Blake is the executor now.',timestamp:new Date().toISOString()}]),ids.session]);
    await ensureProjectIndex(pool,ids.project);
    const updated = await retrieveEvidence(pool,ids.project,ids.session,'Blake',[]);
    assert.equal(updated.identities.find(c=>c.claim_key==='role:blake').value,'executor');
    assert.ok(updated.conflicts.some(c=>c.earlier==='trustee'));
  });
  await check('Explicit denial removes an obsolete role without inventing a replacement',async()=>{
    await pool.query("UPDATE sessions SET transcript=transcript||$1::jsonb WHERE id=$2",
      [JSON.stringify([{role:'user',content:'Correction: Blake is not the executor.',timestamp:new Date().toISOString()}]),ids.session]);
    await ensureProjectIndex(pool,ids.project);
    const updated=await retrieveEvidence(pool,ids.project,ids.session,'Blake',[]);
    assert.equal(updated.identities.find(c=>c.claim_key==='role:blake').value,'unknown');
  });
  await check('Move follows session ownership rather than stale denormalized project IDs',async()=>{
    await pool.query('UPDATE sessions SET project_id=$1 WHERE id=$2',[ids.otherProject,ids.session]);
    const old = await retrieveEvidence(pool,ids.project,ids.session,'Avery',[]);
    assert.equal(old.identities.length,0);
    await pool.query('UPDATE sessions SET project_id=$1 WHERE id=$2',[ids.project,ids.session]);
  });
  await check('Use uploaded failed conversation as original-source regression corpus',async()=>{
    const file = await fs.readFile("attached_assets/Carolina's_Improper_Contact_Before_Accounting_Hearing_1791911655929.txt",'utf8');
    const exported = [...file.matchAll(/(?:^|\n)(USER|ASSISTANT):\n([\s\S]*?)(?=\n-{20,}\n|$)/g)]
      .map(m=>({role:m[1].toLowerCase(),content:m[2].trim()}));
    assert.ok(exported.length>30);
    const session = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
      [ids.project,'Uploaded failure regression',JSON.stringify(exported)])).rows[0].id;
    await ensureProjectIndex(pool,ids.project);
    const e = await retrieveEvidence(pool,ids.project,session,'How will Lease react? Were the objection periods already completed?',[]);
    assert.equal(e.identities.find(c=>c.claim_key==='role:lease').value,'judge');
    assert.ok(e.block.includes('THIS ALREADY HAPPENED'));
    const ctx = await prepareOriginalContext({pool,projectId:ids.project,sessionId:session,
      message:'Who is Lease? Give only established report and lawsuit dates.',system:'Be accurate.',
      model:'claude',maxOutputTokens:512,countTokens:async()=>60000});
    assert.deepEqual(ctx.messages.slice(0,-1),exported);
    assert.equal(ctx.health.omittedMessages,0);
    results.push({name:'Uploaded corpus coverage',passed:true,messages:exported.length,
      characters:exported.reduce((n,m)=>n+m.content.length,0)});
  });
  const baseline = history.slice(0,102).slice(-12).map(m=>m.content.slice(0,5000)).join('\n');
  assert.ok(!baseline.includes('Avery is the judge'));
  results.push({name:'Before/after: basic role survives unrelated topic drift',passed:true,
    before:'Original role absent from former last-12-message window',
    after:'Original user identity retrievable from persistent source ledger'});
  console.log('All '+results.length+' checks passed.');
  await fs.mkdir('generated-artifacts',{recursive:true});
  await fs.writeFile('generated-artifacts/memory-context-check.json',JSON.stringify({results,
    caveat:'Token count callback is stubbed in context-selection unit tests; real provider comparisons are separate.'},null,2));
} finally {
  if(ids.project) await pool.query('DELETE FROM projects WHERE id=$1',[ids.project]);
  if(ids.otherProject) await pool.query('DELETE FROM projects WHERE id=$1',[ids.otherProject]);
  if(ids.user) await pool.query('DELETE FROM users WHERE id=$1',[ids.user]);
  await pool.end();
}
