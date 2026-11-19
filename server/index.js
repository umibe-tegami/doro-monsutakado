import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, seedCodes } from './db.js';
import { stripeWebhookHandler } from './stripe-webhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'catalog.json'), 'utf8'));
const designs = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'designs.json'), 'utf8'));

const SPECIES = new Map(catalog.species.map((s) => [s.id, s]));
const RARITY = new Map(catalog.rarities.map((r) => [r.id, r]));
const BY_RARITY = {};
for (const s of catalog.species) (BY_RARITY[s.rarity] ||= []).push(s.id);
const TOTAL_SPECIES = catalog.species.length;
const UL_ID = catalog.species.find((s) => s.rarity === 'UL').id;
const SOUL_PACKS = { souls300: 300, souls1000: 1000, souls2500: 2500, souls5500: 5500, souls14000: 14000, souls30000: 30000 };
const BG_IDS = designs.backgrounds.map((b) => b.id);
const BACK_IDS = designs.cardBacks.map((b) => b.id);
const COSMETIC_PRICE = 500;

const db = await createDb();
const seeded = await seedCodes(db);
if (seeded) console.log(`Seeded ${seeded} redemption codes.`);

const app = express();
// Stripe webhook needs the raw body for signature verification, so it is
// mounted with its own raw parser BEFORE the global JSON parser below.
app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler(db));
app.use(express.json({ limit: '8mb' }));

function rnd(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rnd(arr.length)]; }

// Weighted rarity roll. excludeUL removes UL (handled by the 0.025% pre-roll);
// rareOnly restricts to R and above at their usual relative ratios.
function rollRarity({ rareOnly = false } = {}) {
  const table = catalog.rarities.filter((r) => r.id !== 'UL' && (!rareOnly || r.id !== 'N'));
  const total = table.reduce((a, r) => a + r.weight, 0);
  let x = Math.random() * total;
  for (const r of table) { x -= r.weight; if (x <= 0) return r.id; }
  return table[table.length - 1].id;
}
function drawSpeciesId({ rareOnly = false, allowUL = true } = {}) {
  if (allowUL && Math.random() * 100 < 0.025) return UL_ID; // 0.025% pre-roll
  return pick(BY_RARITY[rollRarity({ rareOnly })]);
}

async function getPlayer(id) {
  let p = await db.one('SELECT * FROM players WHERE id = $1', [id]);
  if (!p) {
    await db.run('INSERT INTO players (id, created_at) VALUES ($1, $2)', [id, Date.now()]);
    p = await db.one('SELECT * FROM players WHERE id = $1', [id]);
  }
  return p;
}

async function addToCollection(playerId, speciesId) {
  const now = Date.now();
  const row = await db.one('SELECT * FROM collection WHERE player_id = $1 AND species_id = $2', [playerId, speciesId]);
  let isNew = false;
  if (!row) {
    await db.run('INSERT INTO collection (player_id, species_id, cnt, first_got_at) VALUES ($1, $2, 1, $3)', [playerId, speciesId, now]);
    isNew = true;
  } else {
    await db.run('UPDATE collection SET cnt = cnt + 1 WHERE player_id = $1 AND species_id = $2', [playerId, speciesId]);
  }
  const owned = await db.one('SELECT COUNT(*) AS c FROM collection WHERE player_id = $1 AND cnt > 0', [playerId]);
  const ownedCount = Number(owned.c);
  let compElapsed = null;
  if (ownedCount >= TOTAL_SPECIES) {
    const p = await getPlayer(playerId);
    if (p.comp_elapsed_ms == null) {
      compElapsed = now - Number(p.created_at);
      await db.run('UPDATE players SET comp_elapsed_ms = $1 WHERE id = $2', [compElapsed, playerId]);
    } else compElapsed = Number(p.comp_elapsed_ms);
  }
  const after = await db.one('SELECT cnt FROM collection WHERE player_id = $1 AND species_id = $2', [playerId, speciesId]);
  return { count: Number(after.cnt), isNew, ownedSpecies: ownedCount, compElapsedMs: compElapsed };
}

