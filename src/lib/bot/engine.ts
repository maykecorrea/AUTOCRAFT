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

  async wheel(dy: number) {
    const p = this.active();
    if (!p) throw new Error("Navegador fechado");
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
    const p = bot.page;
    if (!p || bot.popup) return;
    const png = await p.screenshot({ type: "png", timeout: 5000 });
    const kind = screenKind(png);
    if (kind !== "game") {
      bot.log(`AUTO espera: tela agora é ${kind}, não o mapa.`);
      return;
    }
    const targets = findPlayButtons(png);
    bot.lastTargets = targets;
    if (targets.length === 0) {
      await p.mouse.wheel(0, 260);
      bot.log("Nenhum play visível. Rolando o mapa.");
      return;
    }
    for (const t of targets.slice(0, 6)) {
      if (!bot.auto) break;
      await p.mouse.click(t.x, t.y);
      bot.clicks += 1;
      bot.lastClick = `${t.x},${t.y}`;
      bot.log(`OK: auto-play ${t.x}×${t.y}`);
      await sleep(400);
    }
  } finally {
    bot.busy = false;
  }
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
  if (isLoadingSpinner(pngBuf)) return "loading";
  if (findPurpleLoginButtons(pngBuf).length >= 1) return "login";
  return "game";
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

function isPlayPixel(r: number, g: number, b: number) {
  const lime = g > 170 && g > r + 40 && g > b + 20 && r < 210 && b < 180;
  const gold = r > 210 && g > 155 && b < 110 && r + g > 380 && g > b + 50;
  return lime || gold;
}

function findPlayButtons(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  const xMin = Math.floor(width * 0.16);
  const yMin = Math.floor(height * 0.12);
  const yMax = Math.floor(height * 0.92);
  const clusters: { x: number; y: number; n: number }[] = [];
  for (let y = yMin; y < yMax; y += 2) {
    for (let x = xMin; x < width - 8; x += 2) {
      const i = (width * y + x) * 4;
      if (!isPlayPixel(data[i], data[i + 1], data[i + 2])) continue;
      let hit = clusters.find((c) => Math.abs(c.x - x) < 26 && Math.abs(c.y - y) < 26);
      if (!hit) {
        hit = { x, y, n: 0 };
        clusters.push(hit);
      }
      hit.x = (hit.x * hit.n + x) / (hit.n + 1);
      hit.y = (hit.y * hit.n + y) / (hit.n + 1);
      hit.n += 1;
    }
  }
  return clusters
    .filter((c) => c.n >= 8 && c.n < 350)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) }));
}
