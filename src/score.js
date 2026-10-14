// Motor de nota v2: filtros eliminatórios + 6 pilares (0–100).
// Função pura: recebe o token cru da GMGN + histórico de snapshots e devolve a avaliação.

export const DEFAULTS = {
  // --- coleta ---
  intervalMin: 3, // de quantos em quantos minutos consultar a GMGN
  types: ["new_creation", "near_completion", "completed"],
  // --- filtros eliminatórios (reprovou em qualquer um = fora) ---
  maxRug: 0.3,
  maxBundler: 0.3,
  maxInsider: 0.3,
  maxTop10: 0.4,
  maxBot: 0.5,
  maxFresh: 0.45,
  maxCreatorBal: 0.25,
  maxEntrapment: 0.3,
  minLiq: 3000,
  minMc: 3000,
  maxMc: 150000,
  maxAgeMin: 360,
  minHolders: 15,
  minSwaps1h: 10,
  // --- fases ---
  candidateScore: 60,
  candidateTraction: 0.4,
  alertScore: 72,
  alertTraction: 0.5,
  alertMinSmart: 0,
  telegramEnabled: true,
};

export const PILLARS = [
  { key: "traction", label: "Tração", max: 25 },
  { key: "smart", label: "Smart money", max: 20 },
  { key: "flow", label: "Fluxo", max: 15 },
  { key: "health", label: "Saúde", max: 20 },
  { key: "stage", label: "Estágio", max: 15 },
  { key: "social", label: "Social", max: 5 },
];

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const z = (v) => (v === null || v === undefined ? 0 : v);
const pct = (v) => Math.round(z(v) * 100);

/** Converte o item cru da GMGN em campos que o motor entende (null = dado ausente). */
export function normalize(t) {
  const buys = num(t.buys_24h);
  const sells = num(t.sells_24h);
  const hasSocial =
    t.has_at_least_one_social ?? Boolean(t.twitter || t.telegram || t.website);
  return {
    address: t.address,
    symbol: t.symbol || "?",
    name: t.name || "",
    platform: t.launchpad_platform || t.launchpad || "",
    exchange: t.exchange || "",
    mc: num(t.usd_market_cap ?? t.market_cap),
    liq: num(t.liquidity),
    created: num(t.created_timestamp ?? t.creation_timestamp),
    holders: num(t.holder_count),
    swaps1m: num(t.swaps_1m),
    swaps1h: num(t.swaps_1h),
    swaps24h: num(t.swaps_24h),
    vol1h: num(t.volume_1h),
    vol24h: num(t.volume_24h),
    buys,
    sells,
    netBuy: num(t.net_buy_24h),
    progress: num(t.progress ?? t.launchpad_progress),
    rug: num(t.rug_ratio),
    bundler: num(t.bundler_trader_amount_rate ?? t.bundler_rate),
    insider: num(t.rat_trader_amount_rate),
    top10: num(t.top_10_holder_rate),
    fresh: num(t.fresh_wallet_rate),
    bot: num(t.bot_degen_rate),
    entrapment: num(t.entrapment_ratio),
    sniperHold: num(t.top70_sniper_hold_rate),
    creatorBal: num(t.creator_balance_rate),
    creatorStatus: t.creator_token_status || "",
    smart: num(t.smart_degen_count) ?? 0,
    kol: num(t.renowned_count) ?? 0,
    wash: t.is_wash_trading === true || t.is_wash_trading === 1,
    honeypot: t.is_honeypot === "yes" || t.is_honeypot === 1 || t.is_honeypot === true,
    mintRenounced: t.renounced_mint,
    hasSocial: Boolean(hasSocial),
    xFollowers: num(t.x_user_follower),
    tgCalls: num(t.tg_call_count),
    xRenames: num(t.twitter_rename_count),
    dexUpdate: Boolean(t.dexscr_update_link),
    dexAd: Boolean(t.dexscr_ad),
    visits: num(t.visiting_count),
  };
}

