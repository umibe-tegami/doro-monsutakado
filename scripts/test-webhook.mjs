// Local end-to-end test for the Stripe webhook auto-grant.
// Spawns the real server (SQLite, temp data dir) twice — once with
// STRIPE_WEBHOOK_SECRET set, once without — and posts self-signed
// checkout.session.completed events at it. No real Stripe involved.
//
// Usage: node scripts/test-webhook.mjs
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'whsec_local_test_dummy';
const PORT_A = 3457; // webhook enabled
const PORT_B = 3458; // webhook disabled (no secret)

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

function startServer(port, dataDir, extraEnv) {
  const child = spawn('node', ['server/index.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server:${port}] ${d}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(child); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
}

function sign(payload, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postWebhook(port, payload, header) {
  const r = await fetch(`http://127.0.0.1:${port}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function state(port, playerId) {
  const r = await fetch(`http://127.0.0.1:${port}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  return r.json();
}

function checkoutEvent(id, session) {
  return JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: `cs_test_${id}`, object: 'checkout.session', currency: 'jpy', ...session } },
  });
}

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'doro-wh-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'doro-wh-b-'));
let serverA, serverB;
try {
  serverA = await startServer(PORT_A, dirA, { STRIPE_WEBHOOK_SECRET: SECRET });
  serverB = await startServer(PORT_B, dirB, { STRIPE_WEBHOOK_SECRET: '' });
  // Note: empty string is falsy, so instance B behaves as "not configured".

  const PLAYER = 'webhook-test-player';
  const before = await state(PORT_A, PLAYER); // creates the player (300 souls)
  check('setup: new player starts at 300 souls', before.souls === 300, `souls=${before.souls}`);

  // 1. Soul pack grant: 320 JPY -> +1000 souls (balance and lifetime).
  const ev1 = checkoutEvent('evt_test_1', { client_reference_id: PLAYER, amount_total: 320 });
  const r1 = await postWebhook(PORT_A, ev1, sign(ev1, SECRET));
  check('grant souls: HTTP 200', r1.status === 200, `status=${r1.status}`);
  const after1 = await state(PORT_A, PLAYER);
  check('grant souls: balance 300 -> 1300', after1.souls === 1300, `souls=${after1.souls}`);
  check('grant souls: lifetime 300 -> 1300', after1.lifetimeSouls === 1300, `lifetime=${after1.lifetimeSouls}`);

  // 2. Duplicate delivery of the same event must not grant again.
  const r2 = await postWebhook(PORT_A, ev1, sign(ev1, SECRET));
  const after2 = await state(PORT_A, PLAYER);
  check('duplicate event: HTTP 200', r2.status === 200, `status=${r2.status}`);
  check('duplicate event: flagged as duplicate', r2.body.duplicate === true, JSON.stringify(r2.body));
  check('duplicate event: balance unchanged', after2.souls === 1300, `souls=${after2.souls}`);

  // 3. Ad-free grant: 280 JPY -> ad_free flag.
  const ev3 = checkoutEvent('evt_test_3', { client_reference_id: PLAYER, amount_total: 280 });
  const r3 = await postWebhook(PORT_A, ev3, sign(ev3, SECRET));
  const after3 = await state(PORT_A, PLAYER);
  check('grant ad_free: HTTP 200', r3.status === 200, `status=${r3.status}`);
  check('grant ad_free: flag set', after3.adFree === true, `adFree=${after3.adFree}`);
  check('grant ad_free: souls unchanged', after3.souls === 1300, `souls=${after3.souls}`);

  // 4. Unknown amount: 200, nothing granted.
  const ev4 = checkoutEvent('evt_test_4', { client_reference_id: PLAYER, amount_total: 999 });
  const r4 = await postWebhook(PORT_A, ev4, sign(ev4, SECRET));
  const after4 = await state(PORT_A, PLAYER);
  check('unknown amount: HTTP 200', r4.status === 200, `status=${r4.status}`);
  check('unknown amount: nothing granted', after4.souls === 1300, `souls=${after4.souls}`);

  // 5. Unknown player: 200, no grant (player existence is checked in DB below).
  const ev5 = checkoutEvent('evt_test_5', { client_reference_id: 'ghost-player-x', amount_total: 120 });
  const r5 = await postWebhook(PORT_A, ev5, sign(ev5, SECRET));
  check('unknown player: HTTP 200', r5.status === 200, `status=${r5.status}`);

  // 6. Missing client_reference_id: 200, no grant.
  const ev6 = checkoutEvent('evt_test_6', { amount_total: 120 });
  const r6 = await postWebhook(PORT_A, ev6, sign(ev6, SECRET));
  const after6 = await state(PORT_A, PLAYER);
  check('no client_reference_id: HTTP 200', r6.status === 200, `status=${r6.status}`);
  check('no client_reference_id: nothing granted', after6.souls === 1300, `souls=${after6.souls}`);

  // 7. Bad signature: 400.
  const r7 = await postWebhook(PORT_A, ev1, sign(ev1, 'whsec_wrong_secret'));
  check('bad signature: HTTP 400', r7.status === 400, `status=${r7.status}`);

  // 8. Other event types are acknowledged and ignored.
  const ev8 = JSON.stringify({ id: 'evt_test_8', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_test' } } });
  const r8 = await postWebhook(PORT_A, ev8, sign(ev8, SECRET));
  check('other event type: HTTP 200 ignored', r8.status === 200 && !!r8.body.ignored, `status=${r8.status}`);

  // 9. Webhook disabled when the secret is not configured: 503.
  const r9 = await postWebhook(PORT_B, ev1, sign(ev1, SECRET));
  check('secret unset: HTTP 503', r9.status === 503, `status=${r9.status}`);
} finally {
  if (serverA) serverA.kill();
  if (serverB) serverB.kill();
}

// DB-level assertions (server stopped, read the SQLite file directly).
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(path.join(dirA, 'game.db'), { readOnly: true });
const ghost = db.prepare('SELECT id FROM players WHERE id = ?').get('ghost-player-x');
check('unknown player: no player row was created', !ghost);
const events = db.prepare('SELECT event_id, result FROM stripe_events ORDER BY processed_at').all();
check('stripe_events recorded 5 checkout events', events.length === 5, JSON.stringify(events));
const results = Object.fromEntries(events.map((e) => [e.event_id, e.result]));
check('event results look right',
  results.evt_test_1 === 'granted:souls:1000' &&
  results.evt_test_3 === 'granted:ad_free' &&
  results.evt_test_4 === 'skipped:unknown_amount' &&
  results.evt_test_5 === 'skipped:unknown_player' &&
  results.evt_test_6 === 'skipped:no_client_reference_id',
  JSON.stringify(results));
db.close();
fs.rmSync(dirA, { recursive: true, force: true });
fs.rmSync(dirB, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
