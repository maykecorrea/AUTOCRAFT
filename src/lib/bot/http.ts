import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getBot, runAutoTick, findPurpleLoginButtons, screenKind } from "./engine";

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

function stabilize(bot: ReturnType<typeof getBot>) {
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
    return json({ error: e instanceof Error ? e.message : String(e), open: false }, 200);
  }

  try {
    if (method === "GET" && path.endsWith("/status")) {
      const st = bot.status();
      return json({ ...st, logs: bot.logs.slice(0, 25) });
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

    if (method === "POST" && path.endsWith("/open")) {
      await bot.open();
      const st = bot.status();
      if (!st.open) {
        return json({ ...st, logs: bot.logs.slice(0, 25), error: bot.error || "ERRO: Chrome não abriu." }, 200);
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
      await bot.wheel(Number(body.dy) || 200);
      return json(bot.status());
    }

    return json({ error: "rota desconhecida", open: bot.status().open }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      bot.error = msg;
      bot.log(`Falha: ${msg}`);
    } catch {
      /* ignore */
    }
    return json({ error: msg, open: false }, 200);
  }
}

export async function handleBotRequest(req: IncomingMessage, res: ServerResponse) {
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
