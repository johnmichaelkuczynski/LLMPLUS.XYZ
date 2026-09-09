import { chromium } from 'playwright';

const baseUrl = process.env.APP_URL || 'http://127.0.0.1:5000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let projectId;

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const created = await page.evaluate(async () => {
    const project = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Plain-output regression check' })
    }).then((response) => response.json());
    const session = await fetch(`/api/projects/${project.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Raw marker test' })
    }).then((response) => response.json());
    await fetch(`/api/sessions/${session.id}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'assistant',
          content: 'It **does** remove **all asterisks**.\\n\\n## Heading\\n- **Men:** 90/200 = **45%**\\n- `code` and ~~strike~~ markers'
        }]
      })
    });
    localStorage.setItem('llmplus_last_project', project.id);
    return project.id;
  });
  projectId = created;

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Raw marker test', { exact: true }).click();
  const rendered = await page.locator('.message.assistant .msg-text').innerText();
  if (/[*`]|^\s*#{1,6}\s/m.test(rendered)) {
    throw new Error(`Visible Markdown marker remained in rendered output: ${rendered}`);
  }
  if (!rendered.includes('It does remove all asterisks.') || !rendered.includes('45%')) {
    throw new Error(`Output content was damaged while removing Markdown: ${rendered}`);
  }
  console.log('Plain-output rendering check passed.');
} finally {
  if (projectId) {
    await page.evaluate(async (id) => {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      localStorage.removeItem('llmplus_last_project');
    }, projectId).catch(() => {});
  }
  await browser.close();
}