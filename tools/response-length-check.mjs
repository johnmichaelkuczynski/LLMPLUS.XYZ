import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { directChatPrompt, directOutputBudget } from '../server/direct-chat-prompt.js';

const [server, client] = await Promise.all([
  readFile(new URL('../server/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../client/index.html', import.meta.url), 'utf8'),
]);

const firebasePrompt = 'Explain which Firebase configuration and script setup I should use for phone authentication in a plain HTML file.';

assert.ok(firebasePrompt.includes('Firebase'), 'Firebase regression prompt fixture is missing');
assert.match(client, /data-length="super_concise"[^>]*>Super Concise</);
assert.match(client, /data-length="concise"[^>]*>Concise</);
assert.match(server, /ONE TO THREE targeted, accurate, useful sentences/);
assert.match(server, /ONE substantive paragraph/);
assert.match(server, /directOutputBudget\(responseLength\)/);
assert.match(server, /bufferShortResponse/);
assert.match(server, /import \{ runComparisonLane \} from '\.\/comparison-lane\.js'/);

const validators = server.match(/\['super_concise', 'concise', 'normal', 'detailed', 'exhaustive'\]/g) || [];
assert.equal(validators.length, 4, 'Every chat, compare, report, and profile validator must accept Super Concise');

// Main intentionally removed sentence rewriting and restrictive token caps.
// Check the active user controls, not the retired enforcement implementation.
assert.match(directChatPrompt({responseLength:'super_concise'}),/Very brief/);
assert.match(directChatPrompt({responseLength:'concise'}),/Concise/);
assert.match(directChatPrompt({responseLength:'normal'}),/Natural length appropriate/);
assert.equal(directOutputBudget('super_concise'),2048);
assert.equal(directOutputBudget('concise'),4096);
assert.equal(directOutputBudget('normal'),8192);

console.log('Response-length contract check passed for the Firebase-style explanatory prompt.');