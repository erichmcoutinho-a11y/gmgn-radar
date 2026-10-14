import { DEFAULTS } from "./score.js";

let ready = false;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT, name TEXT, platform TEXT,
    created_ts INTEGER, first_seen INTEGER, last_seen INTEGER,
    passed INTEGER DEFAULT 1,
    score INTEGER, grade TEXT, phase TEXT,
    pillars TEXT, flags TEXT, metrics TEXT,
    peak_score INTEGER DEFAULT 0,
    mc REAL, entry_mc REAL, entry_ts INTEGER,
    alerted INTEGER DEFAULT 0, alert_ts INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_rank ON tokens(passed, score DESC)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    address TEXT, ts INTEGER, mc REAL, holders INTEGER,
    smart INTEGER, kol INTEGER, net_buy REAL, swaps_1m INTEGER, score INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(address, ts)`,
  `CREATE TABLE IF NOT EXISTS outcomes (
    address TEXT PRIMARY KEY, symbol TEXT,
    entry_ts INTEGER, entry_mc REAL, entry_score INTEGER, entry_phase TEXT,
    pillars TEXT,
    mc_1h REAL, mc_6h REAL, mc_24h REAL, peak_mc REAL,
    done INTEGER DEFAULT 0, last_check INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER, ok INTEGER, fetched INTEGER, passed INTEGER,
    alerts INTEGER, ms INTEGER, error TEXT, rejects TEXT
  )`,
];

export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

export async function loadConfig(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key='config'").first();
  let saved = {};
  try {
    saved = row ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  return { ...DEFAULTS, ...saved };
}

export async function saveConfig(db, patch) {
  const current = await loadConfig(db);
  const next = { ...current };
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in patch)) continue;
    const def = DEFAULTS[k];
    const v = patch[k];
    if (typeof def === "number") {
      const x = Number(v);
      if (Number.isFinite(x)) next[k] = x;
    } else if (typeof def === "boolean") {
      next[k] = Boolean(v);
    } else if (Array.isArray(def)) {
      if (Array.isArray(v) && v.length) next[k] = v.filter((t) => def.includes(t));
    }
  }
  await db
    .prepare("INSERT INTO settings(key,value) VALUES('config',?1) ON CONFLICT(key) DO UPDATE SET value=?1")
    .bind(JSON.stringify(next))
    .run();
  return next;
}

export async function getState(db, key) {
  const row = await db.prepare("SELECT value FROM settings WHERE key=?1").bind(key).first();
  return row ? row.value : null;
}

export async function setState(db, key, value) {
  await db
    .prepare("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2")
    .bind(key, String(value))
    .run();
}
