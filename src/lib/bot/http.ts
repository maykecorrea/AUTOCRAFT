import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getBot, runAutoTick, findPurpleLoginButtons, screenKind, ensureBotAuth } from "./engine";
import { fetchSnapshot, CYCLE_MS, isAuthError } from "./api";

const LAST_STATUS_PATH = join(process.cwd(), "data", "last-status.json");

function knownEnergyMax(bot: ReturnType<typeof getBot>): number | null {
  if (bot.snap && bot.snap.energyMax > 0) {
    bot.lastEnergyMax = bot.snap.energyMax;
    return bot.snap.energyMax;
  }
  if (bot.lastGoodSnap && bot.lastGoodSnap.energyMax > 0) {
    bot.lastEnergyMax = bot.lastGoodSnap.energyMax;
    return bot.lastGoodSnap.energyMax;
  }
  if (bot.lastEnergyMax > 0) return bot.lastEnergyMax;
  return bot.authHeader ? 1250 : null;
}

function keepBotSnap(bot: ReturnType<typeof getBot>, snap: { energy: number; energyMax: number; xp: number; resources: { symbol: string; amount: number }[]; factories: unknown[]; mines: unknown[]; areas: unknown[]; accountId: string; powerUsed: number }) {
  if (typeof bot.lastEnergyMax !== "number") bot.lastEnergyMax = 0;
  if (snap.energyMax > 0) bot.lastEnergyMax = snap.energyMax;
  else if (bot.lastEnergyMax > 0) snap = { ...snap, energyMax: bot.lastEnergyMax };
  bot.snap = snap as typeof bot.snap;
  if (snap.energyMax > 0) bot.lastGoodSnap = bot.snap;
}

function hydrateLastSnap(bot: ReturnType<typeof getBot>) {
  try {
    if (!existsSync(LAST_STATUS_PATH)) return;
    const s = JSON.parse(readFileSync(LAST_STATUS_PATH, "utf8")) as {
      energy?: number | null;
      energyMax?: number | null;
      xp?: number | null;
      resources?: { symbol: string; amount: number }[];
    };
    if (typeof s.energyMax === "number" && s.energyMax > 0) bot.lastEnergyMax = s.energyMax;
    if (bot.snap || bot.lastGoodSnap) return;
    if (typeof s.energy !== "number" && typeof s.xp !== "number") return;
    const energyMax = bot.lastEnergyMax || 1250;
    bot.lastGoodSnap = {
      accountId: "",
      energy: typeof s.energy === "number" ? s.energy : 0,
      energyMax,
      powerUsed: 0,
      xp: typeof s.xp === "number" ? s.xp : 0,
      resources: s.resources ?? [],
      factories: [],
      mines: [],
      areas: [],
    };
    bot.snap = bot.lastGoodSnap;
  } catch {
    /* ignore */
  }
}
const CREDS_PATH = join(process.cwd(), "data", "creds.json");
const DEFAULT_CREDS = {
  email: "mayketibia@gmail.com",
  phone: "+5517996150245",
};

function loadCreds(): { email: string; phone: string } {
  try {
    if (!existsSync(CREDS_PATH)) {
      mkdirSync(dirname(CREDS_PATH), { recursive: true });
      writeFileSync(CREDS_PATH, JSON.stringify(DEFAULT_CREDS, null, 2));
      return { ...DEFAULT_CREDS };
    }
    const raw = JSON.parse(readFileSync(CREDS_PATH, "utf8")) as { email?: string; phone?: string };
    return {
      email: String(raw.email || DEFAULT_CREDS.email),
      phone: String(raw.phone || DEFAULT_CREDS.phone),
    };
  } catch {
    return { ...DEFAULT_CREDS };
  }
}

