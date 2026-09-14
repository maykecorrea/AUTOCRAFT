import { createServer, type IncomingMessage } from "node:http";
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
if (!bot.auto) bot.startAuto();
console.log(`Clique24 worker · ciclos ${bot.cycles} · auto ${bot.auto}`);

function payload() {
  const s = bot.status();
  return { ...s, logs: bot.logs.slice(0, 48), now: Date.now() };
}

function json(res: { writeHead: Function; end: Function }, data: unknown) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      on?: boolean;
      symbols?: string[];
      target?: string | null;
    };
  } catch {
    return {};
  }
}

createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const method = (req.method ?? "GET").toUpperCase();
  if (path === "/api/status" || path === "/status") {
    json(res, payload());
    return;
  }
  if (path === "/api/auto" && (method === "POST" || method === "PUT")) {
    const body = await readBody(req);
    const on = typeof body.on === "boolean" ? body.on : !bot.auto;
    if (on) bot.startAuto();
    else bot.stopAuto();
    json(res, payload());
    return;
  }
  if (path === "/api/targets" && (method === "POST" || method === "PUT")) {
    const body = await readBody(req);
    const symbols = Array.isArray(body.symbols) ? body.symbols.map((s) => String(s)) : [];
    bot.setFactoryTargets(symbols);
    json(res, payload());
    return;
  }
  if (path === "/api/focus" && (method === "POST" || method === "PUT")) {
    const body = await readBody(req);
    bot.setFactoryFocus(body.target ?? null);
    json(res, payload());
    return;
  }
  if (path === "/api/power" && (method === "POST" || method === "PUT")) {
    const body = await readBody(req);
    const on = typeof body.on === "boolean" ? body.on : !bot.fullPower;
    bot.setFullPower(on);
    json(res, payload());
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