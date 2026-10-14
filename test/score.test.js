import assert from "node:assert/strict";
import { evaluate, DEFAULTS } from "../src/score.js";

const now = 1_800_000_000;
const base = (over = {}) => ({
  address: "ADDR", symbol: "TEST", name: "Test", launchpad_platform: "Pump.fun",
  usd_market_cap: 22000, liquidity: 9000, holder_count: 140,
  created_timestamp: now - 25 * 60,
  swaps_1m: 14, swaps_1h: 420, swaps_24h: 420,
  buys_24h: 300, sells_24h: 120, net_buy_24h: 2500, progress: 0.4,
  rug_ratio: 0.05, bundler_trader_amount_rate: 0.06, rat_trader_amount_rate: 0.05,
  top_10_holder_rate: 0.18, fresh_wallet_rate: 0.12, bot_degen_rate: 0.1,
  creator_balance_rate: 0.02, smart_degen_count: 3, renowned_count: 1,
  has_at_least_one_social: true, x_user_follower: 800, dexscr_update_link: true,
  ...over,
});
const hist = [
  { ts: now - 600, mc: 11000, holders: 80, smart: 1 },
  { ts: now - 300, mc: 16000, holders: 110, smart: 2 },
];

// 1. Token bom com histórico vira candidata/alerta e tem nota alta
const good = evaluate(base(), hist, DEFAULTS, now);
assert.equal(good.passed, true);
assert.ok(good.score >= 70, `nota esperada >= 70, veio ${good.score}`);
assert.ok(["candidata", "alerta"].includes(good.phase), good.phase);
assert.ok(good.flags.some((f) => /smart money entrando/.test(f)));

// 2. Soma dos pilares bate com a nota e respeita os máximos
const sum = Object.values(good.pillars).reduce((a, p) => a + p.pts, 0);
assert.ok(Math.abs(sum - good.score) <= 1, "soma dos pilares");
for (const p of Object.values(good.pillars)) assert.ok(p.pts <= p.max && p.pts >= 0);
assert.equal(Object.values(good.pillars).reduce((a, p) => a + p.max, 0), 100);

// 3. O caso do print (rug 29%, bundler 27%, bots 64%, MC 190K) é reprovado
const printCase = evaluate(
  base({ usd_market_cap: 190300, liquidity: 38300, holder_count: 1393, rug_ratio: 0.29,
         bundler_trader_amount_rate: 0.27, bot_degen_rate: 0.64, top_10_holder_rate: 0.17 }),
  [], DEFAULTS, now);
assert.equal(printCase.passed, false);
assert.ok(printCase.rejects.includes("bots demais"));
assert.ok(printCase.rejects.includes("MC alto (tarde)"));

// 4. Sem histórico nunca dispara alerta
const noHist = evaluate(base(), [], DEFAULTS, now);
assert.notEqual(noHist.phase, "alerta");
assert.ok(noHist.flags.includes("sem histórico ainda"));

// 5. Gates individuais
for (const [over, motivo] of [
  [{ is_wash_trading: true }, "wash trading"],
  [{ rug_ratio: 0.5 }, "rug alto"],
  [{ top_10_holder_rate: 0.6 }, "top10 concentrado"],
  [{ liquidity: 500 }, "liquidez baixa"],
  [{ holder_count: 3 }, "poucos holders"],
  [{ swaps_1h: 2 }, "sem atividade"],
  [{ created_timestamp: now - 9 * 3600 }, "token velho"],
  [{ renounced_mint: false }, "mint não renunciado"],
]) {
  const r = evaluate(base(over), hist, DEFAULTS, now);
  assert.ok(r.rejects.includes(motivo), `${motivo}: ${r.rejects}`);
}

// 6. Dados ausentes não quebram nem reprovam
const sparse = evaluate({ address: "X", symbol: "S", usd_market_cap: 20000, liquidity: 8000,
  holder_count: 60, swaps_1h: 50, created_timestamp: now - 600 }, [], DEFAULTS, now);
assert.equal(sparse.passed, true);
assert.ok(Number.isFinite(sparse.score));

// 7. Smart money e tração pesam: mesmo token sem smart e com MC caindo fica atrás
const weak = evaluate(base({ smart_degen_count: 0, renowned_count: 0 }),
  [{ ts: now - 600, mc: 30000, holders: 140, smart: 0 }], DEFAULTS, now);
assert.ok(weak.score < good.score, `${weak.score} < ${good.score}`);

// 8. Alta parabólica é sinalizada
const para = evaluate(base({ usd_market_cap: 60000 }), [{ ts: now - 600, mc: 8000, holders: 90, smart: 1 }], DEFAULTS, now);
assert.ok(para.flags.includes("alta parabólica"));

console.log("ok: todos os testes do motor passaram");
console.log("nota do token bom:", good.score, good.grade, good.phase, JSON.stringify(Object.fromEntries(Object.entries(good.pillars).map(([k,v])=>[k,v.pts]))));
