import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

// No app API or database is contacted. Real HTML/JS/CSS, synthetic workspace.
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1400,height:950}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const files = {
  '/': ['index.html','text/html'],
  '/app.js': ['app.js','application/javascript'],
  '/style.css': ['style.css','text/css']
};
await page.route('**/*', async route=>{
  const url=new URL(route.request().url());
  const file=url.origin==='https://comparison-fixture.test' && files[url.pathname];
  if(file) return route.fulfill({contentType:file[1],body:await fs.readFile(new URL('../client/'+file[0],import.meta.url),'utf8')});
  // All other network traffic, including third-party fonts, stays offline.
  return route.fulfill({status:404,body:''});
});
await page.addInitScript(()=>{
  const nativeFetch=window.fetch;
  window.__comparisonRequests=[];
  window.__comparisonAborts=0;
  window.__scenario={events:[]};
  window.fetch=async function(input,options={}) {
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
    window.__comparisonRequests.push({path:url.pathname,method:options.method||'GET'});
    const json=value=>Promise.resolve(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));
    if(url.pathname==='/api/chat/compare') {
      const scenario=window.__scenario;
      const encoder=new TextEncoder();
      const body=scenario.events.map(e=>'data: '+JSON.stringify(e)).join('\n\n');
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(encoder.encode(body));
        if(!scenario.hold)controller.close();
        else options.signal.addEventListener('abort',()=>{
          window.__comparisonAborts++;
          controller.error(new DOMException('Stopped','AbortError'));
        },{once:true});
      }}),{headers:{'Content-Type':'text/event-stream'}});
    }
    if(url.pathname==='/api/auth/me')return json({authenticated:true,user:{id:'fixture-user',username:'Synthetic test workspace'},developmentPreview:true});
    if(url.pathname==='/api/billing/status')return json({owner:true,paid:true});
    if(url.pathname==='/api/projects')return json([{id:'fixture-project',name:'Comparison regression fixture'}]);
    if(url.pathname==='/api/projects/fixture-project/sessions')return json([
      {id:'fixture-session',project_id:'fixture-project',title:'Synthetic comparison only',transcript:[]}
    ]);
    if(url.pathname.endsWith('/context-health'))return json({sessionId:'fixture-session',projectId:'fixture-project',status:'completed'});
    if(url.pathname.endsWith('/memory-health'))return json({score:100,severity:'healthy',factors:{}});
    if(url.pathname.endsWith('/count'))return json({count:0});
    if(url.pathname.includes('documents') || url.pathname==='/api/reminders')return json([]);
    return json({});
  };
});
const lane=(lane,type,rest={})=>({lane,type,model:'deepseek',...rest});
async function run(events,hold=false) {
  await page.evaluate(scenario=>{window.__scenario=scenario;},{events,hold});
  await page.locator('#chat-input').fill('Explain the synthetic fixture evidence.');
  await page.locator('#btn-compare-stances').click();
  await page.locator('#btn-compare-go').click();
  if(!hold)await page.waitForFunction(()=>!document.querySelector('#compare-overlay .compare-cursor'));
}
async function close(){await page.locator('#close-compare-overlay').click();}
try {
  await page.goto('https://comparison-fixture.test/');
  await page.locator('[data-testid="session-fixture-session"]').waitFor();
  for(const incomplete of ['A','B']) {
    const complete=incomplete==='A'?'B':'A';
    await run([
      lane(incomplete,'lane_start'),lane(complete,'lane_start'),
      lane(incomplete,'text',{text:'The synthetic conclusion would be'}),
      lane(complete,'text',{text:'Independent answer.'}),
      lane(incomplete,'lane_end',{status:'incomplete',message:'Incomplete answer: ending failed.'}),
      lane(complete,'lane_end',{status:'completed'})
    ]);
    assert.match(await page.locator('#compare-col-'+incomplete.toLowerCase()+'-header').innerText(),/DeepSeek.*incomplete/);
    assert.match(await page.locator('#compare-col-'+incomplete.toLowerCase()+'-body').innerText(),/would be.*Incomplete/s);
    assert.equal(await page.locator('#compare-col-'+complete.toLowerCase()+'-body').innerText(),'Independent answer.');
    assert.doesNotMatch(await page.locator('#compare-status').innerText(),/^Done/);
    if(incomplete==='A'){
      await fs.mkdir(new URL('../generated-artifacts/',import.meta.url),{recursive:true});
      await page.screenshot({path:'generated-artifacts/comparison-incomplete.png'});
    }
    await close();
  }
  console.log('PASS: Either incomplete lane stays visibly incomplete without relabeling or corrupting its completed neighbor');
  await run([
    lane('A','text',{text:'The conclusion would be'}),
    lane('A','lane_status',{status:'finishing'}),
    lane('B','text',{text:'Independent answer.'}),
    lane('B','lane_end',{status:'completed'}),
    lane('A','replace_text',{text:'The conclusion would be uncertain.'}),
    lane('A','lane_end',{status:'completed'})
  ]);
  assert.match(await page.locator('#compare-status').innerText(),/^Done/);
  assert.equal(await page.locator('#compare-col-a-body').innerText(),'The conclusion would be uncertain.');
  await close();
  console.log('PASS: Bounded replacement does not duplicate text; final lane_end without newline is parsed');
  await run([lane('A','text',{text:'Partial A'}),lane('B','text',{text:'Partial B'}),lane('A','lane_end')]);
  assert.match(await page.locator('#compare-status').innerText(),/A: incomplete.*B: incomplete/);
  assert.equal(await page.locator('.compare-incomplete').count(),2);
  await close();
  await run([{type:'error',error:'Synthetic provider error'}]);
  assert.match(await page.locator('#compare-status').innerText(),/incomplete/);
  assert.equal(await page.locator('.compare-cursor').count(),0);
  await close();
  console.log('PASS: Abrupt EOF, legacy status-less lane_end and provider errors cannot appear completed');
  await run([lane('A','text',{text:'Partial before Stop'}),lane('A','lane_status',{status:'finishing'})],true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.getElementById('compare-status').textContent.includes('cancelled'));
  assert.match(await page.locator('#compare-col-a-body').innerText(),/Partial before Stop.*Stopped/s);
  await close();
  await run([lane('A','text',{text:'Older run'}),lane('A','lane_status',{status:'finishing'})],true);
  await close();
  await run([
    lane('A','text',{text:'New A.'}),lane('A','lane_end',{status:'completed'}),
    lane('B','text',{text:'New B.'}),lane('B','lane_end',{status:'completed'})
  ]);
  assert.equal(await page.locator('#compare-col-a-body').innerText(),'New A.');
  assert.match(await page.locator('#compare-status').innerText(),/^Done/);
  assert.equal(await page.evaluate(()=>window.__comparisonAborts),2);
  console.log('PASS: Escape and Close abort active ending streams; reopening is isolated from the old request');
  assert.deepEqual(errors,[]);
  const requests=await page.evaluate(()=>window.__comparisonRequests);
  assert.ok(requests.filter(r=>r.method!=='GET').every(r=>r.path==='/api/chat/compare'));
  assert.ok(requests.filter(r=>r.path.includes('/sessions/')).every(r=>r.path.includes('/fixture-session/')));
  console.log('PASS: No browser errors; all requests mocked, no personal chats, database or real providers accessed');
} finally { await browser.close(); }
