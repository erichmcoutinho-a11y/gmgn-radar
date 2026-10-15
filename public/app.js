"use strict";

const PILLARS = [
  ["traction", "Tração", 25],
  ["smart", "Smart money", 20],
  ["flow", "Fluxo", 15],
  ["health", "Saúde", 20],
  ["stage", "Estágio", 15],
  ["social", "Social", 5],
];

const FIELDS = [
  {
    group: "Filtros eliminatórios",
    hint: "Se a moeda reprovar em qualquer um, ela nem recebe nota.",
    items: [
      ["maxRug", "Rug máximo (%)", "pct"],
      ["maxBundler", "Bundler máximo (%)", "pct"],
      ["maxInsider", "Insiders máximo (%)", "pct"],
      ["maxTop10", "Top 10 holders máximo (%)", "pct"],
      ["maxBot", "Bots máximo (%)", "pct"],
      ["maxFresh", "Carteiras novas máximo (%)", "pct"],
      ["maxCreatorBal", "Dev segurando máximo (%)", "pct"],
      ["maxEntrapment", "Phishing máximo (%)", "pct"],
      ["minLiq", "Liquidez mínima (US$)", "num"],
      ["minMc", "MC mínimo (US$)", "num"],
      ["maxMc", "MC máximo (US$)", "num"],
      ["maxAgeMin", "Idade máxima (min)", "num"],
      ["minHolders", "Holders mínimos", "num"],
      ["minSwaps1h", "Trades mínimos na última hora", "num"],
    ],
  },
  {
    group: "Fases e alerta",
    hint: "Candidata aparece em destaque no ranking. Alerta dispara o Telegram, e só vale com histórico de pelo menos 3 minutos.",
    items: [
      ["candidateScore", "Candidata: nota mínima", "num"],
      ["candidateTraction", "Candidata: tração mínima (%)", "pct"],
      ["alertScore", "Alerta: nota mínima", "num"],
      ["alertTraction", "Alerta: tração mínima (%)", "pct"],
      ["alertMinSmart", "Alerta: smart money mínimo", "num"],
      ["telegramEnabled", "Enviar alertas ao Telegram", "bool"],
    ],
  },
  {
    group: "Coleta",
    hint: "Intervalo entre consultas à GMGN. Menos tempo dá mais precisão e usa mais do limite gratuito da Cloudflare.",
    items: [["intervalMin", "Consultar a cada (min)", "num"]],
  },
];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtMoney = (v) => {
  if (v === null || v === undefined) return "—";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2).replace(".", ",") + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1).replace(".", ",") + "K";
  return "$" + Math.round(v);
};
const fmtPct = (v) => (v === null || v === undefined ? "—" : Math.round(v * 100) + "%");
const fmtAge = (min) => {
  if (min === null || min === undefined) return "—";
  if (min < 60) return min + " min";
  if (min < 1440) return Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0");
  return Math.floor(min / 1440) + "d";
};
const fmtMult = (v) => (v === null || v === undefined ? "—" : v.toFixed(v >= 10 ? 0 : 1).replace(".", ",") + "x");
const ago = (ts, now) => {
  const s = Math.max(0, (now ?? Date.now() / 1000) - ts);
  if (s < 90) return Math.round(s) + " s atrás";
  if (s < 5400) return Math.round(s / 60) + " min atrás";
  return Math.round(s / 3600) + " h atrás";
};

function strip(ratio, n, cls) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * n);
  const c = cls || (ratio >= 0.7 ? "g" : ratio >= 0.5 ? "y" : ratio >= 0.3 ? "o" : "r");
  let h = `<span class="strip ${c}" role="img" aria-label="${Math.round(ratio * 100)}% do máximo">`;
  for (let i = 0; i < n; i++) h += `<i class="${i < filled ? "on" : ""}"></i>`;
  return h + "</span>";
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

/* ---------- estado ---------- */
let current = null; // endereço aberto no painel de detalhe
let tokens = [];
let loadedTabs = new Set();

/* ---------- abas ---------- */
function showTab(name) {
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
  if (name === "alerts") loadAlerts();
  if (name === "calib") loadCalib();
  if (name === "settings") loadSettings();
  history.replaceState(null, "", "#" + name);
}
$(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});

