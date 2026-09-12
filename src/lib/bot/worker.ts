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
  return {
    ...s,
    logs: bot.logs.slice(0, 40),
    now: Date.now(),
  };
}

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Clique24</title>
<style>
  :root { --bg:#07140f; --card:#0d1f18; --line:#1c3a2e; --txt:#d7ece3; --mut:#7fa392; --acc:#3dffb0; --warn:#ffb020; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
  main{max-width:920px;margin:0 auto;padding:20px}
  h1{font:700 22px/1.1 ui-monospace,Menlo,monospace;margin:0 0 4px}
  .sub{color:var(--mut);font-size:12px;margin-bottom:18px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  @media(max-width:720px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
  .k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .v{font:600 26px/1.1 ui-monospace,Menlo,monospace;margin-top:6px}
  .s{color:var(--mut);font:12px ui-monospace,Menlo,monospace;margin-top:6px}
  .bar{height:6px;background:#123127;border-radius:99px;margin-top:10px;overflow:hidden}
  .bar>i{display:block;height:100%;background:var(--acc)}
  table{width:100%;border-collapse:collapse;font:13px ui-monospace,Menlo,monospace}
  td{padding:6px 0;border-bottom:1px solid var(--line)}
  td:last-child{text-align:right;color:var(--acc)}
  .dot{width:8px;height:8px;border-radius:99px;display:inline-block;margin-right:6px;background:#666}
  .on{background:var(--acc)}
  .off{background:var(--warn)}
  pre{white-space:pre-wrap;font:12px/1.45 ui-monospace,Menlo,monospace;color:#b7d4c8;margin:0;max-height:320px;overflow:auto}
  h2{font-size:13px;margin:18px 0 8px;color:var(--mut);font-weight:600}
</style>
</head>
<body>
<main>
  <h1>Clique24</h1>
  <div class="sub"><span class="dot" id="dot"></span><span id="head">carregando…</span></div>
  <div class="grid">
    <div class="card"><div class="k">Energia</div><div class="v" id="energy">—</div><div class="bar"><i id="ebar" style="width:0"></i></div></div>
    <div class="card"><div class="k">Sessão</div><div class="v" id="cycles">—</div><div class="s" id="xp">XP —</div></div>
    <div class="card"><div class="k">Último ciclo</div><div class="v" id="ago">—</div><div class="s" id="last">—</div></div>
  </div>
  <h2>Coletado nesta sessão</h2>
  <div class="card"><table id="col"></table></div>
  <h2>Estoque agora</h2>
  <div class="card"><table id="stock"></table></div>
  <h2>Log</h2>
  <div class="card"><pre id="log"></pre></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => n==null || n===undefined ? "—" : Math.round(n).toLocaleString("pt-BR");
const signed = (n) => (n>0?"+":"") + fmt(n);
function ago(ts){
  if(!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now()-ts)/1000));
  if(s<60) return s+"s";
  const m=Math.floor(s/60); if(m<60) return m+"min";
  return Math.floor(m/60)+"h "+(m%60)+"min";
}
function rows(el, list, key){
  el.innerHTML = (list||[]).filter(r=>r.symbol!=="COIN").map(r =>
    "<tr><td>"+r.symbol+"</td><td>"+(key==="delta"?signed(r.amount):fmt(r.amount))+"</td></tr>"
  ).join("") || "<tr><td colspan=2>vazio</td></tr>";
}
async function tick(){
  const d = await fetch("/api/status").then(r=>r.json());
  $("dot").className = "dot " + (d.auto && d.hasToken ? "on":"off");
  $("head").textContent = (d.auto?"AUTO 15s":"pausado") + (d.error? " · "+d.error : " · sem erro");
  $("energy").textContent = fmt(d.energy)+"/"+fmt(d.energyMax);
  $("ebar").style.width = (d.energyMax>0? Math.max(0,Math.min(100,(d.energy/d.energyMax)*100)) : 0) + "%";
  $("cycles").textContent = fmt(d.cycles)+" ciclos";
  $("xp").textContent = "XP "+signed(d.xpCollected)+" · conta "+fmt(d.xp);
  $("ago").textContent = ago(d.lastCycleAt);
  $("last").textContent = (d.lastCollected||[]).map(r=>r.symbol+" "+signed(r.amount)).join(" · ") || "—";
  rows($("col"), d.collected, "amt");
  rows($("stock"), d.resources, "amt");
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
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(payload()));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Painel em http://0.0.0.0:${PORT}  (só dados)`);
});

setInterval(() => {
  const s = bot.status();
  const err = s.error ? ` · ${s.error}` : "";
  console.log(
    `${new Date().toISOString()} · ciclo ${s.cycles} · energia ${s.energy}/${s.energyMax} · auto ${s.auto}${err}`,
  );
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    bot.stopAuto();
    bot.persistLedger();
    process.exit(0);
  });
}
