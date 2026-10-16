import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool as databasePool } from '../server/db.js';
import { sourceMemoryHistory, proceduralUpdate, contaminatedTree } from './fixtures/source-memory.mjs';
import { transactionPool } from './fixtures/transaction-pool.mjs';
import { classifyCheckError, preflightExitCode } from './r1/source-memory-preflight.mjs';
import { initContextMemory, ensureProjectIndex, prepareOriginalContext, retrieveEvidence,
  extractClaims, selectOriginalMessages, userInstruction, checkAnswerConsistency } from '../server/context-memory.js';
import { encryptTrace, decryptTrace, readProviderUsage } from '../server/context-diagnostics.js';

const results = [];
let currentCheck = 'Initialize source-memory checks';
async function check(name, fn) {
  currentCheck = name;
  await fn();
  results.push({name,passed:true});
  console.log('PASS: '+name);
}
const ids = {};
let pool, client, transaction = false, status = 'passed', error;
const reportPath = process.env.MEMORY_CONTEXT_REPORT || path.resolve('generated-artifacts/memory-context-check.json');
try {
  await check('Extract source-attributed roles without importing assistant facts',()=>{
    const claims = extractClaims('Avery is the judge. Blake is the trustee.');
    assert.equal(claims.find(c=>c.entity==='Avery').value,'judge');
    assert.equal(claims.find(c=>c.entity==='Blake').value,'trustee');
    assert.ok(claims.every(c=>c.classification==='user_statement'));
  });
  await check('Completed procedural periods have a sourced status, not an inferred date',()=>{
    const claims=extractClaims(proceduralUpdate);
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
  currentCheck = 'Initialize isolated database fixture';
  // One dedicated connection: even termination rolls back all fixture writes.
  client = await databasePool.connect();
  await client.query('BEGIN');
  transaction = true;
  pool = transactionPool(client);
  await pool.query("SET LOCAL statement_timeout='30s'");
  await pool.query("SET LOCAL lock_timeout='5s'");
  await initContextMemory(pool);
  ids.user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  ids.project = (await pool.query("INSERT INTO projects(name,user_id,tractatus_tree) VALUES('Isolated memory regression',$1,'{}') RETURNING id",[ids.user])).rows[0].id;
  const history = sourceMemoryHistory();
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
  await check('Failed indexing rolls back its writes without committing or losing fixtures',async()=>{
    const session = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
      [ids.project,'Failure cleanup regression',JSON.stringify([{role:'user',content:'Morgan is the researcher.'}])])).rows[0].id;
    const failingPool = {...pool, async connect() {
      const nested = await pool.connect();
      return {...nested, async query(sql,...args) {
        // Fail after the message/claim writes, but before the index commits.
        if (sql.startsWith('SELECT d.id, md5')) throw new Error('Synthetic indexing interruption');
        return nested.query(sql,...args);
      }};
    }};
    await assert.rejects(ensureProjectIndex(failingPool,ids.project),/Synthetic indexing interruption/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM memory_messages WHERE session_id=$1',[session])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM sessions WHERE id=$1',[session])).rows[0].n,1);
    await ensureProjectIndex(pool,ids.project);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM memory_messages WHERE session_id=$1',[session])).rows[0].n,1);
    await pool.query('DELETE FROM sessions WHERE id=$1',[session]);
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
  await check('Unknown dates do not require or establish an invented date',()=>{
    assert.ok(evidence.block.includes('There is no verified forensic report date.'));
    assert.ok(!evidence.timeline.some(c=>c.quote.includes('September 2024')));
    assert.ok(!checkAnswerConsistency('The exact report date is unknown.',evidence,[])
      .some(i=>i.kind==='unverified_year'));
  });
  await check('Completed procedural updates survive older pending history',async()=>{
    const e = await retrieveEvidence(pool,ids.project,ids.session,'Were the 30-day objection and 60-day response periods completed?',[]);
    assert.deepEqual(e.timeline.filter(c=>c.kind==='event_status').map(c=>[c.entity,c.value]).sort(),
      [['30-day objection period','completed'],['60-day response period','completed']]);
    assert.ok(e.block.includes('THIS ALREADY HAPPENED'));
    assert.ok(!e.timeline.some(c=>c.kind==='dated_statement'));
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
      [JSON.stringify(contaminatedTree),ids.project]);
    const after = await retrieveEvidence(pool,ids.project,ids.session,'What will Avery do?',[]);
    assert.equal(after.identities.find(c=>c.claim_key==='role:avery').value,'judge');
    assert.ok(after.block.includes('No hearing has occurred'));
  });
  await check('Same-project fresh chat recalls originals despite contaminated compression',async()=>{
    const fresh = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
      [ids.project,'Fresh source-memory regression',JSON.stringify([{role:'user',content:'Let us discuss astronomy.'}])])).rows[0].id;
    const ctx = await prepareOriginalContext({pool,projectId:ids.project,sessionId:fresh,
      message:'Who is Avery? Who is Blake? Were the objection periods completed? What exact report date is verified?',
      system:'Be accurate.',model:'claude',maxOutputTokens:512,countTokens:async()=>10000});
    assert.equal(ctx.evidence.identities.find(c=>c.claim_key==='role:avery').value,'judge');
    assert.equal(ctx.evidence.identities.find(c=>c.claim_key==='role:blake').value,'trustee');
    assert.ok(ctx.evidence.block.includes('THIS ALREADY HAPPENED'));
    assert.ok(ctx.evidence.block.includes('There is no verified forensic report date.'));
    assert.ok(!ctx.evidence.timeline.some(c=>c.quote.includes('September 2024')));
    assert.ok(!ctx.evidence.block.includes('SECRET_OTHER_PROJECT'));
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
  await check('Reusable sanitized corpus preserves complete original-source coverage',async()=>{
    const exported = sourceMemoryHistory();
    assert.ok(exported.length>30);
    const session = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
      [ids.project,'Synthetic source regression',JSON.stringify(exported)])).rows[0].id;
    await ensureProjectIndex(pool,ids.project);
    const e = await retrieveEvidence(pool,ids.project,session,'How will Avery react? Were the objection periods already completed?',[]);
    assert.equal(e.identities.find(c=>c.claim_key==='role:avery').value,'judge');
    assert.ok(e.block.includes('THIS ALREADY HAPPENED'));
    const ctx = await prepareOriginalContext({pool,projectId:ids.project,sessionId:session,
      message:'Who is Avery? Give only established report dates.',system:'Be accurate.',
      model:'claude',maxOutputTokens:512,countTokens:async()=>60000});
    assert.deepEqual(ctx.messages.slice(0,-1),exported);
    assert.equal(ctx.health.omittedMessages,0);
    results.push({name:'Synthetic corpus coverage',passed:true,messages:exported.length,
      characters:exported.reduce((n,m)=>n+m.content.length,0)});
  });
  const baseline = history.slice(0,102).slice(-12).map(m=>m.content.slice(0,5000)).join('\n');
  assert.ok(!baseline.includes('Avery is the judge'));
  results.push({name:'Before/after: basic role survives unrelated topic drift',passed:true,
    before:'Original role absent from former last-12-message window',
    after:'Original user identity retrievable from persistent source ledger'});
  console.log('All '+results.length+' checks passed.');
} catch (err) {
  status = classifyCheckError(err);
  error = err.message;
  results.push({name:currentCheck,passed:false,status,error});
  console.error(status.toUpperCase()+': '+currentCheck+': '+error);
} finally {
  let cleanup = 'not_needed';
  try {
    if (transaction) {
      await client.query('ROLLBACK');
      cleanup = 'rolled_back';
      const remaining = (await pool.query('SELECT id FROM users WHERE id=$1',[ids.user || null])).rows;
      assert.equal(remaining.length,0,'Fixture user must not survive rollback');
    }
  } catch (err) {
    cleanup = 'failed';
    status = 'harness_error';
    error = 'Fixture cleanup failed: '+err.message;
  } finally {
    client?.release();
    await databasePool.end();
  }
  await fs.mkdir(path.dirname(reportPath),{recursive:true});
  await fs.writeFile(reportPath,JSON.stringify({status,error,results,cleanup,
    caveat:'Deterministic source/context checks only. Token counting is stubbed; no live model response or provider availability is claimed.'},null,2));
  process.exitCode = preflightExitCode(status);
}