/** Filtros eliminatórios. Devolve a lista de motivos de reprovação (vazia = passou). */
export function gates(m, cfg, now) {
  const r = [];
  const age = m.created ? (now - m.created) / 60 : null;
  if (m.wash) r.push("wash trading");
  if (m.honeypot) r.push("honeypot");
  if (m.mintRenounced === false) r.push("mint não renunciado");
  if (m.rug !== null && m.rug > cfg.maxRug) r.push("rug alto");
  if (m.bundler !== null && m.bundler > cfg.maxBundler) r.push("bundler alto");
  if (m.insider !== null && m.insider > cfg.maxInsider) r.push("insiders altos");
  if (m.top10 !== null && m.top10 > cfg.maxTop10) r.push("top10 concentrado");
  if (m.bot !== null && m.bot > cfg.maxBot) r.push("bots demais");
  if (m.fresh !== null && m.fresh > cfg.maxFresh) r.push("carteiras novas demais");
  if (m.creatorBal !== null && m.creatorBal > cfg.maxCreatorBal) r.push("dev segura muito");
  if (m.entrapment !== null && m.entrapment > cfg.maxEntrapment) r.push("phishing/armadilha");
  if (m.liq !== null && m.liq < cfg.minLiq) r.push("liquidez baixa");
  if (m.mc === null || m.mc < cfg.minMc) r.push("MC muito baixo");
  if (m.mc !== null && m.mc > cfg.maxMc) r.push("MC alto (tarde)");
  if (age !== null && age > cfg.maxAgeMin) r.push("token velho");
  if (m.holders !== null && m.holders < cfg.minHolders) r.push("poucos holders");
  if (m.swaps1h !== null && m.swaps1h < cfg.minSwaps1h) r.push("sem atividade");
  return r;
}

/** Escolhe o snapshot de referência: o mais antigo dentro de 20 min, com pelo menos 3 min de distância. */
function pickRef(hist, now) {
  if (!hist || !hist.length) return null;
  const old = hist.filter((h) => now - h.ts >= 180 && now - h.ts <= 1200);
  if (!old.length) return null;
  return old.reduce((a, b) => (a.ts <= b.ts ? a : b));
}

function tractionPillar(m, ref, now) {
  const age = m.created ? Math.max((now - m.created) / 60, 1) : null;
  let holderPts;
  let mcPts;
  let note = null;
  if (ref && ref.holders > 0 && m.holders !== null) {
    const mins = (now - ref.ts) / 60;
    const rate = (m.holders / ref.holders - 1) * (10 / mins); // crescimento relativo a cada 10 min
    holderPts = 10 * clamp(rate / 0.3);
  } else if (m.holders !== null && age) {
    holderPts = 10 * clamp(m.holders / age / 3) * 0.6; // sem histórico: proxy com desconto
  } else holderPts = 0;

  if (ref && ref.mc > 0 && m.mc) {
    const g = m.mc / ref.mc - 1;
    if (g < 0) mcPts = 0;
    else if (g < 0.15) mcPts = 8 * (g / 0.15) * 0.6;
    else if (g <= 1.5) mcPts = 8;
    else if (g <= 3) mcPts = 8 - 5 * ((g - 1.5) / 1.5);
    else {
      mcPts = 3;
      note = "alta parabólica";
    }
  } else mcPts = 3;

  let accPts = 3;
  if (m.swaps1h !== null && m.swaps1h >= 20 && m.swaps1m !== null) {
    const ratio = (m.swaps1m * 60) / m.swaps1h;
    accPts = 7 * clamp((ratio - 0.6) / 0.8);
  }
  return { pts: holderPts + mcPts + accPts, note };
}

function stagePillar(m) {
  const mc = m.mc ?? 0;
  let band;
  if (mc <= 5000) band = 6;
  else if (mc <= 8000) band = 6 + 4 * ((mc - 5000) / 3000);
  else if (mc <= 45000) band = 10;
  else if (mc <= 100000) band = 10 - 3 * ((mc - 45000) / 55000);
  else if (mc <= 150000) band = 7 - 3 * ((mc - 100000) / 50000);
  else band = 2;
  const hold = 5 * clamp(((m.holders ?? 0) - 15) / 185);
  return band + hold;
}

