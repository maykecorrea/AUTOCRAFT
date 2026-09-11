import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

export type BotStatus = {
  open: boolean;
  auto: boolean;
  url: string;
  title: string;
  clicks: number;
  lastClick: string | null;
  popup: boolean;
  google: boolean;
  googleStep: "email" | "password" | "recovery" | "other" | null;
  loggedHint: boolean;
  error: string | null;
  uptimeSec: number;
  factories: number;
  mines: number;
  viewW: number;
  viewH: number;
  hasToken: boolean;
};

export type BotLog = { t: number; text: string };

const GAME_URL = "https://craft-world.gg/";
const VIEW = { width: 430, height: 860 };
const PROFILE_DIR = join(process.cwd(), "data", "chrome-profile");
const SESSION_PATH = join(process.cwd(), "data", "craft-session.json");
const STATE_PATH = join(process.cwd(), "data", "bot-state.json");
const TOKEN_PATH = join(process.cwd(), "data", "session-token.json");
const ENGINE_VERSION = 14;

type PW = typeof import("playwright");
type Browser = import("playwright").Browser;
type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;

type G = typeof globalThis & { __clique24?: Clique24 };

function store(): Clique24 {
  const g = globalThis as G;
  if (!g.__clique24) g.__clique24 = new Clique24();
  return g.__clique24;
}

export function getBot() {
  return store();
}

class Clique24 {
  version = ENGINE_VERSION;
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  page: Page | null = null;
  popup: Page | null = null;
  auto = false;
  clicks = 0;
  lastClick: string | null = null;
  error: string | null = null;
  logs: BotLog[] = [];
  startedAt = 0;
  autoTimer: ReturnType<typeof setTimeout> | null = null;
  lastFrame: Buffer | null = null;
  factories = new Set<string>();
  mines = new Set<string>();
  authHeader: string | null = null;
  graphqlUrl = "https://craft-world.gg/graphql";
  lastTargets: { x: number; y: number }[] = [];
  busy = false;
  shooting: Promise<Buffer> | null = null;
  keepTimer: ReturnType<typeof setInterval> | null = null;
  opening: Promise<BotStatus> | null = null;
  clickQueue: { x: number; y: number }[] = [];
  flushing = false;
  skipShot = false;
  recentPlays: { x: number; y: number; t: number }[] = [];
  lastRecover = 0;
  lastPan = 0;

  constructor() {
    this.loadToken();
    this.loadState();
  }

  log(text: string) {
    this.logs.unshift({ t: Date.now(), text });
    this.logs = this.logs.slice(0, 80);
  }

  active(): Page | null {
    if (this.popup && !this.popup.isClosed()) return this.popup;
    if (this.page && !this.page.isClosed()) return this.page;
    return null;
  }

  status(): BotStatus {
    const p = this.active();
    const url = p && !p.isClosed() ? p.url() : "";
    const vp = p?.viewportSize() ?? VIEW;
    return {
      open: !!p,
      auto: this.auto,
      url,
      title: "",
      clicks: this.clicks,
      lastClick: this.lastClick,
      popup: !!(this.popup && !this.popup.isClosed()),
      google: /accounts\.google/i.test(url),
      googleStep: googleStepFromUrl(url),
      loggedHint: !!this.authHeader || this.mines.size + this.factories.size > 0,
      error: this.error,
      uptimeSec: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      factories: this.factories.size,
      mines: this.mines.size,
      viewW: vp.width,
      viewH: vp.height,
      hasToken: !!this.authHeader,
    };
  }

  async open() {
    if (this.page && !this.page.isClosed()) {
      try {
        await this.page.evaluate(() => 1);
        return this.status();
      } catch {
        this.log("Sessão antiga morreu. Abrindo o Chrome de novo.");
        try {
          await this.close();
        } catch {
          /* ignore */
        }
      }
    }
    if (this.opening) return this.opening;
    this.opening = this.openInner().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  async openInner() {
    this.error = null;
    this.log("Abrindo Craft World…");
    try {
      const { chromium } = (await import("playwright")) as PW;
      mkdirSync(PROFILE_DIR, { recursive: true });

      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        viewport: VIEW,
        timeout: 25000,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        locale: "pt-BR",
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
          "--ignore-gpu-blocklist",
          "--enable-webgl",
        ],
      });
      this.browser = this.context.browser();

      await this.context.addInitScript(() => {
        Object.defineProperty(Document.prototype, "hidden", { get: () => false });
        Object.defineProperty(Document.prototype, "visibilityState", { get: () => "visible" });
        Document.prototype.hasFocus = () => true;
        window.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
      });

