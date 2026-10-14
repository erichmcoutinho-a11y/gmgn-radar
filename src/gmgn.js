// Cliente mínimo da API da GMGN (somente leitura). Base: https://openapi.gmgn.ai
// Autenticação: cabeçalho X-APIKEY + parâmetros timestamp e client_id na URL.

const DEFAULT_HOST = "https://openapi.gmgn.ai";

export class GmgnError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "GmgnError";
    Object.assign(this, info);
  }
}

async function request(env, method, path, query = {}, body = null) {
  if (!env.GMGN_API_KEY) throw new GmgnError("GMGN_API_KEY não configurada");
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  params.set("timestamp", String(Math.floor(Date.now() / 1000)));
  params.set("client_id", crypto.randomUUID());

  let res;
  try {
    res = await fetch(`${env.GMGN_HOST || DEFAULT_HOST}${path}?${params}`, {
      method,
      headers: {
        "X-APIKEY": env.GMGN_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "gmgn-radar/1.0",
      },
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
    throw new GmgnError(`Resposta não-JSON da GMGN (HTTP ${res.status}): ${text.slice(0, 160)}`, {
      status: res.status,
    });
  }
  if (json.code !== 0) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) || null;
    throw new GmgnError(
      `GMGN HTTP ${res.status} code=${json.code} ${json.error || ""} ${json.message || ""}`.trim(),
      { status: res.status, apiError: json.error, resetAt: reset },
    );
  }
  return json.data;
}

// Quote address types fixos da Solana, iguais aos do cliente oficial.
const SOL_QUOTES = [4, 5, 3, 1, 13, 0];

/** Lista de tokens de lançamento (pump.fun e similares) nos 3 estágios. */
export async function getTrenches(env, types, filters = {}, limit = 80) {
  const body = { version: "v2" };
  for (const t of types) {
    body[t] = {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit,
      quote_address_type: SOL_QUOTES,
      ...filters,
    };
  }
  const data = await request(env, "POST", "/v1/trenches", { chain: "sol" }, body);
  // near_completion volta na chave "pump"
  return [
    ...(data?.new_creation || []),
    ...(data?.pump || []),
    ...(data?.completed || []),
  ];
}

/** Dados de um token (usado só no acompanhamento de resultados). */
export function getTokenInfo(env, address) {
  return request(env, "GET", "/v1/token/info", { chain: "sol", address });
}

/** Market cap a partir do /token/info: preço × supply circulante. */
export function mcFromInfo(info) {
  const price = Number(info?.price?.price ?? info?.price);
  const supply = Number(info?.circulating_supply ?? info?.total_supply);
  const mc = price * supply;
  return Number.isFinite(mc) && mc > 0 ? mc : null;
}