export function evaluate(raw, hist, cfg, now) {
  const m = normalize(raw);
  const rejects = gates(m, cfg, now);
  const ref = pickRef(hist, now);
  const hasHistory = Boolean(ref);

  // Tração
  const tr = tractionPillar(m, ref, now);

  // Smart money
  const s = m.smart;
  const smartBase = s <= 0 ? 0 : [0, 7, 11, 14, 16][s] ?? 18;
  const smartBonus = (m.kol >= 1 ? 2 : 0) + (s >= 1 && (m.mc ?? 0) <= 40000 ? 2 : 0);
  const smartPts = Math.min(20, smartBase + smartBonus);
  let smartDelta = 0;
  if (ref) smartDelta = s - (ref.smart ?? 0);

  // Fluxo
  let flowPts = 0;
  const tot = z(m.buys) + z(m.sells);
  if (tot >= 20) flowPts += 6 * clamp((m.buys / tot - 0.45) / 0.2);
  else flowPts += 2;
  if (m.netBuy !== null && m.mc) flowPts += 5 * clamp(m.netBuy / m.mc / 0.1);
  if (m.progress === null) flowPts += 2;
  else if (m.progress >= 0.2 && m.progress <= 0.85) flowPts += 4;
  else if (m.progress > 0.85 && m.progress < 0.99) flowPts += 3;
  else flowPts += 1;

  // Saúde
  const pen = (v, lim, w) => (v === null ? 0 : w * clamp(v / lim));
  let penalty =
    pen(m.rug, cfg.maxRug, 5) +
    pen(m.bundler, cfg.maxBundler, 4) +
    pen(m.insider, cfg.maxInsider, 3) +
    pen(m.top10, cfg.maxTop10, 3) +
    pen(m.fresh, cfg.maxFresh, 1.5) +
    pen(m.bot, cfg.maxBot, 1.5) +
    pen(m.creatorBal, cfg.maxCreatorBal, 1) +
    pen(m.entrapment, cfg.maxEntrapment, 1);
  const serialX = m.xRenames !== null && m.xRenames >= 3;
  if (serialX) penalty += 1;
  const healthPts = Math.max(0, 20 - penalty);

  // Estágio e social
  const stagePts = stagePillar(m);
  let socialPts = 0;
  if (m.hasSocial) socialPts += 1.5;
  socialPts += 1.5 * clamp((m.xFollowers ?? 0) / 1000);
  if ((m.tgCalls ?? 0) >= 1) socialPts += 1;
  if (m.dexUpdate) socialPts += 1;

  const raws = {
    traction: tr.pts,
    smart: smartPts,
    flow: flowPts,
    health: healthPts,
    stage: stagePts,
    social: socialPts,
  };
  const pillars = {};
  let total = 0;
  for (const p of PILLARS) {
    const v = Math.min(p.max, Math.max(0, raws[p.key]));
    pillars[p.key] = { pts: Math.round(v * 10) / 10, max: p.max };
    total += v;
  }
  const score = Math.round(total);
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";

  // Alertas de atenção
  const flags = [];
  if (m.rug !== null && m.rug >= 0.15) flags.push(`rug ${pct(m.rug)}%`);
  if (m.bundler !== null && m.bundler >= 0.15) flags.push(`bundler ${pct(m.bundler)}%`);
  if (m.insider !== null && m.insider >= 0.15) flags.push(`insiders ${pct(m.insider)}%`);
  if (m.bot !== null && m.bot >= 0.3) flags.push(`bots ${pct(m.bot)}%`);
  if (m.top10 !== null && m.top10 >= 0.25) flags.push(`top10 ${pct(m.top10)}%`);
  if (m.creatorBal !== null && m.creatorBal >= 0.1) flags.push(`dev segura ${pct(m.creatorBal)}%`);
  if (serialX) flags.push("conta X serial");
  if (tr.note) flags.push(tr.note);
  if (smartDelta > 0) flags.push(`smart money entrando (+${smartDelta})`);
  if (!hasHistory) flags.push("sem histórico ainda");

  const tractionPct = pillars.traction.pts / pillars.traction.max;
  let phase = "radar";
  if (score >= cfg.candidateScore && tractionPct >= cfg.candidateTraction) phase = "candidata";
  if (
    hasHistory &&
    score >= cfg.alertScore &&
    tractionPct >= cfg.alertTraction &&
    m.smart >= cfg.alertMinSmart
  )
    phase = "alerta";

  const ageMin = m.created ? Math.round((now - m.created) / 60) : null;
  return {
    address: m.address,
    symbol: m.symbol,
    name: m.name,
    platform: m.platform,
    passed: rejects.length === 0,
    rejects,
    score,
    grade,
    phase,
    pillars,
    flags,
    hasHistory,
    metrics: {
      mc: m.mc,
      liq: m.liq,
      holders: m.holders,
      smart: m.smart,
      kol: m.kol,
      vol1h: m.vol1h,
      buys: m.buys,
      sells: m.sells,
      netBuy: m.netBuy,
      progress: m.progress,
      ageMin,
      swaps1m: m.swaps1m,
      rug: m.rug,
      bundler: m.bundler,
      insider: m.insider,
      top10: m.top10,
      fresh: m.fresh,
      bot: m.bot,
      creatorBal: m.creatorBal,
      xFollowers: m.xFollowers,
    },
    created: m.created,
  };
}