      this.context.on("page", (p) => {
        const adopt = () => {
          if (p === this.page || p.isClosed()) return;
          this.popup = p;
          this.log("Nova janela extra aberta.");
        };
        p.on("framenavigated", adopt);
        p.on("close", () => {
          if (this.popup === p) this.popup = null;
        });
        setTimeout(adopt, 300);
      });

      const existing = this.context.pages()[0];
      this.page = existing ?? (await this.context.newPage());
      this.page.setDefaultTimeout(45000);
      this.hookNetwork(this.page);
      this.startedAt = Date.now();
      this.startKeepAlive();

      if (!/craft-world\.gg/i.test(this.page.url())) {
        await this.page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      }
      this.log("OK: Chrome aberto em craft-world.gg");
      return this.status();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = `ERRO ao abrir o Chrome: ${msg}`;
      this.log(this.error);
      this.page = null;
      this.context = null;
      this.browser = null;
      throw e;
    }
  }

  hookNetwork(page: Page) {
    page.on("request", (req) => {
      const url = req.url();
      if (!/craft-world\.gg/i.test(url)) return;
      const headers = req.headers();
      const auth = headers.authorization || headers.Authorization;
      if (auth && auth.length > 20 && auth !== this.authHeader) {
        this.authHeader = auth;
        this.saveToken(auth);
        this.log("OK: token de sessão salvo.");
      }
      if (/graphql/i.test(url)) this.graphqlUrl = url.split("?")[0];
    });
  }

  saveToken(authorization: string) {
    try {
      mkdirSync(dirname(TOKEN_PATH), { recursive: true });
      writeFileSync(TOKEN_PATH, JSON.stringify({ authorization, savedAt: Date.now() }, null, 2));
    } catch {
      /* ignore */
    }
  }

  loadToken() {
    try {
      if (!existsSync(TOKEN_PATH)) return;
      const s = JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as { authorization?: string };
      if (s.authorization && s.authorization.length > 20) this.authHeader = s.authorization;
    } catch {
      /* ignore */
    }
  }

  startKeepAlive() {
    if (this.keepTimer) return;
    this.keepTimer = setInterval(() => {
      void this.keepAlive();
    }, 20000);
  }

  async keepAlive() {
    const p = this.page;
    if (!p || p.isClosed()) return;
    try {
      await p.evaluate(() => {
        Object.defineProperty(document, "hidden", { get: () => false });
        Object.defineProperty(document, "visibilityState", { get: () => "visible" });
      });
    } catch {
      /* busy */
    }
  }

  async persistSession() {
    try {
      if (!this.context) return;
      mkdirSync(dirname(SESSION_PATH), { recursive: true });
      await this.context.storageState({ path: SESSION_PATH });
      writeFileSync(
        STATE_PATH,
        JSON.stringify({ auto: this.auto, clicks: this.clicks, hasToken: !!this.authHeader }, null, 2),
      );
    } catch {
      /* ignore */
    }
  }

  loadState() {
    try {
      if (!existsSync(STATE_PATH)) return;
      const s = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { clicks?: number };
      if (s.clicks) this.clicks = s.clicks;
    } catch {
      /* ignore */
    }
  }

  async screenshot(): Promise<Buffer> {
    if (this.shooting) return this.shooting;
    const p = this.active();
    if (!p) {
      if (this.lastFrame) return this.lastFrame;
      throw new Error("Navegador fechado");
    }
    this.shooting = (async () => {
      try {
        const buf = await p.screenshot({ type: "jpeg", quality: 50, timeout: 4000 });
        this.lastFrame = buf;
        return buf;
      } catch {
        if (this.lastFrame) return this.lastFrame;
        throw new Error("screenshot");
      } finally {
        this.shooting = null;
      }
    })();
    return this.shooting;
  }

  async clickNorm(nx: number, ny: number) {
    const p = this.active();
    if (!p) {
      this.error = "ERRO: navegador fechado.";
      this.log(this.error);
      return;
    }
    const vp = p.viewportSize() ?? VIEW;
    const x = Math.max(0, Math.min(vp.width - 1, Math.round(nx * vp.width)));
    const y = Math.max(0, Math.min(vp.height - 1, Math.round(ny * vp.height)));
    await p.mouse.click(x, y);
    this.clicks += 1;
    this.lastClick = `${x},${y}`;
    this.error = null;
    this.log(`OK: clique ${x}×${y}`);
  }

  async typeText(text: string) {
    const p = this.active();
    if (!p) throw new Error("Navegador fechado");
    await p.keyboard.type(text, { delay: 0 });
  }

  async key(name: string) {
    const p = this.active();
    if (!p) throw new Error("Navegador fechado");
    const mapped = mapKey(name);
    if (!mapped) return;
    await p.keyboard.press(mapped);
  }

  async showGame() {
    if (this.popup && !this.popup.isClosed()) {
      try {
        await this.popup.close();
      } catch {
        /* ignore */
      }
      this.popup = null;
    }
    this.log("Foco no Craft World.");
    return this.status();
  }

  async wheel(dy: number, nx = 0.5, ny = 0.42) {
    const p = this.active();
    if (!p) throw new Error("Navegador fechado");
    const vp = p.viewportSize() ?? VIEW;
    const x = Math.max(8, Math.min(vp.width - 8, Math.round(nx * vp.width)));
    const y = Math.max(8, Math.min(vp.height - 8, Math.round(ny * vp.height)));
    await p.mouse.move(x, y);
    await p.mouse.wheel(0, dy);
  }

  startAuto() {
    if (this.auto) return;
    this.auto = true;
    this.log("AUTO 24h ligado.");
    this.loop();
  }

  stopAuto() {
    this.auto = false;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.log("AUTO pausado.");
  }

  async loop() {
    if (!this.auto) return;
    try {
      if (!this.page || this.page.isClosed()) await this.open();
      await runAutoTick(this);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.log(`ERRO no AUTO: ${this.error}`);
    }
    this.autoTimer = setTimeout(() => this.loop(), this.auto ? 4500 : 800);
  }

  async tick() {
    await runAutoTick(this);
  }

  async restart() {
    this.log("Reiniciando o navegador.");
    await this.close();
    this.clicks = 0;
    this.lastClick = null;
    this.error = null;
    this.logs = [];
    this.startedAt = 0;
    await this.open();
    return this.status();
  }

  async close() {
    if (this.keepTimer) {
      clearInterval(this.keepTimer);
      this.keepTimer = null;
    }
    this.stopAuto();
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.popup = null;
    this.startedAt = 0;
  }
}

