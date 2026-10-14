import { ensureSchema, loadConfig, getState, setState } from "./db.js";
import { evaluate } from "./score.js";
import { getTrenches, getTokenInfo, mcFromInfo } from "./gmgn.js";
import { buildAlert, sendTelegram } from "./telegram.js";

const MAX_ALERTS_PER_RUN = 5;
const MAX_INFO_CALLS_PER_RUN = 6;

async function runBatches(db, stmts) {
  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }
}

const UPSERT_TOKEN = `
INSERT INTO tokens(address,symbol,name,platform,created_ts,first_seen,last_seen,passed,
  score,grade,phase,pillars,flags,metrics,peak_score,mc,entry_mc,entry_ts)
VALUES(?1,?2,?3,?4,?5,?6,?6,1,?7,?8,?9,?10,?11,?12,?7,?13,?13,?6)
ON CONFLICT(address) DO UPDATE SET
  symbol=?2, name=?3, platform=?4, created_ts=?5, last_seen=?6, passed=1,
  score=?7, grade=?8, phase=?9, pillars=?10, flags=?11, metrics=?12,
  peak_score=MAX(peak_score, ?7), mc=?13`;

/**
 * Uma rodada completa: busca a GMGN, avalia, grava, alerta e acompanha resultados.
 * force=true ignora o intervalo configurado (usado pelo botão "Rodar agora").
 */