async function applyAccount(kind: "email" | "phone" = "phone") {
  const bot = getBot();
  const { email, phone } = loadCreds();
  if (!bot.active()) {
    bot.log("Navegador fechado. Abrindo para o login…");
    await bot.open();
  }
  const p = bot.active();
  if (!p) {
    bot.error = "ERRO: não consegui abrir o navegador.";
    bot.log(bot.error);
    return;
  }
  bot.error = null;
  const text = kind === "phone" ? phone : email;
  bot.log(`Login ${kind}: o código vai ler os pixels da foto (não é IA).`);

  for (let i = 1; i <= 20; i++) {
    let png: Buffer;
    try {
      png = await p.screenshot({ type: "png", timeout: 5000 });
    } catch (e) {
      bot.log(`Tentativa ${i}/20: foto falhou (${e instanceof Error ? e.message : e}).`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    const now = screenKind(png);
    const btns = findPurpleLoginButtons(png);
    bot.log(`Tentativa ${i}/20: tela=${now}, botões roxos=${btns.length}`);
    if (now === "loading" || btns.length < 1) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const target = kind === "phone" ? btns[btns.length - 1] : btns[0];
    bot.log(`OK: clique ${kind} em ${target.x}×${target.y}`);
    try {
      await p.mouse.click(target.x, target.y);
      await new Promise((r) => setTimeout(r, 500));
      await p.keyboard.type(text, { delay: 15 });
      bot.error = null;
      bot.log(`OK: ${kind} enviado (${text}).`);
      return;
    } catch (e) {
      bot.error = `ERRO ao clicar ${kind}: ${e instanceof Error ? e.message : e}`;
      bot.log(bot.error);
      return;
    }
  }
  bot.error = "ERRO: EMAIL/PHONE não apareceu em ~40s. O jogo ainda não chegou na tela de login.";
  bot.log(bot.error);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function diskStatus(): Record<string, unknown> | null {
  try {
    if (!existsSync(LAST_STATUS_PATH)) return null;
    const s = JSON.parse(readFileSync(LAST_STATUS_PATH, "utf8")) as Record<string, unknown>;
    if (s && typeof s === "object") {
      if (s.energyMax == null || s.energyMax === 0) s.energyMax = 1250;
      if (s.energy == null) s.energy = 0;
      s.hasToken = s.hasToken !== false;
      return s;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function stabilize(bot: ReturnType<typeof getBot>) {
  if (!bot.collectedSession) bot.collectedSession = {};
  if (!bot.lastCollected) bot.lastCollected = [];
  if (!bot.lastSpent) bot.lastSpent = [];
  if (!bot.history) bot.history = [];
  if (!bot.lastGoodSnap && bot.snap) bot.lastGoodSnap = bot.snap;
  if (typeof bot.cycles !== "number") bot.cycles = 0;
  if (typeof bot.xpCollected !== "number") bot.xpCollected = 0;
  if (typeof bot.sessionStartedAt !== "number") bot.sessionStartedAt = 0;
  if (typeof bot.lastCycleAt !== "number") bot.lastCycleAt = 0;
  bot.startWatchdog = () => {
    if (bot.watchTimer) return;
    bot.watchTimer = setInterval(() => {
      if (!bot.auto) return;
      const age = Date.now() - (bot.lastCycleAt || 0);
      if (bot.busy && age > 90_000) {
        bot.log("Watchdog: ciclo preso. Liberando trava.");
        bot.busy = false;
      }
      if (!bot.busy && age > 40_000) {
        bot.log("Watchdog: AUTO ficou mudo. Religo o ciclo.");
        if (bot.autoTimer) clearTimeout(bot.autoTimer);
        bot.autoTimer = setTimeout(() => bot.loop(), 50);
      }
    }, 20_000);
  };
  bot.applyReport = (report) => {
    if (!bot.sessionStartedAt) bot.sessionStartedAt = Date.now();
    for (const r of report.collected) {
      bot.collectedSession[r.symbol] = (bot.collectedSession[r.symbol] || 0) + r.amount;
    }
    bot.xpCollected += report.xpGained;
    bot.lastCollected = report.collected;
    bot.lastSpent = report.spent;
    bot.cycles += 1;
    bot.lastCycleAt = Date.now();
    bot.history.unshift({
      t: Date.now(),
      collected: report.collected,
      xp: report.xpGained,
      nodes: report.claimedNodes,
    });
    bot.history = bot.history.slice(0, 24);
    bot.persistLedger?.();
  };
  if (!bot.clickQueue) bot.clickQueue = [];
  bot.clickNorm = async (nx: number, ny: number) => {
    const p = bot.active();
    if (!p) {
      bot.error = "ERRO: clique ignorado — navegador fechado.";
      bot.log(bot.error);
      return;
    }
    const vp = p.viewportSize() ?? { width: 430, height: 860 };
    const x = Math.max(0, Math.min(vp.width - 1, Math.round(nx * vp.width)));
    const y = Math.max(0, Math.min(vp.height - 1, Math.round(ny * vp.height)));
    try {
      await p.mouse.click(x, y);
      bot.clicks += 1;
      bot.lastClick = `${x},${y}`;
      bot.error = null;
      bot.log(`OK: clique ${x}×${y}`);
    } catch (e) {
      bot.error = `ERRO no clique ${x}×${y}: ${e instanceof Error ? e.message : e}`;
      bot.log(bot.error);
    }
  };
  bot.drag = async (phase: string, nx: number, ny: number) => {
    const p = bot.active();
    if (!p) throw new Error("Navegador fechado");
    const vp = p.viewportSize() ?? { width: 430, height: 860 };
    const x = Math.max(0, Math.min(vp.width - 1, Math.round(nx * vp.width)));
    const y = Math.max(0, Math.min(vp.height - 1, Math.round(ny * vp.height)));
    bot.dragging = bot.dragging ?? false;
    if (phase === "start") {
      bot.dragging = true;
      bot.skipShot = true;
      await p.mouse.move(x, y);
      await p.mouse.down();
      return;
    }
    if (phase === "move" && bot.dragging) {
      await p.mouse.move(x, y);
      return;
    }
    if (phase === "end") {
      if (bot.dragging) {
        await p.mouse.move(x, y);
        await p.mouse.up();
      }
      bot.dragging = false;
      bot.skipShot = false;
      return;
    }
    if (bot.dragging) {
      try {
        await p.mouse.up();
      } catch {
        /* ignore */
      }
    }
    bot.dragging = false;
    bot.skipShot = false;
  };
  const orig = bot.open.bind(bot);
  bot.open = async () => {
    if (bot.page && !bot.page.isClosed()) return bot.status();
    if (bot.opening) return bot.opening;
    bot.opening = orig().finally(() => {
      bot.opening = null;
    });
    return bot.opening;
  };
  bot.tick = () => runAutoTick(bot);
  const origStatus = bot.status.bind(bot);
  bot.status = () => {
    const s = origStatus();
    const snap = bot.snap ?? bot.lastGoodSnap;
    if (snap) {
      s.energy = snap.energy;
      s.energyMax = knownEnergyMax(bot);
      s.xp = snap.xp;
      s.resources = snap.resources?.length ? snap.resources : s.resources;
      s.factories = snap.factories.length || s.factories;
      s.mines = snap.mines.length || s.mines;
      if (snap.areas?.length) {
        s.areas = snap.areas.map((a) => ({
          id: a.id,
          symbol: a.symbol,
          factories: a.factories.length,
          idle: a.idleFactories,
        }));
      }
    } else {
      s.energyMax = knownEnergyMax(bot);
      if (s.energyMax && s.energy == null) s.energy = 0;
    }
    s.hasToken = !!bot.authHeader;
    s.collected = Object.entries(bot.collectedSession || {})
      .map(([symbol, amount]) => ({ symbol, amount }))
      .sort((a, b) => b.amount - a.amount);
    s.lastCollected = bot.lastCollected || [];
    s.lastSpent = bot.lastSpent || [];
    s.cycles = bot.cycles || 0;
    s.xpCollected = bot.xpCollected || 0;
    s.sessionStartedAt = bot.sessionStartedAt || 0;
    s.lastCycleAt = bot.lastCycleAt || 0;
    s.history = bot.history || [];
    return s;
  };
  const b = bot as typeof bot & { __autoPatch16?: boolean };
  const wait = typeof CYCLE_MS === "number" ? CYCLE_MS : 15_000;
  bot.loop = async () => {
    if (!bot.auto) return;
    if (bot.busy) return;
    try {
      await runAutoTick(bot);
    } catch (e) {
      bot.error = e instanceof Error ? e.message : String(e);
      bot.log(`ERRO API: ${bot.error}`);
    }
    if (!bot.auto) return;
    if (bot.autoTimer) clearTimeout(bot.autoTimer);
    bot.autoTimer = setTimeout(() => bot.loop(), wait);
  };
  bot.startWatchdog?.();
  bot.loadToken?.();
  hydrateLastSnap(bot);
  const age = Date.now() - (bot.lastCycleAt || 0);
  if (bot.auto && !bot.busy && age > wait * 2.5) {
    if (bot.autoTimer) clearTimeout(bot.autoTimer);
    bot.autoTimer = setTimeout(() => bot.loop(), 80);
  }
  if (!b.__autoPatch16) {
    b.__autoPatch16 = true;
    bot.log("AUTO: 1 fábrica/ciclo, cadeia EARTH→MUD→SAND, JWT sozinho.");
    if (bot.auto && !bot.busy && !bot.autoTimer) {
      bot.autoTimer = setTimeout(() => bot.loop(), 200);
    }
    void (async () => {
      try {
        const auth = await ensureBotAuth(bot);
        const snap = await fetchSnapshot(auth);
        keepBotSnap(bot, snap);
        if (isAuthError(bot.error || "")) bot.error = null;
        bot.persistLedger?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        bot.log(`Snapshot: ${msg}`);
      }
    })();
  }
}

export async function handleBotFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  let bot;
  try {
    bot = getBot();
    stabilize(bot);
  } catch (e) {
    return json(
      diskStatus() ?? {
        error: e instanceof Error ? e.message : String(e),
        open: false,
        hasToken: false,
        auto: false,
      },
      200,
    );
  }

  try {
    if (method === "GET" && path.endsWith("/status")) {
      hydrateLastSnap(bot);
      if (!bot.snap && !bot.lastGoodSnap && bot.authHeader && !bot.busy) {
        try {
          const auth = await ensureBotAuth(bot);
          const snap = await fetchSnapshot(auth);
          keepBotSnap(bot, snap);
          if (bot.error && isAuthError(bot.error)) bot.error = null;
        } catch {
          /* keep lastGoodSnap */
        }
      }
      const st = bot.status();
      if (st.hasToken && (st.energyMax == null || st.energyMax === 0)) {
        st.energyMax = knownEnergyMax(bot) ?? 1250;
      }
      if (st.hasToken && st.energy == null) st.energy = 0;
      return json({ ...st, logs: bot.logs.slice(0, 40), autoPatch: 17 });
    }

    if (method === "GET" && path.endsWith("/frame")) {
      if (!bot.active()) return json({ error: "closed", open: false }, 200);
      const jpg = await bot.screenshot();
      return new Response(new Uint8Array(jpg), {
        status: 200,
        headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
      });
    }

    if (method === "GET" && path.endsWith("/account")) {
      return json(loadCreds());
    }

    let body: Record<string, unknown> = {};
    if (method === "POST") {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    if (path.endsWith("/open") && (method === "POST" || method === "GET")) {
      await bot.open();
      const st = bot.status();
      if (!st.open) {
        return json(
          { ...st, logs: bot.logs.slice(0, 25), error: bot.error || "ERRO: Chrome não abriu." },
          200,
        );
      }
      return json({ ...st, logs: bot.logs.slice(0, 25) });
    }
    if (method === "POST" && path.endsWith("/close")) {
      await bot.close();
      delete (globalThis as { __clique24?: unknown }).__clique24;
      return json({ open: false, auto: false, clicks: 0 });
    }
    if (method === "POST" && path.endsWith("/auto")) {
      if (body.on) bot.startAuto();
      else bot.stopAuto();
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/cycle")) {
      if (!bot.authHeader) {
        return json({ ...bot.status(), error: "Sem token JWT." }, 200);
      }
      await runAutoTick(bot);
      return json({ ...bot.status(), logs: bot.logs.slice(0, 40) });
    }
    if (method === "POST" && path.endsWith("/click")) {
      await bot.clickNorm(Number(body.nx), Number(body.ny));
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/restart")) {
      await bot.restart();
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/login")) {
      await applyAccount("email");
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/account")) {
      await applyAccount(body.kind === "email" ? "email" : "phone");
      return json(getBot().status());
    }
    if (method === "POST" && path.endsWith("/phone")) {
      await applyAccount("phone");
      return json(getBot().status());
    }
    if (method === "POST" && path.endsWith("/reload")) {
      const page = bot.page;
      if (!page || page.isClosed()) return json({ error: "closed", open: false }, 200);
      bot.log("Recuperando o jogo sem fechar o login…");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      bot.log("Jogo recarregado. A sessão continua neste navegador.");
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/game")) {
      await bot.showGame();
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/type")) {
      await bot.typeText(String(body.text ?? ""));
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/key")) {
      await bot.key(String(body.key ?? "Enter"));
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/wheel")) {
      await bot.wheel(Number(body.dy) || 200, Number(body.nx) || 0.5, Number(body.ny) || 0.42);
      return json(bot.status());
    }
    if (method === "POST" && path.endsWith("/drag")) {
      await bot.drag(String(body.phase ?? "move"), Number(body.nx) || 0.5, Number(body.ny) || 0.5);
      return json(bot.status());
    }
    if (method === "POST" && (path.endsWith("/clearlogs") || path.endsWith("/logs/clear"))) {
      bot.logs = [];
      bot.error = null;
      return json({ ...bot.status(), logs: [] });
    }

    return json({ error: `rota desconhecida: ${method} ${path}`, open: bot.status().open }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      bot.error = msg;
      bot.log(`Falha: ${msg}`);
      return json({ ...bot.status(), error: msg, logs: bot.logs.slice(0, 20) }, 200);
    } catch {
      return json({ error: msg, open: false, stale: true, ...(diskStatus() ?? {}) }, 200);
    }
  }
}

export async function handleBotRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    writeFileSync("/tmp/bot-http-loaded.txt", `api-mode-v10 ${Date.now()}\n`);
  } catch {
    /* ignore */
  }
  const chunks: Buffer[] = [];
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    for await (const c of req) chunks.push(c as Buffer);
  }
  const host = String(req.headers.host ?? "127.0.0.1");
  const request = new Request(`http://${host}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const response = await handleBotFetch(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}