export async function runAutoTick(bot: Clique24) {
  if (bot.busy) return;
  bot.busy = true;
  try {
    if (bot.popup && !bot.popup.isClosed()) {
      const pop = bot.popup;
      let png: Buffer;
      try {
        png = await pop.screenshot({ type: "png", timeout: 4000 });
      } catch {
        try {
          await pop.close();
        } catch {
          /* ignore */
        }
        bot.popup = null;
        bot.log("OK: fechei janela de anúncio.");
        return;
      }
      const xbtn = findDismissButton(png);
      if (xbtn) {
        await pressPlay(pop, xbtn.x, xbtn.y);
        bot.log(`OK: X do anúncio ${xbtn.x}×${xbtn.y}`);
        await sleep(400);
        return;
      }
      try {
        await pop.close();
      } catch {
        /* ignore */
      }
      bot.popup = null;
      bot.log("OK: fechei janela de propaganda.");
      return;
    }

    const p = bot.page;
    if (!p) return;
    const png = await p.screenshot({ type: "png", timeout: 5000 });
    const xbtn = findDismissButton(png);
    if (xbtn) {
      await pressPlay(p, xbtn.x, xbtn.y);
      bot.clicks += 1;
      bot.lastClick = `${xbtn.x},${xbtn.y}`;
      bot.log(`OK: fechei popup no X ${xbtn.x}×${xbtn.y}`);
      await sleep(500);
      return;
    }
    if (isBlackFramePng(png)) {
      if (Date.now() - (bot.lastRecover || 0) > 45000) {
        bot.lastRecover = Date.now();
        bot.log("Tela preta. Recarregando o jogo, sessão fica.");
        await p.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      }
      return;
    }
    const kind = screenKind(png);
    if (kind !== "game") {
      bot.log(`AUTO espera: tela agora é ${kind}, não o mapa.`);
      return;
    }
    if (!bot.recentPlays) bot.recentPlays = [];
    bot.recentPlays = bot.recentPlays.filter((c) => Date.now() - c.t < 20000);
    const targets = findPlayButtons(png).filter(
      (t) => !bot.recentPlays.some((c) => Math.abs(c.x - t.x) < 22 && Math.abs(c.y - t.y) < 22),
    );
    bot.lastTargets = targets;
    if (targets.length === 0) {
      await panMapUp(p);
      bot.log("Nenhum play verde novo. Arrastei o mapa (sentido inverso).");
      return;
    }
    for (const t of targets.slice(0, 6)) {
      if (!bot.auto) break;
      await pressPlay(p, t.x, t.y);
      bot.clicks += 1;
      bot.lastClick = `${t.x},${t.y}`;
      bot.recentPlays.push({ x: t.x, y: t.y, t: Date.now() });
      bot.log(`OK: play verde ${t.x}×${t.y}`);
      await sleep(550);
    }
  } finally {
    bot.busy = false;
  }
}

