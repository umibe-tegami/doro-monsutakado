// Stripe Webhook: automatic granting for Payment Link purchases.
//
// The shop's payment links carry ?client_reference_id=<playerId>; when a
// checkout completes, Stripe posts checkout.session.completed here and we
// grant the purchased item. Grants resolve in this order:
//   1. LINK_GRANTS: the session's payment_link ID. The webhook payload
//      always carries it, so this needs no Stripe API call.
//   2. PRICE_GRANTS: the session's line-item price IDs (needs line items
//      embedded in the payload or STRIPE_SECRET_KEY to fetch them).
//      Several items share the 280 JPY price point (ad-free, speed-up,
//      auto-draw), so those can ONLY be told apart by link or price ID.
//   3. STRIPE_GRANTS_JPY: amounts that belong to exactly one item (the
//      soul packs and the 980 / 1080 JPY passes).
// The manual redemption-code flow stays available in parallel.
//
// Disabled unless STRIPE_WEBHOOK_SECRET is set (then requests get 503).
import crypto from 'node:crypto';

// Payment link ID -> grant. Registered 2026-11-19 when the links were
// created (the 7 original links by the owner in the dashboard, the 4
// feature links via the Stripe connector).
export const LINK_GRANTS = {
  plink_1UdD0sDmWNBBDQ2EDP3bUAFc: { type: 'ad_free' },
  plink_1UdN8kDmWNBBDQ2ECJnukVi8: { type: 'speed_up' },
  plink_1UdN8mDmWNBBDQ2EEqKQs933: { type: 'auto_draw' },
  plink_1UdN8nDmWNBBDQ2ECbYYLvm7: { type: 'full_auto' },
  plink_1UdN8oDmWNBBDQ2Ezmu31dEI: { type: 'duelist_pack' },
  plink_1UdD8sDmWNBBDQ2ED5YlTbFn: { type: 'souls', souls: 300 },
  plink_1UdDAEDmWNBBDQ2E9w9BRLv5: { type: 'souls', souls: 1000 },
  plink_1UdDBFDmWNBBDQ2ESc2gIUZh: { type: 'souls', souls: 2500 },
  plink_1UdDCSDmWNBBDQ2EpmEEg3uC: { type: 'souls', souls: 5500 },
  plink_1UdDDgDmWNBBDQ2ElfGIs06n: { type: 'souls', souls: 14000 },
  plink_1UdDEyDmWNBBDQ2EiCaEp4Aa: { type: 'souls', souls: 30000 },
};

// Price ID -> grant (same items as LINK_GRANTS; kept as a second net for
// sessions that arrive without a payment_link ID but with line items).
export const PRICE_GRANTS = {
  price_1UdD0UDmWNBBDQ2EwSGnLhir: { type: 'ad_free' },
  price_1UdN85DmWNBBDQ2EIVCT1ZiX: { type: 'speed_up' },
  price_1UdN89DmWNBBDQ2EcQ1UIZvT: { type: 'auto_draw' },
  price_1UdN8BDmWNBBDQ2E3gUbfDcf: { type: 'full_auto' },
  price_1UdN8CDmWNBBDQ2ETQ105Sti: { type: 'duelist_pack' },
  price_1UdD8nDmWNBBDQ2EBRJRAGaj: { type: 'souls', souls: 300 },
  price_1UdDAADmWNBBDQ2ESPHWEXVl: { type: 'souls', souls: 1000 },
  price_1UdDBADmWNBBDQ2EfiWCzvtB: { type: 'souls', souls: 2500 },
  price_1UdDCPDmWNBBDQ2EBm3xr7VS: { type: 'souls', souls: 5500 },
  price_1UdDDdDmWNBBDQ2ESbqm5LHI: { type: 'souls', souls: 14000 },
  price_1UdDElDmWNBBDQ2EgwRm7Qas: { type: 'souls', souls: 30000 },
};

