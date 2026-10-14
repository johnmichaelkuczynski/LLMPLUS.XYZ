import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pool } from '../server/db.js';

const base = process.env.SOURCE_INSPECTOR_TEST_URL ||
  (process.env.REPLIT_DEV_DOMAIN && 'https://' + process.env.REPLIT_DEV_DOMAIN);
if (!base) throw new Error('Set SOURCE_INSPECTOR_TEST_URL to the development preview URL.');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err => errors.push(err.message));
const projects = [];
try {
  const response = await page.request.get(base + '/api/projects');
  assert.equal(response.status(),200,'Development preview identity must be available');
  const existing = await response.json();
  const owner = (await pool.query('SELECT user_id FROM projects WHERE id=$1',[existing[0].id])).rows[0].user_id;
  for (const name of ['Source inspector browser fixture','Source inspector move fixture']) {
    projects.push((await pool.query('INSERT INTO projects(name,user_id) VALUES($1,$2) RETURNING id',
      [name,owner])).rows[0].id);
  }
  const original = 'Earlier original context. Avery is the judge. Later original context. <script>never execute</script>';
  const source = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
    [projects[0],'Source chat',JSON.stringify([{role:'user',content:original}])])).rows[0].id;
  const document = (await pool.query('INSERT INTO project_documents(project_id,name,raw_content) VALUES($1,$2,$3) RETURNING id',
    [projects[0],'Document fixture','Opening document context. Original document passage. Closing context.'])).rows[0].id;
  const current = (await pool.query('INSERT INTO sessions(project_id,title,transcript) VALUES($1,$2,$3) RETURNING id',
    [projects[0],'Active conversation',JSON.stringify([
      {role:'user',content:'Recall the judge.'},{role:'assistant',content:'Avery is the judge, according to your report.'}
    ])])).rows[0].id;
  const health = {sessionId:current,projectId:projects[0],mode:'full',status:'completed',
    historyMessagesIncluded:2,totalMessages:2,sourceCount:2,
    identityStatements:[{entity:'Avery',role:'judge',quote:'Avery is the judge.',
      classification:'user_statement',source:{sessionId:source,ordinal:1}}],
    sourceReferences:[{documentId:document,offsetChars:0,kind:'source_document',quote:'Original document passage.'}]};
  await pool.query('UPDATE sessions SET context_health=$1 WHERE id=$2',[JSON.stringify(health),current]);
  await page.addInitScript(id => {
    localStorage.setItem('llmplus_last_project',id);
  },projects[0]);
  await page.goto(base);
  await page.getByTestId('session-' + current).click();
  await page.locator('#context-health-evidence').click();
  await page.locator('#chat-input').fill('Unsent draft stays here');
  const before = await page.locator('#messages').innerText();
  const buttons = page.getByRole('button',{name:'Open original source',exact:true});
  await buttons.first().click();
  await page.waitForFunction(() => document.getElementById('source-inspector-passage').textContent.includes('Earlier original context.'));
  assert.match(await page.locator('#source-inspector-info').innerText(),/User report.*Historical timestamp not recorded/);
  assert.equal(await page.locator('#source-inspector-passage').innerText(),original);
  assert.equal(await page.locator('#messages').innerText(),before);
  assert.equal(await page.locator('#chat-input').inputValue(),'Unsent draft stays here');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#source-inspector-modal').evaluate(el => el.classList.contains('hidden')));
  assert.equal(await buttons.first().evaluate(el => document.activeElement === el),true);
  console.log('PASS: Source opens real surrounding text, escapes HTML, restores focus, and preserves conversation/draft');
  await buttons.last().click();
  await page.waitForFunction(() => document.getElementById('source-inspector-passage').textContent.includes('Opening document context.'));
  assert.match(await page.locator('#source-inspector-info').innerText(),/Document text.*page numbers|page numbers.*Document text/);
  await page.locator('#close-source-inspector').click();
  console.log('PASS: Document source opens original passage with provenance labels');
  await pool.query('UPDATE sessions SET project_id=$1 WHERE id=$2',[projects[1],source]);
  await buttons.first().click();
  await page.waitForFunction(() => document.getElementById('source-inspector-info').textContent.includes('Source unavailable'));
  assert.equal(await page.locator('#source-inspector-passage').innerText(),'');
  assert.equal(await page.locator('#messages').innerText(),before);
  await page.locator('#close-source-inspector').click();
  console.log('PASS: Stale moved-chat link shows unavailable and leaves active conversation unchanged');
  await page.route('**/source?*',async route => {
    await new Promise(resolve => setTimeout(resolve,400));
    await route.continue();
  });
  await buttons.last().click();
  await page.locator('#close-source-inspector').click();
  await page.getByTestId('project-' + projects[1]).click();
  await page.waitForTimeout(700);
  assert.ok(await page.locator('#source-inspector-modal').evaluate(el => el.classList.contains('hidden')));
  assert.equal(await page.locator('#source-inspector-passage').innerText(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: Late source responses cannot reopen or populate inspector after project switch; no browser errors');
} finally {
  await browser.close();
  if (projects.length) await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])',[projects]);
  await pool.end();
}