async function pressPlay(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await sleep(40);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

async function panMapUp(page: Page) {
  const vp = page.viewportSize() ?? VIEW;
  const x = Math.round(vp.width * 0.5);
  const y0 = Math.round(vp.height * 0.32);
  const y1 = Math.round(vp.height * 0.62);
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y1, { steps: 14 });
  await sleep(80);
  await page.mouse.up();
}

function isBlackFramePng(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 32) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n += 1;
  }
  return n > 0 && sum / n < 18;
}

function isCloseRed(r: number, g: number, b: number) {
  return r > 185 && g < 105 && b < 140 && r > g + 80 && r > b + 50;
}

function findDismissButton(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  const y0 = Math.floor(height * 0.02);
  const y1 = Math.floor(height * 0.26);
  const zones: [number, number][] = [
    [Math.floor(width * 0.62), width - 4],
    [4, Math.floor(width * 0.38)],
  ];
  const clusters: { x: number; y: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const [xA, xB] of zones) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = xA; x < xB; x += 1) {
        const i = (width * y + x) * 4;
        if (!isCloseRed(data[i], data[i + 1], data[i + 2])) continue;
        let hit = clusters.find((c) => Math.abs(c.x - x) < 16 && Math.abs(c.y - y) < 16);
        if (!hit) {
          hit = { x, y, n: 0, x0: x, x1: x, y0: y, y1: y };
          clusters.push(hit);
        }
        hit.x = (hit.x * hit.n + x) / (hit.n + 1);
        hit.y = (hit.y * hit.n + y) / (hit.n + 1);
        hit.n += 1;
        hit.x0 = Math.min(hit.x0, x);
        hit.x1 = Math.max(hit.x1, x);
        hit.y0 = Math.min(hit.y0, y);
        hit.y1 = Math.max(hit.y1, y);
      }
    }
  }
  const red = clusters
    .filter((c) => {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      return c.n >= 18 && c.n <= 160 && w >= 8 && w <= 52 && h >= 8 && h <= 52;
    })
    .sort((a, b) => b.x - a.x || a.y - b.y);
  if (red[0]) return { x: Math.round(red[0].x), y: Math.round(red[0].y) };

  // Ads: small white X on a dark circle, top corners
  const white: { x: number; y: number; n: number }[] = [];
  for (const [xA, xB] of zones) {
    for (let y = y0; y < Math.floor(height * 0.18); y += 1) {
      for (let x = xA; x < xB; x += 1) {
        const i = (width * y + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum < 215) continue;
        let hit = white.find((c) => Math.abs(c.x - x) < 12 && Math.abs(c.y - y) < 12);
        if (!hit) {
          hit = { x, y, n: 0 };
          white.push(hit);
        }
        hit.x = (hit.x * hit.n + x) / (hit.n + 1);
        hit.y = (hit.y * hit.n + y) / (hit.n + 1);
        hit.n += 1;
      }
    }
  }
  const wx = white.filter((c) => c.n >= 10 && c.n <= 70).sort((a, b) => b.x - a.x)[0];
  if (wx) return { x: Math.round(wx.x), y: Math.round(wx.y) };
  return null;
}

export function findPurpleLoginButtons(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  const y0 = Math.floor(height * 0.48);
  const y1 = Math.floor(height * 0.82);
  const rowHits: number[] = new Array(height).fill(0);
  for (let y = y0; y < y1; y += 1) {
    let n = 0;
    for (let x = 24; x < width - 24; x += 2) {
      const i = (width * y + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 55 && r < 160 && g < 95 && b > 75 && b < 200 && b > g + 20 && r > g) n += 1;
    }
    rowHits[y] = n;
  }
  const bands: { y0: number; y1: number; n: number }[] = [];
  let cur: { y0: number; y1: number; n: number } | null = null;
  for (let y = y0; y < y1; y += 1) {
    if (rowHits[y] > 30) {
      if (!cur) cur = { y0: y, y1: y, n: rowHits[y] };
      else {
        cur.y1 = y;
        cur.n += rowHits[y];
      }
    } else if (cur) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  return bands
    .filter((b) => b.y1 - b.y0 >= 28 && b.y1 - b.y0 <= 90)
    .sort((a, b) => a.y0 - b.y0)
    .map((b) => ({
      x: Math.round(width * 0.5),
      y: Math.round((b.y0 + b.y1) / 2),
    }));
}

export function screenKind(pngBuf: Buffer): "loading" | "login" | "game" {
  const grass = grassRatio(pngBuf);
  if (grass > 0.18) return "game";
  if (isLoadingSpinner(pngBuf) && grass < 0.08) return "loading";
  if (findPurpleLoginButtons(pngBuf).length >= 2 && grass < 0.12) return "login";
  return "game";
}

function grassRatio(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  let grass = 0;
  let n = 0;
  for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.85); y += 4) {
    for (let x = 16; x < width - 16; x += 4) {
      const i = (width * y + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      n += 1;
      if (g > r && g > b && g > 40 && g < 180) grass += 1;
    }
  }
  return n ? grass / n : 0;
}

