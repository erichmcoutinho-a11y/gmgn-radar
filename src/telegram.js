import { PILLARS } from "./score.js";

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function blocks(ratio, n) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * n);
  const color = ratio >= 0.7 ? "🟩" : ratio >= 0.5 ? "🟨" : ratio >= 0.3 ? "🟧" : "🟥";
  return color.repeat(filled) + "⬜".repeat(n - filled);
}

const money = (v) => {
  if (v === null || v === undefined) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
};

export function buildAlert(ev, now) {
  const m = ev.metrics;
  const lines = [];
  lines.push(`🎯 <b>${esc(ev.symbol)}</b> · classe ${ev.grade} · nota ${ev.score}/100`);
  lines.push(blocks(ev.score / 100, 10));
  lines.push("");
  for (const p of PILLARS) {
    const v = ev.pillars[p.key];
    lines.push(`${esc(p.label)} ${blocks(v.pts / v.max, 6)} ${Math.round(v.pts)}/${v.max}`);
  }
  if (ev.flags.length) {
    lines.push("");
    lines.push(`⚠️ ${esc(ev.flags.join(" · "))}`);
  }
  lines.push("");
  lines.push(
    `MC ${money(m.mc)} · Liq ${money(m.liq)} · Holders ${m.holders ?? "—"} · ${m.ageMin ?? "?"} min`,
  );
  lines.push(`🧠 Smart ${m.smart} · KOL ${m.kol} · Fluxo 24h ${money(m.netBuy)}`);
  lines.push(`Plataforma: ${esc(ev.platform || "—")}`);
  lines.push("");
  lines.push(`<code>${esc(ev.address)}</code>`);
  lines.push(
    `<a href="https://gmgn.ai/sol/token/${esc(ev.address)}">GMGN</a> · <a href="https://dexscreener.com/solana/${esc(ev.address)}">Dexscreener</a>`,
  );
  lines.push("");
  lines.push("A nota ranqueia qualidade e tração. Não prevê lucro.");
  return lines.join("\n");
}

export async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, error: "Telegram não configurado" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
