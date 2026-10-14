import { handleApi } from "./api.js";
import { collect } from "./collector.js";

function unauthorized() {
  return new Response("Senha necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Radar", charset="UTF-8"' },
  });
}

function checkAuth(request, env) {
  if (!env.DASH_PASSWORD) return true; // sem senha definida: leitura liberada (alterações ficam bloqueadas)
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  if (pass.length !== env.DASH_PASSWORD.length) return false;
  let diff = 0;
  for (let i = 0; i < pass.length; i++) diff |= pass.charCodeAt(i) ^ env.DASH_PASSWORD.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (!checkAuth(request, env)) return unauthorized();
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(collect(env));
  },
};
