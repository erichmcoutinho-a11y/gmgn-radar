import { loadConfig, saveConfig, ensureSchema } from "./db.js";
import { DEFAULTS, PILLARS } from "./score.js";
import { collect } from "./collector.js";
import { sendTelegram } from "./telegram.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

function rowToToken(r) {
  return {
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    platform: r.platform,
    created: r.created_ts,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    score: r.score,
    grade: r.grade,
    phase: r.phase,
    pillars: parse(r.pillars, {}),
    flags: parse(r.flags, []),
    metrics: parse(r.metrics, {}),
    peakScore: r.peak_score,
    mc: r.mc,
    entryMc: r.entry_mc,
    alerted: r.alerted === 1,
    alertTs: r.alert_ts,
    outcome: r.o_entry_mc
      ? { entryMc: r.o_entry_mc, mc1h: r.o_1h, mc6h: r.o_6h, mc24h: r.o_24h, peakMc: r.o_peak }
      : undefined,
  };
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function listTokens(db, q) {
  const now = Math.floor(Date.now() / 1000);
  const where = ["passed=1"];
  const args = [];
  const add = (sql, v) => {
    args.push(v);
    where.push(sql.replace("?", `?${args.length}`));
  };
  if (q.get("all") !== "1") add("last_seen >= ?", now - 900);
  const phases = (q.get("phase") || "").split(",").filter(Boolean);
  if (phases.length) {
    const ph = phases.filter((p) => ["radar", "candidata", "alerta"].includes(p));
    if (ph.length) where.push(`phase IN (${ph.map((p) => `'${p}'`).join(",")})`);
  }
  if (q.get("minScore")) add("score >= ?", Number(q.get("minScore")) || 0);
  if (q.get("mcMin")) add("mc >= ?", Number(q.get("mcMin")) || 0);
  if (q.get("mcMax")) add("mc <= ?", Number(q.get("mcMax")) || 0);
  if (q.get("maxAge")) add("created_ts >= ?", now - (Number(q.get("maxAge")) || 0) * 60);
  if (q.get("smart") === "1") where.push("json_extract(metrics,'$.smart') >= 1");
  const text = (q.get("q") || "").trim();
  if (text) {
    args.push(`%${text}%`);
    where.push(`(symbol LIKE ?${args.length} OR name LIKE ?${args.length} OR address LIKE ?${args.length})`);
  }
  const sorts = {
    score: "score DESC",
    mc: "mc DESC",
    age: "created_ts DESC",
    smart: "json_extract(metrics,'$.smart') DESC, score DESC",
    traction: "json_extract(pillars,'$.traction.pts') DESC",
  };
  const order = sorts[q.get("sort")] || sorts.score;
  const rows = await db
    .prepare(`SELECT * FROM tokens WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`)
    .bind(...args)
    .all();
  return rows.results.map(rowToToken);
}

async function calibration(db) {
  const rows = (await db.prepare("SELECT * FROM outcomes ORDER BY entry_ts DESC LIMIT 1000").all()).results;
  const items = rows
    .filter((o) => o.entry_mc > 0)
    .map((o) => ({
      score: o.entry_score,
      pillars: parse(o.pillars, {}),
      peak: o.peak_mc ? o.peak_mc / o.entry_mc : null,
      m1: o.mc_1h ? o.mc_1h / o.entry_mc : null,
      m6: o.mc_6h ? o.mc_6h / o.entry_mc : null,
      m24: o.mc_24h ? o.mc_24h / o.entry_mc : null,
      done: o.done === 1,
    }));
  const summarize = (arr) => {
    const peaks = arr.map((i) => i.peak).filter((v) => v !== null);
    return {
      n: arr.length,
      medianPeak: median(peaks),
      pct2x: peaks.length ? peaks.filter((v) => v >= 2).length / peaks.length : null,
      pct5x: peaks.length ? peaks.filter((v) => v >= 5).length / peaks.length : null,
      pctDown: peaks.length ? peaks.filter((v) => v < 1.05).length / peaks.length : null,
    };
  };
  const bands = [
    ["50–59", 50, 59],
    ["60–69", 60, 69],
    ["70–79", 70, 79],
    ["80+", 80, 100],
  ].map(([label, lo, hi]) => ({ label, ...summarize(items.filter((i) => i.score >= lo && i.score <= hi)) }));
  const pillars = PILLARS.map((p) => {
    const hi = items.filter((i) => i.pillars[p.key] && i.pillars[p.key].pts / i.pillars[p.key].max >= 0.7);
    const lo = items.filter((i) => i.pillars[p.key] && i.pillars[p.key].pts / i.pillars[p.key].max < 0.7);
    return { key: p.key, label: p.label, high: summarize(hi), low: summarize(lo) };
  });
  return {
    total: items.length,
    closed: items.filter((i) => i.done).length,
    pending: items.filter((i) => !i.done).length,
    all: summarize(items),
    bands,
    pillars,
  };
}

async function status(db, env) {
  const runs = (await db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 20").all()).results;
  const now = Math.floor(Date.now() / 1000);
  const active = await db
    .prepare("SELECT COUNT(*) c FROM tokens WHERE passed=1 AND last_seen >= ?1")
    .bind(now - 900)
    .first();
  const last = runs[0];
  return {
    now,
    setup: {
      gmgn: Boolean(env.GMGN_API_KEY),
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      password: Boolean(env.DASH_PASSWORD),
    },
    active: active?.c ?? 0,
    last: last
      ? {
          ts: last.ts,
          ok: last.ok === 1,
          fetched: last.fetched,
          passed: last.passed,
          alerts: last.alerts,
          ms: last.ms,
          error: last.error,
          rejects: parse(last.rejects, {}),
        }
      : null,
    recent: runs.slice(0, 20).map((r) => ({ ts: r.ts, ok: r.ok === 1, fetched: r.fetched, passed: r.passed, error: r.error })),
  };
}

export async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) return json({ error: "Banco D1 não está ligado ao Worker (binding DB)." }, 500);
  await ensureSchema(db);
  const path = url.pathname;
  const method = request.method;
  const hasPassword = Boolean(env.DASH_PASSWORD);

  if (method === "GET" && path === "/api/status") return json(await status(db, env));
  if (method === "GET" && path === "/api/tokens") return json({ tokens: await listTokens(db, url.searchParams) });

  if (method === "GET" && path.startsWith("/api/token/")) {
    const address = decodeURIComponent(path.slice("/api/token/".length));
    const row = await db
      .prepare(
        `SELECT t.*, o.entry_mc o_entry_mc, o.mc_1h o_1h, o.mc_6h o_6h, o.mc_24h o_24h, o.peak_mc o_peak
         FROM tokens t LEFT JOIN outcomes o ON o.address=t.address WHERE t.address=?1`,
      )
      .bind(address)
      .first();
    if (!row) return json({ error: "Token não encontrado" }, 404);
    const snaps = (
      await db
        .prepare("SELECT ts, mc, holders, smart, score FROM snapshots WHERE address=?1 ORDER BY ts ASC LIMIT 800")
        .bind(address)
        .all()
    ).results;
    return json({ token: rowToToken(row), history: snaps });
  }

  if (method === "GET" && path === "/api/alerts") {
    const rows = await db
      .prepare(
        `SELECT t.*, o.entry_mc o_entry_mc, o.mc_1h o_1h, o.mc_6h o_6h, o.mc_24h o_24h, o.peak_mc o_peak
         FROM tokens t LEFT JOIN outcomes o ON o.address=t.address
         WHERE t.alerted=1 ORDER BY t.alert_ts DESC LIMIT 100`,
      )
      .all();
    return json({ tokens: rows.results.map(rowToToken) });
  }

  if (method === "GET" && path === "/api/calibration") return json(await calibration(db));

  if (method === "GET" && path === "/api/settings") {
    return json({ config: await loadConfig(db), defaults: DEFAULTS });
  }

  // Ações que alteram algo exigem senha configurada.
  if (method === "POST") {
    if (!hasPassword) {
      return json({ error: "Defina o segredo DASH_PASSWORD no Cloudflare para liberar alterações." }, 403);
    }
    if (path === "/api/settings") {
      const body = await request.json().catch(() => ({}));
      return json({ config: await saveConfig(db, body) });
    }
    if (path === "/api/run") return json(await collect(env, { force: true }));
    if (path === "/api/test-telegram") {
      const r = await sendTelegram(env, "✅ Radar conectado. Os alertas vão chegar aqui.");
      return json(r, r.ok ? 200 : 400);
    }
  }
  return json({ error: "Rota não encontrada" }, 404);
}