// Grant types usable from PRICE_GRANTS and the STRIPE_PRICE_GRANTS override.
const GRANT_TYPE_NAMES = ['ad_free', 'speed_up', 'auto_draw', 'full_auto', 'duelist_pack'];

// Optional ops/test override: STRIPE_PRICE_GRANTS as JSON
// { "price_...": "ad_free" | "speed_up" | "auto_draw" | "full_auto" }.
// PRICE_GRANTS above wins on conflicts.
function envPriceGrants() {
  try {
    const parsed = JSON.parse(process.env.STRIPE_PRICE_GRANTS || '{}');
    const out = {};
    for (const [priceId, type] of Object.entries(parsed)) {
      if (GRANT_TYPE_NAMES.includes(type)) out[priceId] = { type };
    }
    return out;
  } catch {
    return {};
  }
}

// Amount (JPY) -> grant, ONLY for amounts unique to one item. 280 JPY is
// deliberately absent: three items share it, so it needs a price ID.
export const STRIPE_GRANTS_JPY = {
  120: { type: 'souls', souls: 300 },
  320: { type: 'souls', souls: 1000 },
  680: { type: 'souls', souls: 2500 },
  1280: { type: 'souls', souls: 5500 },
  2940: { type: 'souls', souls: 14000 },
  5860: { type: 'souls', souls: 30000 },
  980: { type: 'full_auto' },
  1080: { type: 'duelist_pack' },
};

const TIMESTAMP_TOLERANCE_SEC = 300;

// Verify a Stripe-Signature header: t=<unix>,v1=<hex hmac-sha256 of
// "<t>.<raw body>" keyed with the endpoint secret>. Constant-time compare.
export function verifyStripeSignature(rawBody, header, secret) {
  if (!header || typeof header !== 'string') return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_TOLERANCE_SEC) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

// Collect the session's line-item price IDs. The webhook payload does not
// normally embed line items, so fetch them from the Stripe API when a
// secret key is configured; an embedded line_items (expanded sessions,
// test events) is used as-is.
async function sessionPriceIds(session) {
  const embedded = session && session.line_items && Array.isArray(session.line_items.data)
    ? session.line_items.data.map((li) => li && li.price && li.price.id).filter(Boolean)
    : [];
  if (embedded.length) return embedded;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !session || !session.id) return [];
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.data || []).map((li) => li && li.price && li.price.id).filter(Boolean);
  } catch {
    return [];
  }
}

// Apply one grant to a player. Returns the stripe_events result string.
async function applyGrant(db, playerId, grant) {
  switch (grant.type) {
    case 'ad_free':
      await db.run('UPDATE players SET ad_free = 1 WHERE id = $1', [playerId]);
      return 'granted:ad_free';
    case 'speed_up':
      // Owned speed-up starts out enabled, like a redeemed code.
      await db.run('UPDATE players SET speed_up = 1, speed_fast = 1 WHERE id = $1', [playerId]);
      return 'granted:speed_up';
    case 'auto_draw':
      await db.run('UPDATE players SET auto_draw = 1 WHERE id = $1', [playerId]);
      return 'granted:auto_draw';
    case 'full_auto':
      await db.run('UPDATE players SET full_auto = 1 WHERE id = $1', [playerId]);
      return 'granted:full_auto';
    case 'duelist_pack':
      // Bundle: ad-free + speed-up (starts enabled) + full-auto together.
      await db.run('UPDATE players SET ad_free = 1, speed_up = 1, speed_fast = 1, full_auto = 1 WHERE id = $1', [playerId]);
      return 'granted:duelist_pack';
    case 'souls':
      await db.run('UPDATE players SET souls = souls + $1, lifetime_souls = lifetime_souls + $1 WHERE id = $2', [grant.souls, playerId]);
      return `granted:souls:${grant.souls}`;
    default:
      return null;
  }
}

