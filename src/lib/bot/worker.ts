import { createServer } from "node:http";
import { getBot } from "./engine";

const PORT = Number(process.env.PORT || 8080);
const bot = getBot();
if (!bot.authHeader) {
  console.error("Clique24: falta data/session-token.json");
  process.exit(1);
}
bot.startAuto();
console.log(`Clique24 AUTO ligado · ciclos ${bot.cycles} · token ok`);

function payload() {
  const s = bot.status();
  return { ...s, logs: bot.logs.slice(0, 48), now: Date.now() };
}

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Clique24</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Pixelify+Sans:wght@600;700&display=swap"/>
<style>
:root{--bg:#06120e;--ink:#e8f6ef;--mut:#7d9b8e;--line:#1a3329;--card:#0b1a15;--acc:#3dffb0;--dim:#143028}
*{box-sizing:border-box;margin:0}
html,body{background:var(--bg);color:var(--ink);font:13px/1.45 "IBM Plex Mono",ui-monospace,monospace}
body{min-height:100dvh;background-image:radial-gradient(1200px 500px at 10% -10%,#0f2a20 0%,transparent 55%)}
main{max-width:1080px;margin:0 auto;padding:22px 16px 40px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:18px;flex-wrap:wrap}
h1{font:700 28px/1 "Pixelify Sans",sans-serif;letter-spacing:.02em}
.sub{color:var(--mut);font-size:11px;margin-top:4px}
.pill{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:11px}
.dot{width:8px;height:8px;border-radius:99px;background:#555}
.dot.on{background:var(--acc);box-shadow:0 0 10px var(--acc)}
.grid{display:grid;gap:10px}
.g4{grid-template-columns:repeat(4,1fr)}
.g2{grid-template-columns:1fr 1fr}
.g3{grid-template-columns:1.2fr .9fr .9fr}
@media(max-width:860px){.g4,.g3,.g2{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.v{font:600 26px/1.1 "Pixelify Sans",sans-serif;margin-top:8px}
.s{color:var(--mut);font-size:11px;margin-top:6px}
.bar{height:5px;background:var(--dim);border-radius:99px;margin-top:10px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--acc);width:0;transition:width .4s}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);font-weight:500;padding:0 0 8px}
td{padding:7px 0;border-top:1px solid var(--line);vertical-align:middle}
td.n,th.n{text-align:right}
.sym{color:var(--ink)}
.pos{color:var(--acc)}
.neg{color:#ff8d6b}
.track{height:4px;background:var(--dim);border-radius:99px;min-width:72px}
.track>i{display:block;height:100%;background:var(--acc);border-radius:99px}
h2{font:600 12px "Pixelify Sans",sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:16px 0 8px}
pre{white-space:pre-wrap;color:#b7d8c9;font-size:11px;line-height:1.55;max-height:280px;overflow:auto}
.err{color:#ff8d6b}
</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>Clique24</h1>
    <div class="sub">coleta real · GraphQL · VPS</div>
  </div>
  <div class="pill"><span class="dot" id="dot"></span><span id="head">…</span></div>
</header>
<section class="grid g4">
  <article class="card"><div class="k">Energia</div><div class="v" id="energy">—</div><div class="bar"><i id="ebar"></i></div></article>
  <article class="card"><div class="k">Ciclos</div><div class="v" id="cycles">—</div><div class="s" id="sess">—</div></article>
  <article class="card"><div class="k">XP da sessão</div><div class="v pos" id="xps">—</div><div class="s" id="xpa">—</div></article>
  <article class="card"><div class="k">Último ciclo</div><div class="v" id="ago">—</div><div class="s" id="last">—</div></article>
</section>
<div class="grid g3" style="margin-top:10px">
  <article class="card">
    <div class="k">Sessão coletada</div>
    <table style="margin-top:10px"><thead><tr><th>Recurso</th><th class="n">Total</th><th class="n">/h</th></tr></thead><tbody id="col"></tbody></table>
  </article>
  <article class="card">
    <div class="k">Estoque agora</div>
    <table style="margin-top:10px"><thead><tr><th>Recurso</th><th class="n">Qtd</th></tr></thead><tbody id="stock"></tbody></table>
  </article>
  <article class="card">
    <div class="k">Neste ciclo</div>
    <div class="s" id="spent" style="margin:8px 0 10px">—</div>
    <table><thead><tr><th>In</th><th class="n">Δ</th></tr></thead><tbody id="delta"></tbody></table>
    <div class="k" style="margin-top:14px">Áreas</div>
    <table style="margin-top:8px"><thead><tr><th>Node</th><th class="n">Fab</th><th class="n">Idle</th></tr></thead><tbody id="areas"></tbody></table>
  </article>
</div>
<h2>Histórico</h2>
<article class="card">
  <table><thead><tr><th>Quando</th><th>Coleta</th><th class="n">XP</th><th class="n">Nodes</th></tr></thead><tbody id="hist"></tbody></table>
</article>
<h2>Log</h2>
<article class="card"><pre id="log"></pre></article>
</main>
<script>
const $ = id => document.getElementById(id);
const fmt = n => n==null||!Number.isFinite(+n) ? "—" : Math.round(+n).toLocaleString("pt-BR");
const signed = n => (n>0?"+":"") + fmt(n);
function ago(ts){
  if(!ts) return "—";
  const s=Math.max(0,Math.floor((Date.now()-ts)/1000));
  if(s<60) return s+"s";
  const m=Math.floor(s/60); if(m<60) return m+" min";
  return Math.floor(m/60)+"h "+(m%60)+"m";
}
function hours(ts){ if(!ts) return 1/60; return Math.max(1/60,(Date.now()-ts)/3.6e6); }
function noCoin(list){ return (list||[]).filter(r=>r.symbol!=="COIN"); }
async function tick(){
  const d = await fetch("/api/status").then(r=>r.json());
  const ok = d.auto && d.hasToken && !d.error;
  $("dot").className = "dot"+(ok?" on":"");
  $("head").textContent = (d.auto?"AUTO 15s":"pausado")+(d.hasToken?"":" · sem sessão")+(d.error?" · "+d.error:"");
  $("energy").textContent = fmt(d.energy)+"/"+fmt(d.energyMax);
  $("ebar").style.width = (d.energyMax>0?Math.max(0,Math.min(100,(d.energy/d.energyMax)*100)):0)+"%";
  $("cycles").textContent = fmt(d.cycles);
  const h = hours(d.sessionStartedAt);
  $("sess").textContent = (d.sessionStartedAt?ago(d.sessionStartedAt)+" de sessão":"aguardando")+" · "+fmt(d.factories)+" fábricas · "+fmt(d.mines)+" minas";
  $("xps").textContent = signed(d.xpCollected);
  $("xpa").textContent = "conta "+fmt(d.xp)+" · "+fmt(d.xpCollected/h)+"/h";
  $("ago").textContent = ago(d.lastCycleAt);
  $("last").textContent = noCoin(d.lastCollected).map(r=>r.symbol+" "+signed(r.amount)).join(" · ")||"—";
  $("spent").textContent = (d.lastSpent&&d.lastSpent.length) ? "gastou "+d.lastSpent.map(r=>r.symbol+" "+signed(-Math.abs(r.amount))).join(" · ") : "sem gasto neste ciclo";
  $("col").innerHTML = noCoin(d.collected).map(r=>"<tr><td class=sym>"+r.symbol+"</td><td class='n pos'>"+fmt(r.amount)+"</td><td class=n>"+fmt(r.amount/h)+"/h</td></tr>").join("")||"<tr><td colspan=3>aguardando CLAIM</td></tr>";
  const maxS = Math.max(1, ...noCoin(d.resources).map(r=>r.amount||0));
  $("stock").innerHTML = noCoin(d.resources).map(r=>"<tr><td>"+r.symbol+"<div class=track><i style=width:"+Math.max(4,(r.amount/maxS)*100)+"%"+"></i></div></td><td class=n>"+fmt(r.amount)+"</td></tr>").join("")||"<tr><td colspan=2>—</td></tr>";
  $("delta").innerHTML = noCoin(d.lastCollected).map(r=>"<tr><td>"+r.symbol+"</td><td class='n pos'>"+signed(r.amount)+"</td></tr>").join("")||"<tr><td colspan=2>—</td></tr>";
  $("areas").innerHTML = (d.areas||[]).map(a=>"<tr><td>"+a.symbol+"</td><td class=n>"+a.factories+"</td><td class=n>"+a.idle+"</td></tr>").join("")||"<tr><td colspan=3>—</td></tr>";
  $("hist").innerHTML = (d.history||[]).slice(0,16).map(h=>"<tr><td>"+ago(h.t)+"</td><td>"+((h.collected||[]).map(r=>r.symbol+" "+signed(r.amount)).join(" · ")||"—")+"</td><td class='n pos'>"+signed(h.xp)+"</td><td class=n>"+(h.nodes||0)+"</td></tr>").join("")||"<tr><td colspan=4>sem histórico</td></tr>";
  $("log").textContent = (d.logs||[]).map(x=>x.text).join("\\n");
}
tick();
setInterval(tick, 2000);
</script>
</body>
</html>`;

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/api/status" || path === "/status") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(payload()));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Painel em http://0.0.0.0:${PORT}`);
});

setInterval(() => {
  const s = bot.status();
  const err = s.error ? ` · ${s.error}` : "";
  console.log(`${new Date().toISOString()} · ciclo ${s.cycles} · energia ${s.energy}/${s.energyMax} · auto ${s.auto}${err}`);
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    bot.stopAuto();
    bot.persistLedger();
    process.exit(0);
  });
}