export async function collect(env, { force = false } = {}) {
  const db = env.DB;
  await ensureSchema(db);
  const cfg = await loadConfig(db);
  const now = Math.floor(Date.now() / 1000);

  if (!force) {
    const last = await db.prepare("SELECT ts FROM runs ORDER BY id DESC LIMIT 1").first();
    if (last && now - last.ts < cfg.intervalMin * 60 - 20) return { skipped: true };
  }

  // Se a GMGN bloqueou este endereço, espera o bloqueio acabar. Insistir prolonga a punição.
  const blockedUntil = Number((await getState(db, "blocked_until")) || 0);
  if (blockedUntil > now) {
    return { ok: false, skipped: true, blocked: true, error: blockedMessage(blockedUntil) };
  }

  const t0 = Date.now();
  const result = { ok: true, fetched: 0, passed: 0, alerts: 0, error: null, rejects: {} };
  const notes = [];

  try {
    const list = await getTrenches(env, cfg.types, {
      max_rug_ratio: cfg.maxRug,
      max_bundler_rate: cfg.maxBundler,
      max_insider_ratio: cfg.maxInsider,
      max_marketcap: cfg.maxMc,
      min_liquidity: cfg.minLiq,
    });
    const seen = new Map();
    for (const t of list) if (t?.address && !seen.has(t.address)) seen.set(t.address, t);
    result.fetched = seen.size;

    const existingRows = await db
      .prepare(
        "SELECT address, alerted FROM tokens WHERE last_seen >= ?1",
      )
      .bind(now - 3 * 86400)
      .all();
    const existing = new Map(existingRows.results.map((r) => [r.address, r]));

    const histRows = await db
      .prepare("SELECT address, ts, mc, holders, smart FROM snapshots WHERE ts >= ?1")
      .bind(now - 1500)
      .all();
    const hist = new Map();
    for (const h of histRows.results) {
      if (!hist.has(h.address)) hist.set(h.address, []);
      hist.get(h.address).push(h);
    }

    const stmts = [];
    const passed = [];
    const dropped = [];
    for (const [addr, raw] of seen) {
      const ev = evaluate(raw, hist.get(addr) || [], cfg, now);
      if (!ev.passed) {
        for (const r of ev.rejects) result.rejects[r] = (result.rejects[r] || 0) + 1;
        if (existing.has(addr)) dropped.push(addr);
        continue;
      }
      passed.push(ev);
    }
    result.passed = passed.length;

    for (const ev of passed) {
      const m = ev.metrics;
      stmts.push(
        db
          .prepare(UPSERT_TOKEN)
          .bind(
            ev.address, ev.symbol, ev.name, ev.platform, ev.created ?? null, now,
            ev.score, ev.grade, ev.phase,
            JSON.stringify(ev.pillars), JSON.stringify(ev.flags), JSON.stringify(m),
            m.mc ?? null,
          ),
        db
          .prepare(
            "INSERT INTO snapshots(address,ts,mc,holders,smart,kol,net_buy,swaps_1m,score) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
          )
          .bind(ev.address, now, m.mc ?? null, m.holders ?? null, m.smart, m.kol, m.netBuy ?? null, m.swaps1m ?? null, ev.score),
      );
      if (ev.phase !== "radar") {
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO outcomes(address,symbol,entry_ts,entry_mc,entry_score,entry_phase,pillars,peak_mc)
               VALUES(?1,?2,?3,?4,?5,?6,?7,?4)`,
            )
            .bind(ev.address, ev.symbol, now, m.mc ?? null, ev.score, ev.phase, JSON.stringify(ev.pillars)),
        );
      }
    }
    for (const addr of dropped) {
      stmts.push(db.prepare("UPDATE tokens SET passed=0, last_seen=?2 WHERE address=?1").bind(addr, now));
    }
    await runBatches(db, stmts);

    // Alertas (uma única vez por token)
    const toAlert = passed
      .filter((ev) => ev.phase === "alerta" && !(existing.get(ev.address)?.alerted))
      .sort((a, b) => b.score - a.score);
    const marks = [];
    for (const ev of toAlert) {
      if (result.alerts >= MAX_ALERTS_PER_RUN) break;
      if (cfg.telegramEnabled && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const sent = await sendTelegram(env, buildAlert(ev, now));
        if (!sent.ok) notes.push(`Telegram: ${sent.error}`);
      }
      marks.push(db.prepare("UPDATE tokens SET alerted=1, alert_ts=?2 WHERE address=?1").bind(ev.address, now));
      result.alerts++;
    }
    if (marks.length) await runBatches(db, marks);

    // Acompanhamento de resultados (base da calibração)
    await trackOutcomes(env, db, seen, now, notes);

    // Limpeza uma vez por hora
    if (now % 3600 < cfg.intervalMin * 60 + 60) {
      await db.batch([
        db.prepare("DELETE FROM snapshots WHERE ts < ?1").bind(now - 2 * 86400),
        db.prepare("DELETE FROM tokens WHERE last_seen < ?1").bind(now - 3 * 86400),
        db.prepare("DELETE FROM runs WHERE ts < ?1").bind(now - 3 * 86400),
      ]);
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
    if (e.status === 429 || /RATE_LIMIT/.test(e.apiError || "")) {
      const until = (e.resetAt && e.resetAt > now ? e.resetAt : now + 300) + 15;
      try {
        await setState(db, "blocked_until", until);
      } catch {
        /* segue sem registrar */
      }
      result.error = blockedMessage(until);
    }
  }

  if (notes.length) result.error = [result.error, ...notes].filter(Boolean).join(" | ");
  result.ms = Date.now() - t0;
  try {
    await db
      .prepare(
        "INSERT INTO runs(ts,ok,fetched,passed,alerts,ms,error,rejects) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
      )
      .bind(now, result.ok ? 1 : 0, result.fetched, result.passed, result.alerts, result.ms, result.error, JSON.stringify(result.rejects))
      .run();
  } catch {
    /* sem banco, nada a fazer */
  }
  return result;
}

export function blockedMessage(until) {
  const hora = new Date(until * 1000).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `A GMGN bloqueou temporariamente o endereço de rede da Cloudflare por excesso de pedidos. O radar espera sozinho e tenta de novo às ${hora} (Brasília).`;
}

async function trackOutcomes(env, db, seen, now, notes) {
  const pending = await db
    .prepare("SELECT * FROM outcomes WHERE done=0 AND last_check < ?1 ORDER BY last_check ASC LIMIT 12")
    .bind(now - 240)
    .all();
  let infoCalls = 0;
  const stmts = [];
  for (const o of pending.results) {
    const elapsed = now - o.entry_ts;
    let mc = null;
    const live = seen.get(o.address);
    if (live) mc = Number(live.usd_market_cap ?? live.market_cap) || null;
    else if (infoCalls < MAX_INFO_CALLS_PER_RUN) {
      infoCalls++;
      try {
        mc = mcFromInfo(await getTokenInfo(env, o.address));
      } catch (e) {
        notes.push(`Acompanhamento: ${e.message}`);
        if (/RATE_LIMIT|429/.test(e.message)) break;
      }
    }
    const peak = Math.max(o.peak_mc || 0, mc || 0) || null;
    const m1 = o.mc_1h ?? (mc && elapsed >= 3600 ? mc : null);
    const m6 = o.mc_6h ?? (mc && elapsed >= 6 * 3600 ? mc : null);
    const m24 = o.mc_24h ?? (mc && elapsed >= 24 * 3600 ? mc : null);
    const done = (m24 !== null && elapsed >= 24 * 3600) || elapsed > 30 * 3600 ? 1 : 0;
    stmts.push(
      db
        .prepare("UPDATE outcomes SET peak_mc=?2, mc_1h=?3, mc_6h=?4, mc_24h=?5, done=?6, last_check=?7 WHERE address=?1")
        .bind(o.address, peak, m1, m6, m24, done, now),
    );
  }
  if (stmts.length) await runBatches(db, stmts);
}