async function playerState(id) {
  const p = await getPlayer(id);
  const rows = await db.all('SELECT species_id, cnt, first_got_at FROM collection WHERE player_id = $1 AND cnt > 0', [id]);
  const collection = {};
  for (const r of rows) collection[r.species_id] = { count: Number(r.cnt), firstGotAt: r.first_got_at ? Number(r.first_got_at) : null };
  const cos = await db.all('SELECT kind, design_id FROM owned_cosmetics WHERE player_id = $1', [id]);
  return {
    playerId: id,
    name: p.name || '',
    souls: Number(p.souls),
    lifetimeSouls: Number(p.lifetime_souls),
    adFree: !!Number(p.ad_free),
    bgmEnabled: !!Number(p.bgm_enabled),
    voiceMuted: !!Number(p.voice_muted),
    selectedBg: p.selected_bg,
    selectedBack: p.selected_back,
    customArt: p.custom_art || null,
    createdAt: Number(p.created_at),
    compElapsedMs: p.comp_elapsed_ms == null ? null : Number(p.comp_elapsed_ms),
    collection,
    ownedBackgrounds: cos.filter((c) => c.kind === 'background').map((c) => c.design_id),
    ownedCardBacks: cos.filter((c) => c.kind === 'cardback').map((c) => c.design_id),
  };
}

function needPlayer(req, res) {
  const id = req.body && req.body.playerId;
  if (!id || typeof id !== 'string' || id.length > 64) { res.status(400).json({ error: 'playerId required' }); return null; }
  return id;
}

app.post('/api/state', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  res.json(await playerState(id));
});

app.post('/api/record-draw', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const speciesId = Number(req.body.speciesId);
  if (!SPECIES.has(speciesId)) return res.status(400).json({ error: 'unknown species' });
  const r = await addToCollection(id, speciesId);
  res.json(r);
});

app.post('/api/award-souls', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const amount = Math.max(0, Math.min(1000, Number(req.body.amount) || 0));
  await getPlayer(id);
  await db.run('UPDATE players SET souls = souls + $1, lifetime_souls = lifetime_souls + $1 WHERE id = $2', [amount, id]);
  const p = await getPlayer(id);
  res.json({ souls: Number(p.souls), lifetimeSouls: Number(p.lifetime_souls) });
});

app.post('/api/pay-revive', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const p = await getPlayer(id);
  if (Number(p.souls) < 100) return res.status(400).json({ error: 'ソウルが足りません' });
  await db.run('UPDATE players SET souls = souls - 100 WHERE id = $1', [id]);
  const after = await getPlayer(id);
  res.json({ souls: Number(after.souls) });
});

app.post('/api/sell-card', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const speciesId = Number(req.body.speciesId);
  const sp = SPECIES.get(speciesId);
  if (!sp) return res.status(400).json({ error: 'unknown species' });
  if (sp.rarity === 'UL' || sp.sellPrice == null) return res.status(400).json({ error: 'このカードは売却できません' });
  const row = await db.one('SELECT cnt FROM collection WHERE player_id = $1 AND species_id = $2', [id, speciesId]);
  if (!row || Number(row.cnt) <= 1) return res.status(400).json({ error: '各種の最後の1枚は売れません' });
  await db.run('UPDATE collection SET cnt = cnt - 1 WHERE player_id = $1 AND species_id = $2', [id, speciesId]);
  await db.run('UPDATE players SET souls = souls + $1 WHERE id = $2', [sp.sellPrice, id]);
  const p = await getPlayer(id);
  res.json({ souls: Number(p.souls), count: Number(row.cnt) - 1, gained: sp.sellPrice });
});

app.post('/api/sell-duplicates', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const rarity = String(req.body.rarity || '');
  if (!RARITY.has(rarity) || rarity === 'UL') return res.status(400).json({ error: '対象外のレア度です' });
  const rows = await db.all('SELECT species_id, cnt FROM collection WHERE player_id = $1 AND cnt > 1', [id]);
  let cards = 0, gained = 0;
  for (const r of rows) {
    const sp = SPECIES.get(Number(r.species_id));
    if (!sp || sp.rarity !== rarity) continue;
    const surplus = Number(r.cnt) - 1;
    cards += surplus; gained += surplus * sp.sellPrice;
    await db.run('UPDATE collection SET cnt = 1 WHERE player_id = $1 AND species_id = $2', [id, r.species_id]);
  }
  if (cards === 0) return res.status(400).json({ error: '売れるカードがありません' });
  await db.run('UPDATE players SET souls = souls + $1 WHERE id = $2', [gained, id]);
  const p = await getPlayer(id);
  res.json({ souls: Number(p.souls), cards, gained });
});

// Preview what a bulk sale would give (for the confirmation dialog).
app.post('/api/sell-duplicates-preview', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const rarity = String(req.body.rarity || '');
  const rows = await db.all('SELECT species_id, cnt FROM collection WHERE player_id = $1 AND cnt > 1', [id]);
  let cards = 0, gained = 0;
  for (const r of rows) {
    const sp = SPECIES.get(Number(r.species_id));
    if (!sp || sp.rarity !== rarity) continue;
    cards += Number(r.cnt) - 1; gained += (Number(r.cnt) - 1) * sp.sellPrice;
  }
  res.json({ cards, gained });
});

