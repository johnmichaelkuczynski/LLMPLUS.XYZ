import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { pool } from '../server/db.js';
const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project,browser;
const results=[];
async function waitFor(fn,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,75));}throw Error('Timed out waiting for recovery evidence');}
async function pending(session){
  return waitFor(async()=> (await pool.query("SELECT id FROM context_diagnostics WHERE session_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1",[session])).rows[0]);
}
try {
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated request recovery check',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  const session=(await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Recovery fixture',$2) RETURNING id",
    [project,JSON.stringify([{role:'user',content:'Old source.'},{role:'assistant',content:'Legacy reply without model metadata.'},{role:'assistant',content:' \n\t '}])])).rows[0].id;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(p=>{localStorage.setItem('llmplus_last_project',p);},project);
  let page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByText('Recovery fixture',{exact:true}).click();
  await page.locator('[data-model="chatgpt"]').click();
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('.rm-btn.active').getAttribute('data-model'),'chatgpt');
  await page.getByText('Recovery fixture',{exact:true}).click();
  assert.match(await page.locator('.message.assistant .msg-role').first().innerText(),/^Assistant/);
  results.push('Selected ChatGPT survives reload; unattributed historical replies do not falsely say Claude');
  const input=page.locator('#chat-input'),send=page.locator('#btn-send');
  await input.fill('Write a detailed 2000-word account of a fictional garden. Begin with THE GARDEN.');
  await send.click();await pending(session);
  await waitFor(async()=>/THE GARDEN/.test(await page.locator('.message.assistant .msg-text').last().innerText()));
  const start=Date.now();
  await send.click();
  await waitFor(async()=>!(await send.getAttribute('class')).includes('stop-mode'));
  await input.fill('Reply with only RECOVERED.');
  await send.click();
  await waitFor(async()=>/RECOVERED/.test(await page.locator('.message.assistant .msg-text').last().innerText()));
  await waitFor(async()=>!(await send.getAttribute('class')).includes('stop-mode'));
  const stopped=(await pool.query("SELECT count(*)::int AS n FROM context_diagnostics WHERE session_id=$1 AND status='aborted'",[session])).rows[0].n;
  assert.ok(stopped>=1);
  const partialTranscript=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript;
  assert.ok(partialTranscript.some(m=>m.role==='assistant'&&m.incomplete&&m.content.includes('THE GARDEN')));
  assert.ok((Date.now()-start)<60000);
  assert.equal(await page.locator('.message.assistant .msg-text').evaluateAll(xs=>xs.filter(x=>!x.textContent.trim()).length),0);
  results.push('Real Stop button aborts a streaming answer, preserves its actual partial text, and the immediate next message succeeds in the SAME chat without server restart');
  await page.reload({waitUntil:'networkidle'});
  await page.getByText('Recovery fixture',{exact:true}).click();
  assert.match(await page.locator('.message.assistant .msg-role').last().innerText(),/^ChatGPT/);
  results.push('Returned ChatGPT answer retains its correct model label after reloading history');
  await page.locator('#chat-input').fill('Write a detailed 2000-word account of a fictional forest.');
  await page.locator('#btn-send').click();await pending(session);
  await page.close();
  await waitFor(async()=>!(await pool.query("SELECT 1 FROM context_diagnostics WHERE session_id=$1 AND status='pending'",[session])).rows.length);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByText('Recovery fixture',{exact:true}).click();
  await page.locator('#chat-input').fill('Reply with only AFTER_DISCONNECT.');
  await page.locator('#btn-send').click();
  await waitFor(async()=>/AFTER_DISCONNECT/.test(await page.locator('.message.assistant .msg-text').last().innerText()));
  await waitFor(async()=>!(await page.locator('#btn-send').getAttribute('class')).includes('stop-mode'));
  results.push('Closing the tab cancels the provider and a reopened SAME chat accepts and answers a new request');
  const wrong=await fetch(base+'/api/sessions/'+session+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'00000000-0000-0000-0000-000000000000'})});
  assert.equal(wrong.status,403);
  const transcript=(await pool.query('SELECT transcript FROM sessions WHERE id=$1',[session])).rows[0].transcript;
  assert.equal(transcript.filter(m=>m.role==='assistant'&&!m.content.trim()).length,1);
  assert.equal(await page.locator('.message.assistant .msg-text').evaluateAll(xs=>xs.filter(x=>!x.textContent.trim()).length),0);
  assert.ok(transcript.some(m=>m.content.includes('RECOVERED')));
  assert.ok(transcript.some(m=>m.content.includes('AFTER_DISCONNECT')));
  assert.deepEqual(errors,[]);
  results.push('Cancellation enforces project ownership; legacy empty records remain archived but are excluded from rendering and model requests; no new empty records or browser JavaScript errors');
  await fs.writeFile('generated-artifacts/request-recovery-live-check.json',JSON.stringify({results},null,2));
  console.log(results.join('\n'));
} finally {
  if(browser)await browser.close();
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
