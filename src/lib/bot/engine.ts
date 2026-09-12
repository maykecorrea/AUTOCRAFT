import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import {
  parseAccount,
  runApiCycle,
  CYCLE_MS,
  refreshIdToken,
  isJwtExpiring,
  isAuthError,
  FIREBASE_API_KEY,
  type AreaSnap,
  type CycleReport,
  type GameSnap,
} from "./api";

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
  energy: number | null;
  energyMax: number | null;
  xp: number | null;
  resources: { symbol: string; amount: number }[];
  areas: { id: string; symbol: string; factories: number; idle: number }[];
  viewW: number;
  viewH: number;
  hasToken: boolean;
  collected: { symbol: string; amount: number }[];
  lastCollected: { symbol: string; amount: number }[];
  lastSpent: { symbol: string; amount: number }[];
  cycles: number;
  xpCollected: number;
  sessionStartedAt: number;
  lastCycleAt: number;
  history: { t: number; collected: { symbol: string; amount: number }[]; xp: number; nodes: number }[];
};

export type BotLog = { t: number; text: string };

const GAME_URL = "https://craft-world.gg/";
const VIEW = { width: 430, height: 860 };
const PROFILE_DIR = join(process.cwd(), "data", "chrome-profile");
const SESSION_PATH = join(process.cwd(), "data", "craft-session.json");
const STATE_PATH = join(process.cwd(), "data", "bot-state.json");
const TOKEN_PATH = join(process.cwd(), "data", "session-token.json");
const LAST_STATUS_PATH = join(process.cwd(), "data", "last-status.json");
const ENGINE_VERSION = 17;

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
  watchTimer: ReturnType<typeof setInterval> | null = null;
  lastFrame: Buffer | null = null;
  factories = new Set<string>();
  mines = new Set<string>();
  authHeader: string | null = null;
  graphqlUrl = "https://craft-world.gg/graphql";
  refreshToken: string | null = null;
  apiKey = FIREBASE_API_KEY;
  tokenExpiresAt = 0;
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
  dragging = false;
  blackStreak = 0;
  snap: GameSnap | null = null;
  lastGoodSnap: GameSnap | null = null;
  lastEnergyMax = 0;
  collectedSession: Record<string, number> = {};
  lastCollected: { symbol: string; amount: number }[] = [];
  lastSpent: { symbol: string; amount: number }[] = [];
  cycles = 0;
  xpCollected = 0;
  sessionStartedAt = 0;
  lastCycleAt = 0;
  history: { t: number; collected: { symbol: string; amount: number }[]; xp: number; nodes: number }[] = [];

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
      factories: this.snap?.factories.length ?? this.lastGoodSnap?.factories.length ?? this.factories.size,
      mines: this.snap?.mines.length ?? this.lastGoodSnap?.mines.length ?? this.mines.size,
      energy: this.snap ? this.snap.energy : this.lastGoodSnap ? this.lastGoodSnap.energy : null,
      energyMax: this.knownEnergyMax(),
      xp: this.snap ? this.snap.xp : this.lastGoodSnap ? this.lastGoodSnap.xp : null,
      resources: this.snap?.resources ?? this.lastGoodSnap?.resources ?? [],
      areas: (this.snap?.areas ?? this.lastGoodSnap?.areas ?? []).map((a: AreaSnap) => ({
        id: a.id,
        symbol: a.symbol,
        factories: a.factories.length,
        idle: a.idleFactories,
      })),
      viewW: vp.width,
      viewH: vp.height,
      hasToken: !!this.authHeader,
      collected: Object.entries(this.collectedSession)
        .map(([symbol, amount]) => ({ symbol, amount }))
        .sort((a, b) => b.amount - a.amount),
      lastCollected: this.lastCollected,
      lastSpent: this.lastSpent,
      cycles: this.cycles,
      xpCollected: this.xpCollected,
      sessionStartedAt: this.sessionStartedAt,
      lastCycleAt: this.lastCycleAt,
      history: this.history,
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
      const h = req.headers();
      const auth = h.authorization || h.Authorization;
      if (auth && auth.length > 20 && auth !== this.authHeader) {
        this.authHeader = auth;
        this.saveToken(auth);
        this.log("OK: token do frontend salvo.");
      }
      if (/graphql/i.test(url)) this.graphqlUrl = url.split("?")[0];
    });
    page.on("response", (res) => {
      const url = res.url();
      if (!/craft-world\.gg\/graphql/i.test(url)) return;
      void res
        .json()
        .then((json: unknown) => {
          const acc = (json as { data?: { account?: Record<string, unknown> } } | null)?.data
            ?.account;
          if (!acc || typeof acc !== "object") return;
          if (acc.powerState || acc.areas || acc.resources) {
            try {
              this.snap = parseAccount(acc);
            } catch {
              /* partial payload */
            }
          }
        })
        .catch(() => {
          /* not json */
        });
    });
  }

  saveToken(authorization: string) {
    try {
      mkdirSync(dirname(TOKEN_PATH), { recursive: true });
      writeFileSync(
        TOKEN_PATH,
        JSON.stringify(
          {
            authorization,
            savedAt: Date.now(),
            refreshToken: this.refreshToken,
            apiKey: this.apiKey,
            expiresAt: this.tokenExpiresAt,
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  loadToken() {
    try {
      if (!existsSync(TOKEN_PATH)) return;
      const s = JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as {
        authorization?: string;
        refreshToken?: string;
        apiKey?: string;
        expiresAt?: number;
      };
      if (s.authorization && s.authorization.length > 20) this.authHeader = s.authorization;
      if (s.refreshToken) this.refreshToken = s.refreshToken;
      if (s.apiKey) this.apiKey = s.apiKey;
      if (s.expiresAt) this.tokenExpiresAt = s.expiresAt;
    } catch {
      /* ignore */
    }
    if (!this.refreshToken) this.refreshToken = scrapeChromeRefresh();
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
        JSON.stringify(
          {
            auto: this.auto,
            clicks: this.clicks,
            hasToken: !!this.authHeader,
            collectedSession: this.collectedSession,
            xpCollected: this.xpCollected,
            cycles: this.cycles,
            sessionStartedAt: this.sessionStartedAt,
          },
          null,
          2,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  loadState() {
    try {
      if (!existsSync(STATE_PATH)) return;
      const s = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
        clicks?: number;
        auto?: boolean;
        collectedSession?: Record<string, number>;
        xpCollected?: number;
        cycles?: number;
        sessionStartedAt?: number;
      };
      if (s.clicks) this.clicks = s.clicks;
      if (s.collectedSession) this.collectedSession = s.collectedSession;
      if (s.xpCollected) this.xpCollected = s.xpCollected;
      if (s.cycles) this.cycles = s.cycles;
      if (s.sessionStartedAt) this.sessionStartedAt = s.sessionStartedAt;
      if (s.auto && this.authHeader) {
        setTimeout(() => this.startAuto(), 400);
      }
    } catch {
      /* ignore */
    }
    hydrateLastSnap(this);
  }

  knownEnergyMax(): number | null {
    return knownEnergyMax(this);
  }

  keepSnap(snap: GameSnap) {
    keepBotSnap(this, snap);
  }

  persistAuto() {
    this.persistLedger();
  }

  persistLedger() {
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      writeFileSync(
        STATE_PATH,
        JSON.stringify(
          {
            auto: this.auto,
            clicks: this.clicks,
            hasToken: !!this.authHeader,
            collectedSession: this.collectedSession,
            xpCollected: this.xpCollected,
            cycles: this.cycles,
            sessionStartedAt: this.sessionStartedAt,
          },
          null,
          2,
        ),
      );
      if (this.authHeader) {
        const st = this.status();
        if ((st.energyMax ?? 0) > 0) {
          writeFileSync(
            LAST_STATUS_PATH,
            JSON.stringify({
              ...st,
              logs: this.logs.slice(0, 40),
              autoPatch: 15,
            }),
          );
        }
      }
    } catch {
      /* ignore */
    }
  }

  applyReport(report: CycleReport) {
    if (!this.sessionStartedAt) this.sessionStartedAt = Date.now();
    for (const r of report.collected) {
      this.collectedSession[r.symbol] = (this.collectedSession[r.symbol] || 0) + r.amount;
    }
    this.xpCollected += report.xpGained;
    this.lastCollected = report.collected;
    this.lastSpent = report.spent;
    this.cycles += 1;
    this.lastCycleAt = Date.now();
    this.history.unshift({
      t: Date.now(),
      collected: report.collected,
      xp: report.xpGained,
      nodes: report.claimedNodes,
    });
    this.history = this.history.slice(0, 24);
    this.persistLedger();
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

  async drag(phase: string, nx: number, ny: number) {
    const p = this.active();
    if (!p) throw new Error("Navegador fechado");
    const vp = p.viewportSize() ?? VIEW;
    const x = Math.max(0, Math.min(vp.width - 1, Math.round(nx * vp.width)));
    const y = Math.max(0, Math.min(vp.height - 1, Math.round(ny * vp.height)));
    if (phase === "start") {
      this.dragging = true;
      this.skipShot = true;
      await p.mouse.move(x, y);
      await p.mouse.down();
      return;
    }
    if (phase === "move" && this.dragging) {
      await p.mouse.move(x, y);
      return;
    }
    if (phase === "end") {
      if (this.dragging) {
        await p.mouse.move(x, y);
        await p.mouse.up();
      }
      this.dragging = false;
      this.skipShot = false;
      return;
    }
    if (phase === "cancel") {
      if (this.dragging) {
        try {
          await p.mouse.up();
        } catch {
          /* ignore */
        }
      }
      this.dragging = false;
      this.skipShot = false;
    }
  }

  startAuto() {
    if (this.auto) return;
    this.auto = true;
    this.lastCycleAt = Date.now();
    this.persistAuto();
    this.startWatchdog();
    this.log("AUTO 24h ligado — produção via API (fábricas + nodes + energia).");
    void this.loop();
  }

  stopAuto() {
    this.auto = false;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.persistAuto();
    this.log("AUTO pausado.");
  }

  startWatchdog() {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => {
      if (!this.auto) return;
      const age = Date.now() - (this.lastCycleAt || Date.now());
      if (this.busy && age > 90_000) {
        this.log("Watchdog: ciclo preso. Liberando trava.");
        this.busy = false;
      }
      if (!this.busy && age > CYCLE_MS * 3) {
        this.log("Watchdog: AUTO ficou mudo. Religo o ciclo.");
        if (this.autoTimer) clearTimeout(this.autoTimer);
        void this.loop();
      }
    }, 20_000);
  }

  async loop() {
    if (!this.auto) return;
    if (this.busy) return;
    try {
      await runAutoTick(this);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.log(`ERRO no AUTO: ${this.error}`);
    }
    if (!this.auto) return;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    const wait = typeof CYCLE_MS === "number" ? CYCLE_MS : 15_000;
    this.autoTimer = setTimeout(() => this.loop(), wait);
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
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
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

export function keepBotSnap(bot: Clique24, snap: GameSnap) {
  if (typeof bot.lastEnergyMax !== "number") bot.lastEnergyMax = 0;
  if (snap.energyMax > 0) bot.lastEnergyMax = snap.energyMax;
  else if (bot.lastEnergyMax > 0) snap = { ...snap, energyMax: bot.lastEnergyMax };
  bot.snap = snap;
  if (snap.energyMax > 0) bot.lastGoodSnap = snap;
}

export function knownEnergyMax(bot: Clique24): number | null {
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

export function hydrateLastSnap(bot: Clique24) {
  try {
    if (!existsSync(LAST_STATUS_PATH)) return;
    const s = JSON.parse(readFileSync(LAST_STATUS_PATH, "utf8")) as {
      energy?: number | null;
      energyMax?: number | null;
      xp?: number | null;
      resources?: GameSnap["resources"];
    };
    if (typeof s.energyMax === "number" && s.energyMax > 0) bot.lastEnergyMax = s.energyMax;
    if (bot.lastGoodSnap) return;
    if (typeof s.energy !== "number" && typeof s.xp !== "number") return;
    bot.lastGoodSnap = {
      accountId: "",
      energy: typeof s.energy === "number" ? s.energy : 0,
      energyMax: bot.lastEnergyMax || 1250,
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

function scrapeChromeRefresh(): string | null {
  try {
    const dir = join(PROFILE_DIR, "Default/IndexedDB/https_craft-world.gg_0.indexeddb.leveldb");
    if (!existsSync(dir)) return null;
    const re = /AMf-[A-Za-z0-9_-]{80,}/;
    for (const name of readdirSync(dir)) {
      const buf = readFileSync(join(dir, name));
      const m = buf.toString("latin1").match(re);
      if (m?.[0]) return m[0];
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function ensureBotAuth(bot: Clique24, force = false): Promise<string> {
  try {
    if (existsSync(TOKEN_PATH)) {
      const s = JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as {
        authorization?: string;
        refreshToken?: string;
        apiKey?: string;
        expiresAt?: number;
      };
      if (s.authorization && s.authorization.length > 20) bot.authHeader = s.authorization;
      if (s.refreshToken) bot.refreshToken = s.refreshToken;
      if (s.apiKey) bot.apiKey = s.apiKey;
      if (s.expiresAt) bot.tokenExpiresAt = s.expiresAt;
    }
  } catch {
    /* ignore */
  }
  if (!bot.refreshToken) bot.refreshToken = scrapeChromeRefresh();
  if (!force && bot.authHeader && !isJwtExpiring(bot.authHeader, 300)) {
    return bot.authHeader;
  }
  if (!bot.refreshToken) {
    if (bot.authHeader && !force) return bot.authHeader;
    throw new Error("Sessão expirada. Abre o Craft World logado uma vez.");
  }
  const next = await refreshIdToken(bot.refreshToken, bot.apiKey || FIREBASE_API_KEY);
  bot.authHeader = next.authorization;
  bot.refreshToken = next.refreshToken;
  bot.tokenExpiresAt = next.expiresAt;
  try {
    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(
      TOKEN_PATH,
      JSON.stringify(
        {
          authorization: next.authorization,
          savedAt: Date.now(),
          refreshToken: next.refreshToken,
          apiKey: bot.apiKey || FIREBASE_API_KEY,
          expiresAt: next.expiresAt,
        },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }
  bot.log("OK: sessão renovada (JWT 1h).");
  return next.authorization;
}

export async function runAutoTick(bot: Clique24) {
  if (bot.busy || bot.dragging) return;
  bot.busy = true;
  try {
    const auth = await ensureBotAuth(bot);
    if (!auth) {
      bot.error = "Sem token. Abre o Craft World logado uma vez.";
      bot.log(bot.error);
      return;
    }
    bot.lastCycleAt = Date.now();
    try {
      const report = await runApiCycle(auth, (s) => bot.log(s));
      keepBotSnap(bot, report.snap);
      bot.applyReport(report);
      bot.error = null;
      bot.lastCycleAt = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthError(msg)) {
        bot.log("Sessão caiu. Renovando token…");
        const retry = await ensureBotAuth(bot, true);
        const report = await runApiCycle(retry, (s) => bot.log(s));
        keepBotSnap(bot, report.snap);
        bot.applyReport(report);
        bot.error = null;
        bot.lastCycleAt = Date.now();
        return;
      }
      throw e;
    }
  } catch (e) {
    bot.error = e instanceof Error ? e.message : String(e);
    bot.log(`ERRO API: ${bot.error}`);
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

function isProfileZone(x: number, y: number, w: number, h: number) {
  return x < w * 0.34 && y < h * 0.2;
}

function isCloseRed(r: number, g: number, b: number) {
  return r > 205 && g < 75 && b < 80 && r > g + 130 && r > b + 120;
}

function findDismissButton(pngBuf: Buffer) {
  const modal = hasYellowUpgradeButton(pngBuf);
  const grass = grassRatio(pngBuf);
  if (!modal && grass > 0.12) return null;
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  const y0 = Math.floor(height * 0.04);
  const y1 = Math.floor(height * (modal ? 0.26 : 0.16));
  const xA = Math.floor(width * (modal ? 0.62 : 0.78));
  const xB = width - 6;
  const clusters: { x: number; y: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = xA; x < xB; x += 1) {
      const i = (width * y + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const red = r > 205 && g < 75 && b < 80 && r > g + 130 && r > b + 120;
      const mag = modal && r > 190 && g < 100 && b < 150 && r > g + 80;
      if (!red && !mag) continue;
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
  const red = clusters
    .filter((c) => {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      return c.n >= 18 && c.n <= 160 && w >= 10 && w <= 48 && h >= 10 && h <= 48;
    })
    .sort((a, b) => b.n - a.n);
  if (red[0]) {
    const x = Math.round(red[0].x);
    const y = Math.round(red[0].y);
    if (x < width * 0.6 || y > height * 0.28) return null;
    if (isProfileZone(x, y, width, height)) return null;
    return { x, y };
  }
  return null;
}

function hasYellowUpgradeButton(pngBuf: Buffer) {
  if (isLoadingSpinner(pngBuf)) return false;
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  let yellow = 0;
  let maxRow = 0;
  for (let y = Math.floor(height * 0.55); y < Math.floor(height * 0.78); y += 2) {
    let row = 0;
    for (let x = Math.floor(width * 0.18); x < Math.floor(width * 0.72); x += 2) {
      const i = (width * y + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 210 && g > 160 && b < 90 && r + g > 390) {
        yellow += 1;
        row += 1;
      }
    }
    if (row > maxRow) maxRow = row;
  }
  // Wide UPGRADE button, not a gold spinner.
  return yellow >= 60 && maxRow >= 18;
}

function findUpgradeModalClose(pngBuf: Buffer) {
  if (!hasYellowUpgradeButton(pngBuf)) return null;
  return findDismissButton(pngBuf);
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
  if (findPurpleLoginButtons(pngBuf).length >= 2) return "login";
  if (grass > 0.16) return "game";
  if (isLoadingSpinner(pngBuf) || grass < 0.1) return "loading";
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

function isPlayHighlight(r: number, g: number, b: number) {
  return r > 170 && g > 230 && b > 170 && g >= r - 10;
}

function isButtonGreen(r: number, g: number, b: number) {
  return g > 170 && g > r + 40 && g > b && r < 140 && b < 160;
}

function findPlayButtons(pngBuf: Buffer) {
  const img = PNG.sync.read(pngBuf);
  const { width, height, data } = img;
  const xMin = Math.floor(width * 0.2);
  const yMin = Math.floor(height * 0.32);
  const yMax = Math.floor(height * 0.76);
  const pix = (x: number, y: number) => {
    const i = (width * y + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const hi: { x: number; y: number; n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < width - 6; x += 1) {
      const [r, g, b] = pix(x, y);
      if (!isPlayHighlight(r, g, b)) continue;
      let hit = hi.find((c) => Math.abs(c.x - x) < 12 && Math.abs(c.y - y) < 12);
      if (!hit) {
        hit = { x, y, n: 0, x0: x, x1: x, y0: y, y1: y };
        hi.push(hit);
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
  const buttons: { x: number; y: number }[] = [];
  for (const c of hi) {
    if (c.n < 12) continue;
    let gx0 = c.x0;
    let gx1 = c.x1;
    let gy0 = c.y0;
    let gy1 = c.y1;
    let gn = 0;
    for (let y = Math.max(yMin, c.y0 - 8); y <= Math.min(yMax - 1, c.y1 + 8); y += 1) {
      for (let x = Math.max(xMin, c.x0 - 8); x <= Math.min(width - 2, c.x1 + 8); x += 1) {
        const [r, g, b] = pix(x, y);
        if (!isButtonGreen(r, g, b) && !isPlayHighlight(r, g, b)) continue;
        gn += 1;
        gx0 = Math.min(gx0, x);
        gx1 = Math.max(gx1, x);
        gy0 = Math.min(gy0, y);
        gy1 = Math.max(gy1, y);
      }
    }
    const bw = gx1 - gx0 + 1;
    const bh = gy1 - gy0 + 1;
    if (gn < 80) continue;
    if (bw < 13 || bw > 36) continue;
    if (bh < 12 || bh > 24) continue;
    if (bh > bw + 1) continue;
    const cx = Math.round((gx0 + gx1) / 2);
    const cy = Math.round((gy0 + gy1) / 2);
    if (isProfileZone(cx, cy, width, height)) continue;
    if (buttons.some((t) => Math.abs(t.x - cx) < 18 && Math.abs(t.y - cy) < 18)) continue;
    buttons.push({ x: cx, y: cy });
  }
  return buttons.sort((a, b) => a.y - b.y || a.x - b.x);
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