const PACKS = {
  normal: { price: 100, count: 3 },
  rare: { price: 300, count: 10 },
  unowned: { price: 1000, count: 1 },
  ultimate: { price: 5000, count: 1 },
};
app.post('/api/buy-pack', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const kind = String(req.body.kind || '');
  const pack = PACKS[kind];
  if (!pack) return res.status(400).json({ error: 'unknown pack' });
  const p = await getPlayer(id);
  if (Number(p.souls) < pack.price) return res.status(400).json({ error: 'ソウルが足りません' });
  let cards = [];
  if (kind === 'ultimate') {
    const cos = await db.all("SELECT design_id FROM owned_cosmetics WHERE player_id = $1 AND kind = 'cardback'", [id]);
    if (cos.length < BACK_IDS.length) return res.status(400).json({ error: '裏面コンプリートで解放されます' });
    cards = [UL_ID];
  } else if (kind === 'unowned') {
    const rows = await db.all('SELECT species_id FROM collection WHERE player_id = $1 AND cnt > 0', [id]);
    const ownedSet = new Set(rows.map((r) => Number(r.species_id)));
    const pool = catalog.species.filter((s) => s.id !== UL_ID && !ownedSet.has(s.id)).map((s) => s.id);
    if (pool.length === 0) return res.status(400).json({ error: '未所持のカードがありません（アルティメットレジェンドのみ未所持）' });
    cards = [pick(pool)];
  } else {
    for (let i = 0; i < pack.count; i++) cards.push(drawSpeciesId({ rareOnly: kind === 'rare' }));
  }
  await db.run('UPDATE players SET souls = souls - $1 WHERE id = $2', [pack.price, id]);
  const results = [];
  for (const cid of cards) results.push({ speciesId: cid, ...(await addToCollection(id, cid)) });
  const after = await getPlayer(id);
  res.json({ cards: results, souls: Number(after.souls) });
});

app.post('/api/buy-cosmetic', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const kind = req.body.kind === 'cardback' ? 'cardback' : 'background';
  const designId = String(req.body.designId || '');
  const valid = kind === 'background' ? BG_IDS : BACK_IDS;
  if (!valid.includes(designId)) return res.status(400).json({ error: 'unknown design' });
  const owned = await db.one('SELECT 1 AS x FROM owned_cosmetics WHERE player_id = $1 AND kind = $2 AND design_id = $3', [id, kind, designId]);
  if (owned) return res.status(400).json({ error: 'already owned' });
  if (kind === 'cardback') {
    const bgs = await db.all("SELECT design_id FROM owned_cosmetics WHERE player_id = $1 AND kind = 'background'", [id]);
    if (bgs.length < BG_IDS.length) return res.status(400).json({ error: '背景をコンプリートすると解放されます' });
  }
  const p = await getPlayer(id);
  if (Number(p.souls) < COSMETIC_PRICE) return res.status(400).json({ error: 'ソウルが足りません' });
  await db.run('UPDATE players SET souls = souls - $1 WHERE id = $2', [COSMETIC_PRICE, id]);
  await db.run('INSERT INTO owned_cosmetics (player_id, kind, design_id) VALUES ($1, $2, $3)', [id, kind, designId]);
  await db.run(`UPDATE players SET ${kind === 'background' ? 'selected_bg' : 'selected_back'} = $1 WHERE id = $2`, [designId, id]);
  res.json(await playerState(id));
});

app.post('/api/select-cosmetic', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const kind = req.body.kind === 'cardback' ? 'cardback' : 'background';
  const designId = String(req.body.designId || 'default');
  if (designId !== 'default') {
    const owned = await db.one('SELECT 1 AS x FROM owned_cosmetics WHERE player_id = $1 AND kind = $2 AND design_id = $3', [id, kind, designId]);
    if (!owned) return res.status(400).json({ error: 'not owned' });
  }
  await db.run(`UPDATE players SET ${kind === 'background' ? 'selected_bg' : 'selected_back'} = $1 WHERE id = $2`, [designId, id]);
  res.json(await playerState(id));
});

app.post('/api/redeem-code', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const code = String(req.body.code || '').trim().toUpperCase();
  const row = await db.one('SELECT * FROM redemption_codes WHERE code = $1', [code]);
  if (!row) return res.status(400).json({ error: 'コードが見つかりません' });
  if (row.used_by) return res.status(400).json({ error: 'このコードは既に使用されています' });
  const p = await getPlayer(id);
  const item = row.item_id;
  if (item === 'double_draw') return res.status(400).json({ error: '2ドローパスは販売を終了しました' });
  if (item === 'ad_free' && Number(p.ad_free)) return res.status(400).json({ error: '既に所有しています（コードは消費されません）' });
  await db.run('UPDATE redemption_codes SET used_by = $1, used_at = $2 WHERE code = $3', [id, Date.now(), code]);
  let message = '';
  if (item === 'ad_free') { await db.run('UPDATE players SET ad_free = 1 WHERE id = $1', [id]); message = '広告無期限廃止が有効になりました'; }
  else if (SOUL_PACKS[item]) {
    await db.run('UPDATE players SET souls = souls + $1, lifetime_souls = lifetime_souls + $1 WHERE id = $2', [SOUL_PACKS[item], id]);
    message = `${SOUL_PACKS[item].toLocaleString()}ソウルを付与しました`;
  }
  const st = await playerState(id);
  res.json({ item, message, souls: st.souls, adFree: st.adFree });
});

