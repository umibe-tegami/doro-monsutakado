// Stripe Webhook: automatic granting for Payment Link purchases.
//
// The shop's payment links carry ?client_reference_id=<playerId>; when a
// checkout completes, Stripe posts checkout.session.completed here and we
// grant the item that matches session.amount_total (JPY, zero-decimal).
// The manual redemption-code flow stays available in parallel.
//
// Disabled unless STRIPE_WEBHOOK_SECRET is set (then requests get 503).
import crypto from 'node:crypto';

// Amount (JPY) -> grant. Single source of truth for the amount mapping.
// 280 JPY is the ad-free pass; the rest are soul packs.
export const STRIPE_GRANTS_JPY = {
  280: { type: 'ad_free' },
  120: { type: 'souls', souls: 300 },
  320: { type: 'souls', souls: 1000 },
  680: { type: 'souls', souls: 2500 },
  1280: { type: 'souls', souls: 5500 },
  2940: { type: 'souls', souls: 14000 },
  5860: { type: 'souls', souls: 30000 },
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
    const grant = STRIPE_GRANTS_JPY[Number(session.amount_total)];
    if (!grant) {
      console.error(`[stripe-webhook] unknown amount_total ${session.amount_total} (event ${eventId}, player ${playerId}); not granting`);
      await record('skipped:unknown_amount');
      return res.json({ received: true, granted: false });
    }

    if (grant.type === 'ad_free') {
      await db.run('UPDATE players SET ad_free = 1 WHERE id = $1', [playerId]);
      await record('granted:ad_free');
      console.log(`[stripe-webhook] granted ad_free to ${playerId} (event ${eventId})`);
    } else {
      await db.run('UPDATE players SET souls = souls + $1, lifetime_souls = lifetime_souls + $1 WHERE id = $2', [grant.souls, playerId]);
      await record(`granted:souls:${grant.souls}`);
      console.log(`[stripe-webhook] granted ${grant.souls} souls to ${playerId} (event ${eventId})`);
    }
    return res.json({ received: true, granted: true });
  };
}