// Express handler factory. Expects req.body to be the RAW request body
// (Buffer) — mount it with express.raw() before any JSON body parser.
export function stripeWebhookHandler(db) {
  return async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'stripe webhook is not configured' });

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
      console.error('[stripe-webhook] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid payload' });
    }

    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true, ignored: event.type });
    }

    const session = (event.data && event.data.object) || {};
    const eventId = String(event.id || '');
    const sessionId = session.id ? String(session.id) : null;
    if (!eventId) {
      console.error('[stripe-webhook] event without id; skipping');
      return res.json({ received: true, skipped: 'no_event_id' });
    }

    // Idempotency: claim the event id first so Stripe retries (or duplicate
    // deliveries) can never grant twice.
    const already = await db.one('SELECT event_id FROM stripe_events WHERE event_id = $1', [eventId]);
    if (already) return res.json({ received: true, duplicate: true });
    try {
      await db.run('INSERT INTO stripe_events (event_id, session_id, result, processed_at) VALUES ($1, $2, $3, $4)', [eventId, sessionId, 'received', Date.now()]);
    } catch {
      // Primary-key conflict: a concurrent delivery claimed it first.
      return res.json({ received: true, duplicate: true });
    }
    const record = async (result) => {
      await db.run('UPDATE stripe_events SET result = $1 WHERE event_id = $2', [result, eventId]);
    };

    // From here on we always answer 200: business-level problems are logged,
    // not retried (Stripe would otherwise resend for days).
    const playerId = typeof session.client_reference_id === 'string' ? session.client_reference_id : '';
    if (!playerId) {
      console.error(`[stripe-webhook] no client_reference_id (event ${eventId}, session ${sessionId}); not granting`);
      await record('skipped:no_client_reference_id');
      return res.json({ received: true, granted: false });
    }
    const player = await db.one('SELECT id FROM players WHERE id = $1', [playerId]);
    if (!player) {
      console.error(`[stripe-webhook] unknown player "${playerId}" (event ${eventId}, session ${sessionId}); not granting`);
      await record('skipped:unknown_player');
      return res.json({ received: true, granted: false });
    }
    if (session.currency && session.currency !== 'jpy') {
      console.error(`[stripe-webhook] unexpected currency "${session.currency}" (event ${eventId}); not granting`);
      await record('skipped:currency');
      return res.json({ received: true, granted: false });
    }
    // Payment link ID first (always in the payload), then price IDs
    // (the only other way to tell the 280 JPY items apart), then the
    // unique-amount table.
    const priceGrants = { ...envPriceGrants(), ...PRICE_GRANTS };
    let grant = null;
    let via = null;
    if (session.payment_link && LINK_GRANTS[session.payment_link]) {
      grant = LINK_GRANTS[session.payment_link];
      via = `link:${session.payment_link}`;
    }
    for (const priceId of grant ? [] : await sessionPriceIds(session)) {
      if (priceGrants[priceId]) { grant = priceGrants[priceId]; via = `price:${priceId}`; break; }
    }
    if (!grant) {
      grant = STRIPE_GRANTS_JPY[Number(session.amount_total)] || null;
      if (grant) via = `amount:${session.amount_total}`;
    }
    if (!grant) {
      console.error(`[stripe-webhook] no grant resolved (amount_total ${session.amount_total}, event ${eventId}, player ${playerId}); not granting`);
      await record('skipped:unknown_amount');
      return res.json({ received: true, granted: false });
    }

    const result = await applyGrant(db, playerId, grant);
    if (!result) {
      console.error(`[stripe-webhook] unknown grant type "${grant.type}" (event ${eventId}); not granting`);
      await record('skipped:unknown_grant');
      return res.json({ received: true, granted: false });
    }
    await record(result);
    console.log(`[stripe-webhook] ${result} to ${playerId} via ${via} (event ${eventId})`);
    return res.json({ received: true, granted: true });
  };
}
