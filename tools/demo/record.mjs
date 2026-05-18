import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:5000';
const USERNAME = process.env.DEMO_USERNAME || 'jmk';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo';
const PROJECT = 'DEMO ' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
const OUT_DIR = path.resolve('tools/demo/out');
const VIDEO_DIR = path.join(OUT_DIR, 'raw');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const TYPE_DELAY = 55;
const READ_PAUSE = 2200;

const Q1 = 'In two sentences, explain what entropy is in thermodynamics.';
const Q2 = 'Recall: what topic from physics did I just ask you about in the previous chat in this project, and give one practical example of it.';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function typeSlow(page, sel, text) {
  await page.click(sel);
  await page.fill(sel, '');
  for (const ch of text) { await page.type(sel, ch, { delay: TYPE_DELAY }); }
}

async function waitForAssistantToFinish(page, prevCount) {
  const start = Date.now();
  let lastLen = -1;
  let stableSince = Date.now();
  while (Date.now() - start < 120000) {
    const info = await page.evaluate(() => {
      const msgs = document.querySelectorAll('.message.assistant');
      const last = msgs[msgs.length - 1];
      return { count: msgs.length, len: last ? (last.innerText || '').length : 0, hasCursor: last ? !!last.querySelector('.streaming-cursor, .cursor') : false };
    });
    if (info.count > prevCount && info.len > 20 && !info.hasCursor) {
      if (info.len === lastLen && Date.now() - stableSince > 1200) return info;
      if (info.len !== lastLen) { lastLen = info.len; stableSince = Date.now(); }
    }
    await sleep(250);
  }
  return null;
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await context.newPage();

  console.log('[demo] navigating to', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#login-form', { timeout: 15000 });
  await sleep(800);
  await typeSlow(page, '#login-username, input[type="text"]', USERNAME);
  await typeSlow(page, '#login-password, input[type="password"]', PASSWORD);
  await sleep(500);
  const loginP = page.waitForResponse(r => r.url().endsWith('/api/auth/login'), { timeout: 15000 });
  await page.click('#btn-login');
  await loginP;
  await page.waitForSelector('#chat-input', { timeout: 15000 });
  await sleep(1000);

  console.log('[demo] creating project', PROJECT);
  await page.click('#btn-new-project');
  await page.waitForSelector('#project-name-input', { timeout: 5000 });
  await sleep(400);
  await typeSlow(page, '#project-name-input', PROJECT);
  await sleep(400);
  await page.press('#project-name-input', 'Enter');
  await sleep(1500);

  await page.waitForSelector('#chat-input', { timeout: 10000 });
  await sleep(800);

  console.log('[demo] CHAT 1: typing Q1');
  const before1 = await page.evaluate(() => document.querySelectorAll('.message.assistant').length);
  await typeSlow(page, '#chat-input', Q1);
  await sleep(600);
  await page.keyboard.press('Enter');

  console.log('[demo] waiting for streamed reply');
  await waitForAssistantToFinish(page, before1);
  await sleep(READ_PAUSE);

  console.log('[demo] opening tractatus tree');
  await page.click('#btn-view-tractatus');
  await sleep(4500);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
  const closeBtn = await page.$('.modal-x, #close-tractatus, .close-modal');
  if (closeBtn) await closeBtn.click().catch(() => {});
  await sleep(800);

  console.log('[demo] new chat in same project');
  await page.click('#btn-new-session');
  await sleep(1500);
  await page.waitForSelector('#chat-input', { timeout: 10000 });
  await sleep(800);

  console.log('[demo] CHAT 2: typing Q2 (tests cross-chat memory)');
  const before2 = await page.evaluate(() => document.querySelectorAll('.message.assistant').length);
  await typeSlow(page, '#chat-input', Q2);
  await sleep(600);
  await page.keyboard.press('Enter');

  console.log('[demo] waiting for streamed reply');
  await waitForAssistantToFinish(page, before2);
  await sleep(READ_PAUSE + 1500);

  console.log('[demo] closing');
  await context.close();
  await browser.close();

  const files = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No video recorded');
  const webm = path.join(VIDEO_DIR, files[files.length - 1]);
  const outWebm = path.join(OUT_DIR, 'demo.webm');
  fs.copyFileSync(webm, outWebm);
  console.log('[demo] WebM saved:', outWebm);
}

run().catch(e => { console.error('[demo] failed:', e); process.exit(1); });
