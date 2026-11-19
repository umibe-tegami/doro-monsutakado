// DB layer: PostgreSQL when DATABASE_URL is set, otherwise local SQLite file.
// Exposes a small async API used by server/index.js; SQL is written per-backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    souls INTEGER NOT NULL DEFAULT 300,
    lifetime_souls INTEGER NOT NULL DEFAULT 300,
    ad_free INTEGER NOT NULL DEFAULT 0,
    double_draw INTEGER NOT NULL DEFAULT 0,
    speed_up INTEGER NOT NULL DEFAULT 0,
    auto_draw INTEGER NOT NULL DEFAULT 0,
    full_auto INTEGER NOT NULL DEFAULT 0,
    tester INTEGER NOT NULL DEFAULT 0,
    speed_fast INTEGER NOT NULL DEFAULT 0,
    play_mode TEXT NOT NULL DEFAULT 'manual',
    fa_revive1 TEXT NOT NULL DEFAULT 'ad',
    fa_revive2 TEXT NOT NULL DEFAULT 'ad',
    bgm_enabled INTEGER NOT NULL DEFAULT 1,
    voice_muted INTEGER NOT NULL DEFAULT 0,
    ul_souls INTEGER NOT NULL DEFAULT 0,
    draw_bonus INTEGER NOT NULL DEFAULT 0,
    soul_bonus INTEGER NOT NULL DEFAULT 0,
    selected_bg TEXT NOT NULL DEFAULT 'default',
    selected_back TEXT NOT NULL DEFAULT 'default',
    custom_art TEXT,
    comp_elapsed_ms BIGINT,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collection (
    player_id TEXT NOT NULL,
    species_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    first_got_at BIGINT,
    PRIMARY KEY (player_id, species_id)
  )`,
  `CREATE TABLE IF NOT EXISTS owned_cosmetics (
    player_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    design_id TEXT NOT NULL,
    PRIMARY KEY (player_id, kind, design_id)
  )`,
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    streak INTEGER NOT NULL,
    lifetime_souls INTEGER NOT NULL,
    comp_elapsed_ms BIGINT,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS redemption_codes (
    code TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    used_by TEXT,
    used_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT,
    result TEXT,
    processed_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ul_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    attach_type TEXT NOT NULL DEFAULT 'none',
    attach_amount INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    expires_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    read_at BIGINT NOT NULL,
    PRIMARY KEY (announcement_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS announcement_claims (
    announcement_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    claimed_at BIGINT NOT NULL,
    PRIMARY KEY (announcement_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    category TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_email TEXT,
    created_at BIGINT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0
  )`,
];
// Postgres: AUTOINCREMENT is not valid; swap in SERIAL for the scores table.
const SCHEMA_PG = SCHEMA.map((s) =>
  s.replace('id INTEGER PRIMARY KEY AUTOINCREMENT', 'id SERIAL PRIMARY KEY'),
);

// Columns added after the first release: CREATE TABLE IF NOT EXISTS does not
// retrofit them into existing databases, so both backends add what is missing.
const PLAYER_MIGRATIONS = [
  ['speed_up', 'INTEGER NOT NULL DEFAULT 0'],
  ['auto_draw', 'INTEGER NOT NULL DEFAULT 0'],
  ['full_auto', 'INTEGER NOT NULL DEFAULT 0'],
  ['tester', 'INTEGER NOT NULL DEFAULT 0'],
  ['speed_fast', 'INTEGER NOT NULL DEFAULT 0'],
  ['play_mode', "TEXT NOT NULL DEFAULT 'manual'"],
  ['fa_revive1', "TEXT NOT NULL DEFAULT 'ad'"],
  ['fa_revive2', "TEXT NOT NULL DEFAULT 'ad'"],
  ['ul_souls', 'INTEGER NOT NULL DEFAULT 0'],
  ['draw_bonus', 'INTEGER NOT NULL DEFAULT 0'],
  ['soul_bonus', 'INTEGER NOT NULL DEFAULT 0'],
];

class PgDb {
  constructor(pool) { this.pool = pool; }
  async init() {
    for (const s of SCHEMA_PG) await this.pool.query(s);
    for (const [col, def] of PLAYER_MIGRATIONS) {
      await this.pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
  }
  async one(sql, params = []) { const r = await this.pool.query(sql, params); return r.rows[0] || null; }
  async all(sql, params = []) { const r = await this.pool.query(sql, params); return r.rows; }
  async run(sql, params = []) { await this.pool.query(sql, params); }
}

class SqliteDb {
  constructor(db) { this.db = db; }
  async init() {
    for (const s of SCHEMA) this.db.exec(s);
    const cols = new Set(this.db.prepare('PRAGMA table_info(players)').all().map((r) => r.name));
    for (const [col, def] of PLAYER_MIGRATIONS) {
      if (!cols.has(col)) this.db.exec(`ALTER TABLE players ADD COLUMN ${col} ${def}`);
    }
  }
  // Translate $1,$2.. placeholders to ? for sqlite, expanding repeated
  // placeholders (e.g. "SET a = a + $1, b = b + $1") into separate bindings.
  conv(sql, params) {
    const out = [];
    const newSql = sql.replace(/\$(\d+)/g, (_m, n) => { out.push(params[Number(n) - 1]); return '?'; });
    return [newSql, out];
  }
  async one(sql, params = []) { const [s, p] = this.conv(sql, params); return this.db.prepare(s).get(...p) || null; }
  async all(sql, params = []) { const [s, p] = this.conv(sql, params); return this.db.prepare(s).all(...p); }
  async run(sql, params = []) { const [s, p] = this.conv(sql, params); this.db.prepare(s).run(...p); }
}

export async function createDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
    const db = new PgDb(pool);
    await db.init();
    return db;
  }
  const { DatabaseSync } = await import('node:sqlite');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new SqliteDb(new DatabaseSync(path.join(dataDir, 'game.db')));
  await db.init();
  return db;
}

// Seed redemption codes from REDEMPTION_CODES_SEED (JSON: { "CODE": "item_id", ... }
// or [ { "code": "...", "item": "..." }, ... ]). Codes never live in source control.
export async function seedCodes(db) {
  const raw = process.env.REDEMPTION_CODES_SEED;
  if (!raw) return 0;
  let entries = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed.map((e) => [e.code, e.item || e.item_id]);
    else entries = Object.entries(parsed);
  } catch {
    console.error('REDEMPTION_CODES_SEED is not valid JSON; skipping seed.');
    return 0;
  }
  let inserted = 0;
  for (const [code, item] of entries) {
    if (!code || !item) continue;
    const exists = await db.one('SELECT code FROM redemption_codes WHERE code = $1', [String(code).toUpperCase()]);
    if (!exists) {
      await db.run('INSERT INTO redemption_codes (code, item_id) VALUES ($1, $2)', [String(code).toUpperCase(), item]);
      inserted++;
    }
  }
  return inserted;
}