app.post('/api/submit-score', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  const name = String(req.body.name || '名無し').slice(0, 20);
  const streak = Math.max(0, Number(req.body.streak) || 0);
  const p = await getPlayer(id);
  await db.run('UPDATE players SET name = $1 WHERE id = $2', [name, id]);
  await db.run(
    'INSERT INTO scores (player_id, name, streak, lifetime_souls, comp_elapsed_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, name, streak, Number(p.lifetime_souls), p.comp_elapsed_ms == null ? null : Number(p.comp_elapsed_ms), Date.now()],
  );
  res.json({ ok: true });
});

async function ranking(kind, playerId) {
  const order = kind === 'streak' ? 'streak DESC, created_at ASC'
    : kind === 'souls' ? 'lifetime_souls DESC, created_at ASC'
    : 'comp_elapsed_ms ASC, created_at ASC';
  const where = kind === 'completion' ? 'WHERE comp_elapsed_ms IS NOT NULL' : '';
  const top = await db.all(`SELECT player_id, name, streak, lifetime_souls, comp_elapsed_ms, created_at FROM scores ${where} ORDER BY ${order} LIMIT 30`);
  let own = null;
  const mine = await db.all(`SELECT * FROM scores WHERE player_id = $1 ${kind === 'completion' ? 'AND comp_elapsed_ms IS NOT NULL' : ''} ORDER BY created_at DESC LIMIT 1`, [playerId]);
  if (mine.length) {
    const m = mine[0];
    const val = kind === 'streak' ? 'streak' : kind === 'souls' ? 'lifetime_souls' : 'comp_elapsed_ms';
    const cmp = kind === 'completion' ? '<' : '>';
    const better = await db.one(
      `SELECT COUNT(*) AS c FROM scores ${where} ${where ? 'AND' : 'WHERE'} (${val} ${cmp} $1 OR (${val} = $1 AND created_at < $2))`,
      [Number(m[val]), Number(m.created_at)],
    );
    own = { rank: Number(better.c) + 1, name: m.name, streak: Number(m.streak), lifetimeSouls: Number(m.lifetime_souls), compElapsedMs: m.comp_elapsed_ms == null ? null : Number(m.comp_elapsed_ms) };
  }
  return {
    top: top.map((r, i) => ({ rank: i + 1, name: r.name, streak: Number(r.streak), lifetimeSouls: Number(r.lifetime_souls), compElapsedMs: r.comp_elapsed_ms == null ? null : Number(r.comp_elapsed_ms), isMe: r.player_id === playerId })),
    own,
  };
}

app.post('/api/rankings', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  await getPlayer(id);
  res.json({
    streak: await ranking('streak', id),
    souls: await ranking('souls', id),
    completion: await ranking('completion', id),
  });
});

app.post('/api/settings', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  await getPlayer(id);
  if (typeof req.body.bgmEnabled === 'boolean') await db.run('UPDATE players SET bgm_enabled = $1 WHERE id = $2', [req.body.bgmEnabled ? 1 : 0, id]);
  if (typeof req.body.voiceMuted === 'boolean') await db.run('UPDATE players SET voice_muted = $1 WHERE id = $2', [req.body.voiceMuted ? 1 : 0, id]);
  res.json(await playerState(id));
});

app.post('/api/custom-art', async (req, res) => {
  const id = needPlayer(req, res); if (!id) return;
  await getPlayer(id);
  const dataUrl = req.body.dataUrl;
  if (dataUrl === null) {
    await db.run('UPDATE players SET custom_art = NULL WHERE id = $1', [id]);
  } else if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') && dataUrl.length < 4_000_000) {
    await db.run('UPDATE players SET custom_art = $1 WHERE id = $2', [dataUrl, id]);
  } else return res.status(400).json({ error: 'invalid image' });
  res.json(await playerState(id));
});

app.get('/api/catalog', (_req, res) => res.json(catalog));
app.get('/api/designs', (_req, res) => res.json(designs));

const dist = path.join(appDir, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`doro-monsutakado listening on ${port}`));
