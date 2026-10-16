import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pool } from '../server/db.js';

const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project;
try {
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated credential recovery check',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Credential recovery fixture','[]') RETURNING id",[project])).rows[0].id;
  const response=await fetch(base+'/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({projectId:project,sessionId:session,model:'claude',responseLength:'super_concise',
      message:'Reply with exactly ROTATION_CONFIRMED and nothing else.'}),
    signal:AbortSignal.timeout(90000)
  });
  const raw=await response.text();
  const events=raw.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{
    try {return [JSON.parse(line.slice(6))];} catch {return [];}
  });
  const traces=(await pool.query(`SELECT model,status,metadata FROM context_diagnostics
    WHERE session_id=$1 ORDER BY created_at`,[session])).rows;
  const stored=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript;
  const health=await(await fetch(base+'/api/admin/provider-health')).json();
  const report={reply:events.filter(e=>e.type==='text').map(e=>e.text).join(''),
    errors:events.filter(e=>e.type==='error').map(e=>e.error),traces:traces.map(t=>({
      model:t.model,status:t.status,credentialAlias:t.metadata.credentialAlias,returnedModel:t.metadata.returnedModel
    })),claudeHealth:health.providers.find(p=>p.provider==='claude')};
  await fs.mkdir('generated-artifacts',{recursive:true});
  await fs.writeFile('generated-artifacts/provider-rotation-live-check.json',JSON.stringify(report,null,2));
  assert.deepEqual(report.errors,[],JSON.stringify(report));
  assert.match(report.reply,/ROTATION_CONFIRMED/);
  assert.ok(stored.some(m=>m.role==='assistant'&&m.model==='claude'&&m.content.includes('ROTATION_CONFIRMED')));
  assert.ok(traces.some(t=>t.status==='complete'&&t.model.startsWith('claude-')));
  console.log(JSON.stringify(report,null,2));
  console.log('PASS: Real Claude request succeeded without switching models; exact returned text and actual credential aliases verified.');
} finally {
  if(project) await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
