import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pool } from '../server/db.js';
import { acquireChatLease } from '../server/chat-lease.js';

const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project,browser,lease;
try {
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated reopened-chat recovery',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Reopened recovery fixture','[]') RETURNING id",[project])).rows[0].id;
  const controller=new AbortController();
  lease=await acquireChatLease(pool,session,{signal:controller.signal,stop:()=>controller.abort()},{heartbeatMs:25});
  controller.signal.addEventListener('abort',()=>{lease.release().catch(()=>{});},{once:true});
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(id=>localStorage.setItem('llmplus_last_project',id),project);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByText('Reopened recovery fixture',{exact:true}).click();
  await page.locator('#btn-send.stop-mode').waitFor({timeout:10000});
  assert.equal(await page.locator('#btn-send').getAttribute('aria-label'),'Stop earlier response');
  const status=await(await fetch(base+'/api/sessions/'+session+'/context-health')).json();
  assert.equal(status.sessionId,session);
  assert.equal(status.projectId,project);
  assert.equal(status.activeResponse.active,true);
  assert.equal(status._generation,undefined,'A browser does not need the private ownership token');
  await page.locator('#btn-send').click();
  await page.waitForFunction(()=>!document.querySelector('#btn-send').classList.contains('stop-mode'));
  assert.equal(controller.signal.aborted,true,'The other worker must observe cancellation');
  await page.locator('[data-model="chatgpt"]').click();
  await page.locator('#chat-input').fill('Reply with only REOPENED_CHAT_RECOVERED.');
  await page.locator('#btn-send').click();
  await page.locator('.message.assistant .msg-text').filter({hasText:'REOPENED_CHAT_RECOVERED'}).last().waitFor({timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('#btn-send').classList.contains('stop-mode'));
  const transcript=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript;
  assert.ok(transcript.some(m=>m.role==='assistant'&&m.content.includes('REOPENED_CHAT_RECOVERED')));
  assert.deepEqual(errors,[]);
  console.log('PASS: A reopened chat exposes Stop for a response owned by another worker, cancels it, and immediately receives a real answer in the SAME chat');
} finally {
  if(browser)await browser.close();
  if(lease)await lease.release().catch(()=>{});
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
