import assert from 'node:assert/strict';
import { pool } from '../server/db.js';
const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project,blocker,inTransaction=false,browser;
try {
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated index-stop fixture',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Index-stop fixture','[]') RETURNING id",[project])).rows[0].id;
  if(!process.argv.includes('--auth-ui-only')) {
  blocker=await pool.connect();await blocker.query('BEGIN');inTransaction=true;
  await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('context-index:'||$1::text,0))",[project]);
  const first=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({projectId:project,sessionId:session,model:'chatgpt',message:'This original submission must survive Stop during indexing.'}),
    signal:AbortSignal.timeout(15000)});
  const firstBody=first.text();
  const end=Date.now()+7000;
  while(Date.now()<end) {
    const row=(await pool.query('SELECT jsonb_array_length(transcript) AS n FROM sessions WHERE id=$1',[session])).rows[0];
    if(row.n===1)break;
    await new Promise(r=>setTimeout(r,50));
  }
  await new Promise(r=>setTimeout(r,300));
  const start=Date.now();
  const stopped=await(await fetch(base+'/api/sessions/'+session+'/cancel',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project}),signal:AbortSignal.timeout(7000)
  })).json();
  assert.equal(stopped.released,true);
  assert.ok(Date.now()-start<5000,'Indexing cancellation must not wait for the index lock');
  await firstBody;
  await blocker.query('COMMIT');inTransaction=false;
  const second=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({projectId:project,sessionId:session,model:'chatgpt',message:'Reply with exactly AFTER_INDEX_STOP and nothing else.'}),
    signal:AbortSignal.timeout(60000)});
  const raw=await second.text();
  assert.match(raw,/AFTER_INDEX_STOP/);
  assert.ok(!raw.includes('generation_busy'));
  const transcript=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript;
  assert.ok(transcript.some(m=>m.role==='user'&&m.content==='This original submission must survive Stop during indexing.'));
  assert.ok(transcript.some(m=>m.role==='assistant'&&m.content.includes('AFTER_INDEX_STOP')));
  console.log('PASS: Stop interrupts blocked memory indexing, preserves the original question, releases the chat, and the next real answer succeeds in the SAME chat');
  }

  const {chromium}=await import('playwright');
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(p=>localStorage.setItem('llmplus_last_project',p),project);
  const page=await context.newPage();
  let authChecks=0;
  await page.route('**/api/auth/me',route=>{
    authChecks++;
    return route.fulfill({status:authChecks===1?503:200,contentType:'application/json',
      body:JSON.stringify(authChecks===1?{error:'Injected transient auth lookup failure'}:{authenticated:true,user:auth.user})});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#btn-google-login').filter({hasText:'Rechecking sign-in…'}).waitFor();
  await page.locator('#btn-google-login').filter({hasText:'Signed in'}).waitFor({timeout:10000});
  await page.locator('[data-testid="project-'+project+'"]').waitFor();
  assert.equal(authChecks,2);
  assert.equal(await page.locator('#btn-google-login').textContent(),'Signed in');
  assert.equal(await page.locator('.sidebar-access-btn[href="/api/auth/google"]').textContent(),'Signed in');
  console.log('PASS: A temporary authentication failure retries successfully without reporting logout or leaving the Google Login label on a signed-in session');
}finally{
  if(browser)await browser.close();
  if(inTransaction)await blocker.query('ROLLBACK');
  blocker?.release();
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
