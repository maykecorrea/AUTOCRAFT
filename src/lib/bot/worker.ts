import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBot } from "./engine";

const PORT = Number(process.env.PORT || 8080);
const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "panel.html"), "utf8");
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