function isPlayPixel(r: number, g: number, b: number) {
  // Bright lime triangle. Yellow boost has high red — reject those.
  return g > 190 && r < 130 && b < 160 && g > r + 70 && g > b + 40;
}

function findPlayButtons(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  // Skip HUD + the character play at the top of the chain. Never click that.
  const xMin = Math.floor(width * 0.18);
  const yMin = Math.floor(height * 0.3);
  const yMax = Math.floor(height * 0.78);
  const clusters: {
    x: number;
    y: number;
    n: number;
    sr: number;
    sg: number;
    bx: number;
    by: number;
    bg: number;
  }[] = [];
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < width - 8; x += 1) {
      const i = (width * y + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isPlayPixel(r, g, b)) continue;
      let hit = clusters.find((c) => Math.abs(c.x - x) < 16 && Math.abs(c.y - y) < 16);
      if (!hit) {
        hit = { x, y, n: 0, sr: 0, sg: 0, bx: x, by: y, bg: g };
        clusters.push(hit);
      }
      hit.x = (hit.x * hit.n + x) / (hit.n + 1);
      hit.y = (hit.y * hit.n + y) / (hit.n + 1);
      hit.sr += r;
      hit.sg += g;
      hit.n += 1;
      if (g > hit.bg) {
        hit.bx = x;
        hit.by = y;
        hit.bg = g;
      }
    }
  }
  const found = clusters
    .filter((c) => {
      if (c.n < 16 || c.n > 260) return false;
      const mr = c.sr / c.n;
      const mg = c.sg / c.n;
      return mg > mr + 70 && mr < 120;
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((c) => ({ x: c.bx, y: c.by }))
    .filter((t) => t.y >= Math.floor(height * 0.3))
    .filter((t) => !hasArrowUnderPlay(data, width, height, t.x, t.y));
  if (found.length < 2) return found;
  const byY = [...found].sort((a, b) => a.y - b.y);
  if (byY[1].y - byY[0].y > 80) {
    return found.filter((t) => t.x !== byY[0].x || t.y !== byY[0].y);
  }
  return found;
}

function hasArrowUnderPlay(
  data: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  // Top-chain widget: green play with a tiny yellow arrow just below. Never click.
  let yellow = 0;
  const x0 = Math.max(0, x - 16);
  const x1 = Math.min(width - 1, x + 16);
  const y0 = Math.min(height - 1, y + 10);
  const y1 = Math.min(height - 1, y + 42);
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const i = (width * yy + xx) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 180 && g > 130 && b < 120 && r >= g - 10) yellow += 1;
    }
  }
  return yellow > 18;
}

function googleStepFromUrl(url: string): BotStatus["googleStep"] {
  if (!/accounts\.google/i.test(url)) return null;
  if (/usernamerecovery|accountrecovery|findyouremail/i.test(url)) return "recovery";
  if (/challenge\/pwd|\/pwd|Passwd|password/i.test(url)) return "password";
  if (/identifier|signin\/v2|ServiceLogin|oauth/i.test(url)) return "email";
  return "other";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapKey(name: string): string | null {
  if (!name) return null;
  if (name === " ") return "Space";
  if (name === "Dead" || name === "Process" || name === "Unidentified") return null;
  if (name === "Meta" || name === "Control" || name === "Alt" || name === "Shift") return null;
  const aliases: Record<string, string> = {
    Backspace: "Backspace",
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    ArrowDown: "ArrowDown",
    ArrowUp: "ArrowUp",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Delete: "Delete",
    Home: "Home",
    End: "End",
  };
  return aliases[name] || (name.length === 1 ? name : name);
}

function isLoadingSpinner(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  let bright = 0;
  const x0 = Math.floor(width * 0.34);
  const x1 = Math.floor(width * 0.66);
  const y0 = Math.floor(height * 0.36);
  const y1 = Math.floor(height * 0.54);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (width * y + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 200) bright += 1;
    }
  }
  return bright > 400;
}