/* ---------- status ---------- */
async function loadStatus() {
  try {
    const s = await api("/api/status");
    const dot = $("#pulseDot");
    const txt = $("#pulseText");
    if (!s.last) {
      dot.className = "dot";
      txt.textContent = "Aguardando a primeira rodada";
    } else if (s.last.ok) {
      dot.className = "dot ok";
      txt.textContent = `${s.active} moedas ativas · atualizado ${ago(s.last.ts, s.now)}`;
    } else {
      dot.className = "dot bad";
      txt.textContent = `Última rodada falhou ${ago(s.last.ts, s.now)}`;
    }
    const b = $("#banner");
    const missing = [];
    if (!s.setup.password) missing.push("a senha do painel (<b>DASH_PASSWORD</b>)");
    if (!s.setup.telegram) missing.push("o Telegram (<b>TELEGRAM_BOT_TOKEN</b> e <b>TELEGRAM_CHAT_ID</b>), opcional");
    const idleMin = s.last ? Math.round((s.now - s.last.ts) / 60) : null;
    if (s.blockedUntil) {
      const hora = new Date(s.blockedUntil * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      b.className = "banner err";
      b.innerHTML = `<b>A GMGN bloqueou temporariamente o endereço de rede do coletor.</b> Ele espera sozinho e volta a tentar depois das ${hora}.`;
      b.hidden = false;
    } else if (s.last && !s.last.ok) {
      b.className = "banner err";
      b.innerHTML = `<b>A GMGN não respondeu como esperado.</b> ${esc(s.last.error || "")}`;
      b.hidden = false;
    } else if (!s.last) {
      b.className = "banner";
      b.innerHTML = "<b>Nenhum dado chegou ainda.</b> Quem consulta a GMGN é o coletor do GitHub (aba Actions do seu repositório). Veja o passo 4 do LEIAME.";
      b.hidden = false;
    } else if (idleMin > 15) {
      b.className = "banner err";
      b.innerHTML = `<b>O coletor não envia dados há ${idleMin} minutos.</b> Abra a aba Actions do repositório no GitHub e veja se a última execução do Coletor falhou.`;
      b.hidden = false;
    } else if (missing.length) {
      b.className = "banner";
      b.innerHTML = "Falta configurar: " + missing.join("; ") + ". Veja o passo a passo no LEIAME.";
      b.hidden = false;
    } else b.hidden = true;
    return s;
  } catch (e) {
    $("#pulseDot").className = "dot bad";
    $("#pulseText").textContent = e.message;
  }
}

$("#runNow").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await Promise.all([loadStatus(), loadTokens()]);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- ranking ---------- */
function rowHtml(t) {
  const m = t.metrics || {};
  const pil = PILLARS.map(([k, , max]) => strip((t.pillars[k]?.pts ?? 0) / max, 5)).join("");
  return `<button class="row" role="listitem" data-addr="${esc(t.address)}" aria-pressed="${t.address === current}">
    <div class="score g-${t.grade}">${t.score}<small>classe ${t.grade}</small></div>
    <div class="name"><b>${esc(t.symbol)}</b><span>${esc(t.platform || "—")} · ${fmtAge(m.ageMin)}</span></div>
    <div class="minis" title="Tração · Smart money · Fluxo · Saúde · Estágio · Social">${pil}</div>
    <div class="num">${fmtMoney(m.mc)}<small>MC</small></div>
    <div class="num c-hold">${m.holders ?? "—"}<small>holders</small></div>
    <div class="num c-smart">${m.smart ?? 0}<small>smart</small></div>
    <span class="phase ${t.phase}">${t.phase === "alerta" ? "Alerta" : t.phase === "candidata" ? "Candidata" : "Radar"}</span>
  </button>`;
}

async function loadTokens() {
  const f = new FormData($("#filters"));
  const q = new URLSearchParams();
  for (const [k, v] of f) if (String(v).trim() !== "") q.set(k, v);
  try {
    tokens = (await api("/api/tokens?" + q)).tokens;
  } catch (e) {
    $("#list").innerHTML = `<div class="empty"><b>Não foi possível carregar</b>${esc(e.message)}</div>`;
    return;
  }
  $("#count").textContent = tokens.length + (tokens.length === 1 ? " moeda" : " moedas");
  if (!tokens.length) {
    $("#list").innerHTML = `<div class="empty"><b>Nenhuma moeda passou pelos filtros agora</b>O coletor consulta a GMGN a cada poucos minutos. Se ainda não chegou nada, veja o aviso no topo. Se chegou e tudo foi cortado, veja em Ajustes o que está cortando as moedas e relaxe os filtros.</div>`;
  } else {
    $("#list").innerHTML = tokens.map(rowHtml).join("");
  }
  if (current && tokens.some((t) => t.address === current)) openDetail(current, true);
}

$("#filters").addEventListener("input", debounce(loadTokens, 300));
$("#filters").addEventListener("submit", (e) => e.preventDefault());
$("#list").addEventListener("click", (e) => {
  const r = e.target.closest(".row");
  if (r) openDetail(r.dataset.addr);
});

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function spark(history) {
  const pts = history.filter((h) => h.mc);
  if (pts.length < 2) return `<p class="sub">O gráfico aparece depois de algumas rodadas.</p>`;
  const w = 380, h = 90, pad = 4;
  const xs = pts.map((p) => p.ts);
  const ys = pts.map((p) => p.mc);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const px = (x) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (w - pad * 2);
  const py = (y) => h - pad - ((y - y0) / Math.max(1, y1 - y0)) * (h - pad * 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${px(p.ts).toFixed(1)},${py(p.mc).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Market cap ao longo do tempo">
    <path d="${d}" fill="none" stroke="#f0b64a" stroke-width="2" stroke-linejoin="round"/>
  </svg><p class="sub">Market cap de ${fmtMoney(ys[0])} para ${fmtMoney(ys[ys.length - 1])} em ${fmtAge(Math.round((x1 - x0) / 60))}.</p>`;
}

async function openDetail(addr, quiet) {
  current = addr;
  $$(".row").forEach((r) => r.setAttribute("aria-pressed", String(r.dataset.addr === addr)));
  const t = tokens.find((x) => x.address === addr) || null;
  const box = $("#detail");
  $(".split").classList.add("open");
  box.hidden = false;
  if (!quiet && window.innerWidth < 1100) box.scrollIntoView({ behavior: "smooth", block: "start" });
  let data;
  try {
    data = await api("/api/token/" + encodeURIComponent(addr));
  } catch (e) {
    box.innerHTML = `<p>${esc(e.message)}</p>`;
    return;
  }
  const tk = data.token;
  const m = tk.metrics || {};
  const pil = PILLARS.map(([k, label, max]) => {
    const p = tk.pillars[k] || { pts: 0, max };
    return `<div class="pillar"><span>${label}</span>${strip(p.pts / max, 6)}<span class="pts">${Math.round(p.pts)}/${max}</span></div>`;
  }).join("");
  const flags = tk.flags
    .map((f) => `<span class="flag ${/entrando/.test(f) ? "good" : ""}">${esc(f)}</span>`)
    .join("");
  box.innerHTML = `
    <div class="head">
      <div>
        <h2>${esc(tk.symbol)} <span class="g-${tk.grade}">${tk.score}</span></h2>
        <div class="sub" style="margin:2px 0 0">${esc(tk.name)} · ${esc(tk.platform || "—")} · classe ${tk.grade} · ${tk.phase}</div>
      </div>
      <button class="close" aria-label="Fechar detalhe">×</button>
    </div>
    <div style="margin-top:14px">${strip(tk.score / 100, 10)}</div>
    <div style="margin-top:10px">${pil}</div>
    ${flags ? `<div class="flags">${flags}</div>` : ""}
    <div class="facts">
      <div><span>Market cap</span>${fmtMoney(m.mc)}</div>
      <div><span>Liquidez</span>${fmtMoney(m.liq)}</div>
      <div><span>Holders</span>${m.holders ?? "—"}</div>
      <div><span>Idade</span>${fmtAge(m.ageMin)}</div>
      <div><span>Smart / KOL</span>${m.smart ?? 0} / ${m.kol ?? 0}</div>
      <div><span>Fluxo 24h</span>${fmtMoney(m.netBuy)}</div>
      <div><span>Rug</span>${fmtPct(m.rug)}</div>
      <div><span>Bundler</span>${fmtPct(m.bundler)}</div>
      <div><span>Insiders</span>${fmtPct(m.insider)}</div>
      <div><span>Top 10</span>${fmtPct(m.top10)}</div>
      <div><span>Bots</span>${fmtPct(m.bot)}</div>
      <div><span>Carteiras novas</span>${fmtPct(m.fresh)}</div>
      <div><span>Dev segura</span>${fmtPct(m.creatorBal)}</div>
      <div><span>Curva</span>${fmtPct(m.progress)}</div>
    </div>
    ${spark(data.history)}
    ${tk.outcome ? `<p class="sub">Desde que virou candidata: pico de <b>${fmtMult(tk.outcome.peakMc / tk.outcome.entryMc)}</b> sobre ${fmtMoney(tk.outcome.entryMc)}.</p>` : ""}
    <div class="addr"><span id="addrText">${esc(tk.address)}</span></div>
    <div class="links">
      <button id="copyAddr">Copiar endereço</button>
      <a href="https://gmgn.ai/sol/token/${esc(tk.address)}" target="_blank" rel="noopener">GMGN</a>
      <a href="https://dexscreener.com/solana/${esc(tk.address)}" target="_blank" rel="noopener">Dexscreener</a>
    </div>`;
  $(".close", box).addEventListener("click", closeDetail);
  $("#copyAddr", box).addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(tk.address);
      e.target.textContent = "Copiado";
    } catch {
      e.target.textContent = "Selecione e copie acima";
    }
    setTimeout(() => (e.target.textContent = "Copiar endereço"), 1600);
  });
}

function closeDetail() {
  current = null;
  $("#detail").hidden = true;
  $(".split").classList.remove("open");
  $$(".row").forEach((r) => r.setAttribute("aria-pressed", "false"));
}

/* ---------- alertas ---------- */
async function loadAlerts() {
  const box = $("#alertList");
  try {
    const { tokens: list } = await api("/api/alerts");
    if (!list.length) {
      box.innerHTML = `<div class="empty"><b>Nenhum alerta ainda</b>Quando uma moeda passar nos filtros e atingir a nota e a tração de alerta, ela aparece aqui e no Telegram.</div>`;
      return;
    }
    box.innerHTML = list
      .map((t) => {
        const o = t.outcome;
        const cell = (v) => {
          const x = o && v ? v / o.entryMc : null;
          return `<div class="mult ${x === null ? "" : x >= 1 ? "up" : "down"} hide-s">${fmtMult(x)}</div>`;
        };
        return `<div class="alert-row">
          <div class="score g-${t.grade}">${t.score}<small>classe ${t.grade}</small></div>
          <div class="name"><b>${esc(t.symbol)}</b><span>${new Date(t.alertTs * 1000).toLocaleString("pt-BR")}</span></div>
          <div class="num hide-s">${fmtMoney(o?.entryMc ?? t.entryMc)}<small>MC no aviso</small></div>
          ${cell(o?.mc1h)}${cell(o?.mc6h)}
          <div class="mult ${o && o.peakMc / o.entryMc >= 1 ? "up" : "down"}">${fmtMult(o ? o.peakMc / o.entryMc : null)}<small>pico</small></div>
        </div>`;
      })
      .join("");
    box.insertAdjacentHTML(
      "afterbegin",
      `<div class="alert-row" style="background:none;color:var(--muted);font-size:13px"><div></div><div>Moeda</div><div class="num hide-s">MC</div><div class="mult hide-s" style="font:400 13px var(--body)">após 1h</div><div class="mult hide-s" style="font:400 13px var(--body)">após 6h</div><div class="mult" style="font:400 13px var(--body)">pico</div></div>`,
    );
  } catch (e) {
    box.innerHTML = `<div class="empty"><b>Não foi possível carregar</b>${esc(e.message)}</div>`;
  }
}

/* ---------- calibração ---------- */
async function loadCalib() {
  const box = $("#calib");
  try {
    const c = await api("/api/calibration");
    if (!c.total) {
      box.innerHTML = `<div class="empty"><b>Ainda sem dados</b>O acompanhamento começa quando a primeira moeda vira candidata. Os resultados de 1h, 6h e 24h vão se completando com o tempo. Volte em um ou dois dias.</div>`;
      return;
    }
    const pc = (v) => (v === null || v === undefined ? "—" : Math.round(v * 100) + "%");
    const bandRows = c.bands
      .map(
        (b) =>
          `<tr><td>${b.label}</td><td>${b.n}</td><td>${fmtMult(b.medianPeak)}</td><td>${pc(b.pct2x)}</td><td>${pc(b.pct5x)}</td><td>${pc(b.pctDown)}</td></tr>`,
      )
      .join("");
    const pillRows = c.pillars
      .map(
        (p) =>
          `<tr><td>${p.label}</td><td>${p.high.n}</td><td>${fmtMult(p.high.medianPeak)}</td><td>${p.low.n}</td><td>${fmtMult(p.low.medianPeak)}</td></tr>`,
      )
      .join("");
    box.innerHTML = `
      <div class="stat-row">
        <div class="stat"><b>${c.total}</b><span>moedas acompanhadas</span></div>
        <div class="stat"><b>${c.closed}</b><span>com 24h completas</span></div>
        <div class="stat"><b>${fmtMult(c.all.medianPeak)}</b><span>pico mediano sobre a entrada</span></div>
        <div class="stat"><b>${pc(c.all.pct2x)}</b><span>chegaram a 2x ou mais</span></div>
      </div>
      <h3>Resultado por faixa de nota</h3>
      <table><thead><tr><th>Nota</th><th>Moedas</th><th>Pico mediano</th><th>Chegou a 2x</th><th>Chegou a 5x</th><th>Não subiu</th></tr></thead><tbody>${bandRows}</tbody></table>
      <h3>Quais pilares acertaram</h3>
      <p class="lede" style="margin-top:0">Compara o pico mediano das moedas que tinham o pilar forte (70% ou mais do máximo) com as que tinham o pilar fraco. Um pilar que não separa os dois grupos merece peso menor.</p>
      <table><thead><tr><th>Pilar</th><th>Forte: moedas</th><th>Forte: pico</th><th>Fraco: moedas</th><th>Fraco: pico</th></tr></thead><tbody>${pillRows}</tbody></table>
      <p class="sub">“Pico” é o maior market cap visto nas checagens a cada poucos minutos, dividido pelo market cap no momento em que a moeda virou candidata. Com poucas moedas por faixa, os números ainda oscilam muito.</p>`;
  } catch (e) {
    box.innerHTML = `<div class="empty"><b>Não foi possível carregar</b>${esc(e.message)}</div>`;
  }
}

/* ---------- ajustes ---------- */
let defaults = {};
function fieldHtml(key, label, type, value) {
  if (type === "bool")
    return `<label class="check"><input type="checkbox" name="${key}" ${value ? "checked" : ""}> ${label}</label>`;
  const v = type === "pct" ? Math.round(value * 100) : value;
  return `<label>${label}<input name="${key}" data-type="${type}" type="number" step="any" value="${v}" inputmode="decimal"></label>`;
}

async function loadSettings() {
  try {
    const { config, defaults: d } = await api("/api/settings");
    defaults = d;
    renderSettings(config);
    const s = await api("/api/status");
    const rej = s.last?.rejects || {};
    const entries = Object.entries(rej).sort((a, b) => b[1] - a[1]);
    $("#rejects").innerHTML = entries.length
      ? entries.map(([k, v]) => `<span>${esc(k)}<b>${v}</b></span>`).join("")
      : `<span>Nenhum corte registrado na última rodada</span>`;
    $("#runs").innerHTML = s.recent
      .map(
        (r) =>
          `<div class="${r.ok ? "" : "bad"}"><span>${new Date(r.ts * 1000).toLocaleString("pt-BR")}</span><span>${r.fetched} lidas</span><span>${r.passed} passaram</span><span>${r.ok ? "" : esc(r.error || "falhou")}</span></div>`,
      )
      .join("");
  } catch (e) {
    $("#settingsMsg").textContent = e.message;
    $("#settingsMsg").className = "msg err";
  }
}

function renderSettings(cfg) {
  $("#settingsForm").innerHTML = FIELDS.map(
    (g) => `<div class="group"><h3>${g.group}</h3><p>${g.hint}</p><div class="fields">${g.items
      .map(([k, l, t]) => fieldHtml(k, l, t, cfg[k]))
      .join("")}</div></div>`,
  ).join("");
}

function readSettings() {
  const out = {};
  for (const g of FIELDS)
    for (const [k, , t] of g.items) {
      const el = $(`[name="${k}"]`, $("#settingsForm"));
      if (!el) continue;
      if (t === "bool") out[k] = el.checked;
      else out[k] = t === "pct" ? Number(el.value) / 100 : Number(el.value);
    }
  return out;
}

function say(msg, cls) {
  const el = $("#settingsMsg");
  el.textContent = msg;
  el.className = "msg " + (cls || "");
}

$("#saveSettings").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await api("/api/settings", { method: "POST", body: JSON.stringify(readSettings()) });
    say("Ajustes salvos. Valem na próxima rodada.", "ok");
  } catch (err) {
    say(err.message, "err");
  }
});
$("#resetSettings").addEventListener("click", () => {
  renderSettings(defaults);
  say("Padrões carregados. Clique em Salvar ajustes para aplicar.");
});
$("#testTelegram").addEventListener("click", async () => {
  try {
    await api("/api/test-telegram", { method: "POST" });
    say("Mensagem de teste enviada ao Telegram.", "ok");
  } catch (err) {
    say(err.message, "err");
  }
});

/* ---------- início ---------- */
const start = location.hash.replace("#", "");
if (["alerts", "calib", "settings"].includes(start)) showTab(start);
loadStatus();
loadTokens();
setInterval(() => {
  if (document.hidden) return;
  loadStatus();
  if (!$("#tab-ranking").hidden) loadTokens();
}, 30000);
