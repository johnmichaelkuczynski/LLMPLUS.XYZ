import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {pool} from '../server/db.js';
const base='https://'+process.env.REPLIT_DEV_DOMAIN;
let project,browser;
try{
  const auth=await(await fetch(base+'/api/auth/me')).json();
  project=(await pool.query("INSERT INTO projects(name,user_id,created_at) VALUES('Isolated browser stream check',$1,'2000-01-01') RETURNING id",[auth.user.id])).rows[0].id;
  await pool.query("INSERT INTO sessions(project_id,title,transcript) VALUES($1,'Browser stream fixture','[]')",[project]);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  await context.addInitScript(id=>{
    localStorage.setItem('llmplus_last_project',id);
    // Reproduce background/hidden iframe animation throttling deterministically.
    window.requestAnimationFrame=()=>1;
    window.cancelAnimationFrame=()=>{};
    window.__fixtureCase='held-open';
    window.__fixtureCancels=0;
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,options)=>{
      if(new URL(typeof input==='string'?input:input.url,location.href).pathname!=='/api/chat')
        return originalFetch(input,options);
      const first='First received fragment: café ';
      const full=first+'is displayed immediately, and the saved ending is also visible. FINISHED_BROWSER_STREAM.';
      const frame=value=>'data: '+JSON.stringify(value);
      const bytes=new TextEncoder();
      const kind=window.__fixtureCase;
      const stream=new ReadableStream({
        start(controller){
          if(kind==='held-open'){
            controller.enqueue(bytes.encode(frame({type:'text',text:first})+'\n\n'));
            window.__releaseFixture=()=>{
              controller.enqueue(bytes.encode(frame({type:'answer_complete',text:full,incomplete:false})+'\n\ndata: [DONE]\n\n'));
              // Deliberately never close: DONE must release the UI itself.
            };
          }else if(kind==='last-frame'){
            const wire=bytes.encode(frame({type:'text',text:first})+'\n\n'+frame({type:'answer_complete',text:full,incomplete:false}));
            for(let i=0;i<wire.length;i+=7)controller.enqueue(wire.slice(i,i+7));
            controller.close();
          }else{
            controller.enqueue(bytes.encode(frame({type:'text',text:first+'would be'})));
            controller.close();
          }
        },
        cancel(){window.__fixtureCancels++;}
      });
      return Promise.resolve(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}));
    };
  },project);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByText('Browser stream fixture',{exact:true}).click();
  const send=async text=>{await page.locator('#chat-input').fill(text);await page.locator('#btn-send').click();};
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#btn-send').classList.contains('stop-mode'),{},{timeout:5000});
  await send('Synthetic held-open stream check');
  await page.locator('.message.assistant .msg-text').last().filter({hasText:'First received fragment: café'}).waitFor({timeout:5000});
  assert.equal(await page.locator('#btn-send.stop-mode').count(),1);
  await page.evaluate(()=>window.__releaseFixture());
  await ready();
  assert.match(await page.locator('.message.assistant .msg-text').last().innerText(),/FINISHED_BROWSER_STREAM\./);
  assert.equal(await page.evaluate(()=>window.__fixtureCancels),1);
  console.log('PASS: Frozen animation callbacks cannot pause received text; authoritative saved text appears and DONE releases Send even while the connection stays open');

  await page.evaluate(()=>{window.__fixtureCase='last-frame';});
  await send('Synthetic final-frame check');
  await ready();
  const last=await page.locator('.message.assistant .msg-text').last().innerText();
  assert.match(last,/café.*FINISHED_BROWSER_STREAM\./);
  assert.ok(!last.includes('Answer interrupted'));
  console.log('PASS: Fragmented UTF-8 and an authoritative final frame without a trailing newline display the whole answer');

  await page.evaluate(()=>{window.__fixtureCase='interrupted';});
  await send('Synthetic interrupted-stream check');
  await ready();
  assert.match(await page.locator('.message.assistant .msg-text').last().innerText(),/café would be/);
  await page.getByText('Answer interrupted or incomplete · partial text preserved',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: A truly interrupted stream preserves all received text, marks it incomplete, and leaves Send usable');
  console.log('All checks used an isolated fixture and synthetic transport; no provider requests or personal-chat edits');
}finally{
  if(browser)await browser.close();
  if(project)await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.end();
}
