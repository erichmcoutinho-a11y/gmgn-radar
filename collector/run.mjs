// Coletor: roda no GitHub Actions a cada 5 minutos.
// 1) pergunta ao site quais filtros usar e o que acompanhar
// 2) consulta a GMGN
// 3) entrega a lista ao site, que dá a nota, grava e avisa no Telegram
//
// Variáveis (vêm dos "Secrets" do GitHub):
//   GMGN_API_KEY    chave da GMGN
//   RADAR_URL       endereço do site, ex.: https://gmgn-radar.seu-nome.workers.dev
//   RADAR_PASSWORD  a mesma senha do painel (DASH_PASSWORD)

const { GMGN_API_KEY, RADAR_URL, RADAR_PASSWORD } = process.env;
const GMGN_HOST = process.env.GMGN_HOST || "https://openapi.gmgn.ai";
const MAX_RUN_MS = Number(process.env.MAX_RUN_MS || 4 * 60 * 1000);
const MAX_INFO_CALLS = 6;

for (const [k, v] of Object.entries({ GMGN_API_KEY, RADAR_URL, RADAR_PASSWORD })) {
  if (!v) {
    console.error(`Falta o segredo ${k} no GitHub (Settings → Secrets and variables → Actions).`);
    process.exit(1);
  }
}

const base = RADAR_URL.trim().replace(/\/+$/, "");
const basic = "Basic " + Buffer.from("radar:" + RADAR_PASSWORD).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

class GmgnError extends Error {
  constructor(message, info = {}) {
    super(message);
    Object.assign(this, info);
  }
}

async function radar(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: basic, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON */
  }
  if (!res.ok || !json) {
    const hint =
      res.status === 401
        ? " (a senha RADAR_PASSWORD não bate com a DASH_PASSWORD do site)"
        : res.status === 403
          ? " (o site ainda não tem o segredo DASH_PASSWORD)"
          : "";
    throw new Error(`Site respondeu HTTP ${res.status}${hint}: ${text.slice(0, 160)}`);
  }
  return json;
}

async function gmgn(method, path, query = {}, body = null) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  params.set("timestamp", String(Math.floor(Date.now() / 1000)));
  params.set("client_id", crypto.randomUUID());
  let res;
  try {
    res = await fetch(`${GMGN_HOST}${path}?${params}`, {
      method,
      headers: { "X-APIKEY": GMGN_API_KEY, "Content-Type": "application/json", "User-Agent": "gmgn-radar/1.0" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new GmgnError(`Falha de rede ao chamar a GMGN: ${e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GmgnError(`Resposta não-JSON da GMGN (HTTP ${res.status}): ${text.slice(0, 160)}`, { status: res.status });
  }
  if (json.code !== 0) {
    const headerReset = Number(res.headers.get("x-ratelimit-reset")) || 0;
    throw new GmgnError(`GMGN HTTP ${res.status} code=${json.code} ${json.error || ""} ${json.message || ""}`.trim(), {
      status: res.status,
      apiError: json.error,
      resetAt: Number(json.reset_at) || headerReset || 0,
    });
  }
  return json.data;
}

const SOL_QUOTES = [4, 5, 3, 1, 13, 0];

async function getTrenches(c) {
  const body = { version: "v2" };
  for (const t of c.types) {
    body[t] = {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit: 80,
      quote_address_type: SOL_QUOTES,
      max_rug_ratio: c.maxRug,
      max_bundler_rate: c.maxBundler,
      max_insider_ratio: c.maxInsider,
      max_marketcap: c.maxMc,
      min_liquidity: c.minLiq,
    };
  }
  const data = await gmgn("POST", "/v1/trenches", { chain: "sol" }, body);
  return [...(data?.new_creation || []), ...(data?.pump || []), ...(data?.completed || [])];
}

async function marketCapOf(address) {
  const info = await gmgn("GET", "/v1/token/info", { chain: "sol", address });
  const mc = Number(info?.price?.price ?? info?.price) * Number(info?.circulating_supply ?? info?.total_supply);
  return Number.isFinite(mc) && mc > 0 ? mc : null;
}

/** Uma rodada. Devolve o intervalo (ms) desejado até a próxima. */
async function once() {
  const cfg = await radar("/api/ingest-config");
  const interval = Math.max(60, Number(cfg.config.intervalMin || 3) * 60) * 1000;

  if (cfg.blockedUntil > Math.floor(Date.now() / 1000)) {
    log(`GMGN em bloqueio até ${new Date(cfg.blockedUntil * 1000).toISOString()}. Não vou insistir.`);
    return { interval, blocked: true };
  }

  try {
    const list = await getTrenches(cfg.config);
    const inList = new Set(list.map((t) => t.address));
    const mcs = {};
    let calls = 0;
    for (const addr of cfg.pending) {
      if (inList.has(addr) || calls >= MAX_INFO_CALLS) continue;
      calls++;
      try {
        const mc = await marketCapOf(addr);
        if (mc) mcs[addr] = mc;
      } catch (e) {
        if (e.status === 429) throw e;
        log("Acompanhamento falhou:", e.message);
      }
    }
    const r = await radar("/api/ingest", { list, mcs });
    log(`Enviado: ${r.fetched} lidas, ${r.passed} passaram, ${r.alerts} alertas.${r.error ? " Aviso: " + r.error : ""}`);
  } catch (e) {
    if (e instanceof GmgnError) {
      log("GMGN recusou:", e.message);
      await radar("/api/ingest", {
        error: { message: e.message, status: e.status, apiError: e.apiError, resetAt: e.resetAt },
      });
      return { interval, blocked: e.status === 429 };
    }
    throw e;
  }
  return { interval, blocked: false };
}

const deadline = Date.now() + MAX_RUN_MS;
for (;;) {
  const { interval, blocked } = await once();
  if (blocked || Date.now() + interval > deadline) break;
  await sleep(interval);
}
log("Fim desta execução.");
