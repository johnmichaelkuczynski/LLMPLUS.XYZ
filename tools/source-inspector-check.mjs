import assert from 'node:assert/strict';
import express from 'express';
import { pool } from '../server/db.js';
import { registerSourceInspector } from '../server/source-inspector.js';

// Transactional fixtures: no real workspace is read or changed.
const db = await pool.connect();
const app = express();
let userId;
app.use((req, res, next) => { req.userId = userId; next(); });
registerSourceInspector(app, db);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS: ' + name); }
try {
  await db.query('BEGIN');
  const owner = (await db.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  const other = (await db.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  userId = owner;
  const project = (await db.query("INSERT INTO projects(name,user_id) VALUES('Source inspector fixture',$1) RETURNING id", [owner])).rows[0].id;
  const next = (await db.query("INSERT INTO projects(name,user_id) VALUES('Other fixture',$1) RETURNING id", [owner])).rows[0].id;
  const foreign = (await db.query("INSERT INTO projects(name,user_id) VALUES('Foreign fixture',$1) RETURNING id", [other])).rows[0].id;
  const transcript = [
    {role:'user',content:'Surrounding context. Avery is the judge. More original context.'},
    {role:'assistant',content:'An assistant assertion, not a verified fact.', timestamp:'2026-10-01T12:30:00Z'},
    {role:'user',content:'[Attached document: fixture.txt]\nOriginal attachment passage.'},
    {role:'user',content:'Bad timestamp fixture.',timestamp:'not a date'},
    {role:'system',content:'Private system text'}
  ];
  const session = (await db.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
    [project,'Original fixture',JSON.stringify(transcript)])).rows[0].id;
  const text = '😀'.repeat(1300) + 'The original document passage.' + 'z'.repeat(13000);
  const document = (await db.query('INSERT INTO project_documents(project_id,name,raw_content) VALUES($1,$2,$3) RETURNING id',
    [project,'Document fixture',text])).rows[0].id;
  async function get(scope = project, params = {sessionId:session,ordinal:1}) {
    const response = await fetch(base + '/api/projects/' + scope + '/source?' + new URLSearchParams(params));
    return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
  }
  await check('Returns original surrounding user message, without a synthetic timestamp', async () => {
    const r = await get(project,{sessionId:session,ordinal:1,quote:'Avery is the judge.'});
    assert.equal(r.status,200); assert.equal(r.body.passage,transcript[0].content);
    assert.equal(r.body.excerpt,false); assert.equal(r.body.timestamp,null);
    assert.equal(r.body.timestampLabel,'Historical timestamp not recorded');
    assert.match(r.body.attribution,/User report/); assert.equal(r.cache,'no-store');
  });
  await check('Assistant assertions and recorded timestamps are accurately labeled', async () => {
    const r = await get(project,{sessionId:session,ordinal:2});
    assert.equal(r.status,200); assert.match(r.body.attribution,/Assistant assertion/);
    assert.equal(r.body.timestamp,transcript[1].timestamp);
  });
  await check('Attachment provenance and invalid timestamps stay distinct', async () => {
    assert.match((await get(project,{sessionId:session,ordinal:3})).body.attribution,/Attached document text/);
    assert.equal((await get(project,{sessionId:session,ordinal:4})).body.timestamp,null);
    assert.equal((await get(project,{sessionId:session,ordinal:5})).status,404);
  });
  await check('Document excerpts preserve Unicode character offsets and disclose omitted text', async () => {
    const r = await get(project,{documentId:document,offsetChars:1300});
    assert.equal(r.status,200); assert.equal(r.body.startChars,100);
    assert.ok(r.body.passage.includes('The original document passage.'));
    assert.equal(r.body.excerpt,true); assert.match(r.body.location,/page numbers are not preserved/);
    assert.equal(r.body.timestamp,null);
  });
  await check('Rejects malformed, ambiguous, out-of-range, and stale references', async () => {
    for (const params of [
      {sessionId:session,ordinal:0}, {sessionId:'bad',ordinal:1},
      {sessionId:session,ordinal:2147483648},
      {sessionId:session,documentId:document,ordinal:1},
      {documentId:document,offsetChars:-1}
    ]) assert.equal((await get(project,params)).status,400);
    assert.equal((await get(project,{sessionId:session,ordinal:99})).status,404);
    assert.equal((await get(project,{sessionId:session,ordinal:1,quote:'Changed source text'})).status,404);
    assert.equal((await get(project,{documentId:document,offsetChars:999999})).status,404);
  });
  await check('Denies another project even when the requesting user owns both projects', async () => {
    assert.equal((await get(next)).status,404);
    assert.equal((await get(next,{documentId:document})).status,404);
  });
  await check('Denies another user and an unauthenticated request', async () => {
    userId = other;
    const r = await get(); assert.equal(r.status,404); assert.ok(!JSON.stringify(r.body).includes('Avery'));
    assert.equal((await get(project,{documentId:document})).status,404);
    userId = undefined; assert.equal((await get()).status,401);
    userId = owner;
  });
  await check('Moving a chat revokes old-project references immediately', async () => {
    await db.query('UPDATE sessions SET project_id=$1 WHERE id=$2',[next,session]);
    assert.equal((await get()).status,404); assert.equal((await get(next)).status,200);
    await db.query('UPDATE sessions SET project_id=$1 WHERE id=$2',[foreign,session]);
    assert.equal((await get(next)).status,404); assert.equal((await get(foreign)).status,404);
  });
  await check('Deleted chats and deleted or changed documents return unavailable, not cached text', async () => {
    await db.query('DELETE FROM sessions WHERE id=$1',[session]);
    assert.equal((await get()).status,404);
    await db.query("UPDATE project_documents SET raw_content='Replaced passage' WHERE id=$1",[document]);
    assert.equal((await get(project,{documentId:document,quote:'The original document passage.'})).status,404);
    await db.query('DELETE FROM project_documents WHERE id=$1',[document]);
    assert.equal((await get(project,{documentId:document})).status,404);
  });
  console.log(`Source inspector: ${passed} checks passed.`);
} finally {
  await db.query('ROLLBACK');
  db.release();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
