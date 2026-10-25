import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {pool} from '../server/db.js';
let project,browser;
try {
  const base='https://'+process.env.REPLIT_DEV_DOMAIN;
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated incomplete-answer UI',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Incomplete answer fixture',$2::jsonb) RETURNING id",
    [project,JSON.stringify([{role:'user',content:'Explain the evidence.'},{role:'assistant',content:'The available evidence would be',model:'claude',incomplete:true}])])).rows[0].id;
  const health={sessionId:session,projectId:project,status:'incomplete',mode:'full',totalMessages:1,historyMessagesIncluded:1,
    warning:'This answer is incomplete: the provider stopped before finishing it. The partial answer is preserved; you can ask it to continue.',traceIds:[]};
  await pool.query('UPDATE sessions SET context_health=$1::jsonb WHERE id=$2',[JSON.stringify(health),session]);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(id=>localStorage.setItem('llmplus_last_project',id),project);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByText('Incomplete answer fixture',{exact:true}).click();
  await page.getByText('Answer incomplete · partial text preserved',{exact:true}).waitFor();
  assert.match(await page.locator('#context-health-detail').innerText(),/provider stopped before finishing/);
  assert.match(await page.locator('.message.assistant .msg-text').last().innerText(),/available evidence would be/);
  assert.equal(await page.locator('#btn-send').isEnabled(),true);
  assert.equal(await page.locator('#btn-send.stop-mode').count(),0);
  await page.reload({waitUntil:'networkidle'});
  await page.getByText('Incomplete answer fixture',{exact:true}).click();
  await page.getByText('Answer incomplete · partial text preserved',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: Failed completion stays visibly incomplete after reload, preserves partial text, and leaves the composer usable; no model calls or personal-chat changes');
} finally {
  if(browser)await browser.close();
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
