import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [server, client] = await Promise.all([
  readFile(new URL('../server/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../client/index.html', import.meta.url), 'utf8'),
]);

const firebasePrompt = 'Explain which Firebase configuration and script setup I should use for phone authentication in a plain HTML file.';

assert.ok(firebasePrompt.includes('Firebase'), 'Firebase regression prompt fixture is missing');
assert.match(client, /data-length="super_concise"[^>]*>Super Concise</);
assert.match(client, /data-length="concise"[^>]*>Concise</);
assert.match(server, /EXACTLY ONE targeted, accurate, useful sentence/);
assert.match(server, /no more than FOUR short sentences/);
assert.match(server, /responseLength === 'super_concise' \? 96/);
assert.match(server, /responseLength === 'concise' \? 256/);
assert.match(server, /function enforceShortResponseContract/);
assert.match(server, /bufferShortResponse/);
assert.match(server, /bufferLane/);

const validators = server.match(/\['super_concise', 'concise', 'normal', 'detailed', 'exhaustive'\]/g) || [];
assert.equal(validators.length, 4, 'Every chat, compare, report, and profile validator must accept Super Concise');

const helperStart = server.indexOf('function enforceShortResponseContract');
const helperEnd = server.indexOf('\n\n// Appended by callers', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Short-response enforcement helper must be present');
const enforceShortResponseContract = Function(
  server.slice(helperStart, helperEnd) + '\nreturn enforceShortResponseContract;'
)();
const overlongFirebaseAnswer = 'Use the Firebase web configuration for your project. Load the app and auth SDKs from the CDN. Initialize Firebase with that configuration. Create a reCAPTCHA verifier. Call signInWithPhoneNumber. Confirm the SMS code.';
const superResult = enforceShortResponseContract(overlongFirebaseAnswer, 'super_concise');
const conciseResult = enforceShortResponseContract(overlongFirebaseAnswer, 'concise');
assert.equal([...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(superResult)].length, 1);
assert.equal([...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(conciseResult)].length, 4);

console.log('Response-length contract check passed for the Firebase-style explanatory prompt.');