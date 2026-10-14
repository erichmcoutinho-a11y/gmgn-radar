// Servidor falso da GMGN só para testar localmente (node test/mock-gmgn.js)
import http from "node:http";
const now = () => Math.floor(Date.now() / 1000);
let tick = 0;
const mk = (i, over = {}) => ({
  address: `Mock${i}pump000000000000000000000000000000000000`.slice(0, 44),
  symbol: ["ALFA", "BETA", "GAMA", "DELTA", "OMEGA", "RUGGY", "BOTZ", "LATE"][i],
  name: "Mock " + i, launchpad_platform: "Pump.fun", exchange: "pump",
  usd_market_cap: 12000 + i * 4000 + tick * (i === 0 ? 2500 : 300),
  liquidity: 8000, holder_count: 60 + i * 20 + tick * (i === 0 ? 25 : 2),
  created_timestamp: now() - (10 + i * 7) * 60,
  swaps_1m: 12, swaps_1h: 300, swaps_24h: 300, volume_1h: 20000,
  buys_24h: 220, sells_24h: 90, net_buy_24h: 2000, progress: 0.35,
  rug_ratio: 0.04, bundler_trader_amount_rate: 0.05, rat_trader_amount_rate: 0.04,
  top_10_holder_rate: 0.2, fresh_wallet_rate: 0.1, bot_degen_rate: 0.1,
  creator_balance_rate: 0.02, smart_degen_count: i === 0 ? 2 + (tick > 2 ? 2 : 0) : i % 3,
  renowned_count: i === 0 ? 1 : 0, has_at_least_one_social: true, x_user_follower: 300 * i,
  ...over,
});
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/trenches") {
      tick++;
      const list = [0, 1, 2, 3, 4].map((i) => mk(i));
      list.push(mk(5, { rug_ratio: 0.6 }), mk(6, { bot_degen_rate: 0.8 }), mk(7, { usd_market_cap: 400000 }));
      return res.end(JSON.stringify({ code: 0, data: { new_creation: list.slice(0, 4), pump: list.slice(4, 6), completed: list.slice(6) } }));
    }
    if (url.pathname === "/v1/token/info")
      return res.end(JSON.stringify({ code: 0, data: { price: { price: 0.00005 }, circulating_supply: 1e9 } }));
    res.statusCode = 404; res.end(JSON.stringify({ code: 404, error: "NOT_FOUND" }));
  });
}).listen(8799, () => console.log("mock GMGN em :8799"));
