const GQL = "https://craft-world.gg/graphql";
const INGEST = "https://craft-world.gg/api/1/user-actions/ingest";
const APP_VERSION = "1.21.0";
export const FIREBASE_API_KEY = "AIzaSyDgDDykbRrhbdfWUpm1BUgj4ga7d_-wy_g";
const FIREBASE_REFRESH = "https://securetoken.googleapis.com/v1/token";

export type Resource = { symbol: string; amount: number };

export type FactorySnap = {
  id: string;
  level: number;
  areaId: string;
  symbol: string;
  startedAt: string | null;
  claimedAt: string | null;
  idle: boolean;
};

export type MineSnap = {
  id: string;
  level: number;
  startedAt: string | null;
  claimedAt: string | null;
  idle: boolean;
};

export type AreaSnap = {
  id: string;
  symbol: string;
  factories: FactorySnap[];
  idleFactories: number;
};

export type GameSnap = {
  accountId: string;
  energy: number;
  energyMax: number;
  powerUsed: number;
  xp: number;
  resources: Resource[];
  factories: FactorySnap[];
  mines: MineSnap[];
  areas: AreaSnap[];
};

export type CycleReport = {
  snap: GameSnap;
  collected: Resource[];
  spent: Resource[];
  xpGained: number;
  claimedNodes: number;
  claimedMines: number;
  started: number;
  energyBefore: number;
  energyAfter: number;
};

export const PRODUCTION_PATHS = [
  { id: "earth", label: "Terra", steps: ["EARTH", "MUD", "CLAY", "SAND", "COPPER", "STEEL", "WIRE"] },
  { id: "water", label: "Água", steps: ["WATER", "SEAWATER", "ALGAE"] },
  { id: "fire", label: "Fogo", steps: ["FIRE", "HEAT", "LAVA"] },
] as const;

export function targetsForFocus(symbol: string): string[] {
  const want = symbol.trim().toUpperCase();
  if (!want) return [];
  for (const path of PRODUCTION_PATHS) {
    const i = (path.steps as readonly string[]).indexOf(want);
    if (i < 0) continue;
    return [...path.steps.slice(0, i + 1)].reverse();
  }
  return [want];
}

const SNAP_QUERY = `{
  account {
    id
    power
    powerUsed
    experiencePoints
    powerState { power maxPower }
    resources { symbol amount }
    mines { id level startedAt claimedAt }
    areas {
      id
      symbol
      factories {
        factory { id level }
        crafting { startedAt claimedAt }
      }
    }
  }
}`;

function uuidv7() {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let ms = Date.now();
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function headers(auth: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: auth,
    "x-app-version": APP_VERSION,
    origin: "https://craft-world.gg",
    referer: "https://craft-world.gg/",
  };
}

async function postJson(url: string, auth: string, body: unknown) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: text.slice(0, 300) };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

export async function graphql(auth: string, query: string) {
  return postJson(GQL, auth, { query });
}

export async function ingest(
  auth: string,
  actionType: string,
  payload: Record<string, unknown>,
) {
  return ingestMany(auth, [{ actionType, payload }]);
}

export async function ingestMany(
  auth: string,
  items: { actionType: string; payload: Record<string, unknown> }[],
) {
  if (!items.length) return { data: { processed: [] } };
  return postJson(INGEST, auth, {
    data: items.map((it) => ({
      id: uuidv7(),
      actionType: it.actionType,
      payload: it.payload,
      time: Date.now(),
    })),
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function parseAccount(acc: Record<string, unknown>): GameSnap {
  const powerState = asRecord(acc.powerState) ?? {};
  const resources = ((acc.resources as Resource[]) ?? []).filter((r) => Number(r.amount) > 0);
  const rawAreas = (acc.areas as {
    id?: string;
    symbol?: string;
    factories?: ({
      factory?: { id?: string; level?: number } | null;
      crafting?: { startedAt?: string | null; claimedAt?: string | null } | null;
    } | null)[];
  }[]) ?? [];

  const areas: AreaSnap[] = [];
  const factories: FactorySnap[] = [];
  for (const area of rawAreas) {
    const areaId = String(area.id ?? "");
    if (!areaId) continue;
    const symbol = String(area.symbol ?? "?");
    const facs: FactorySnap[] = [];
    for (const slot of area.factories ?? []) {
      const id = slot?.factory?.id;
      if (!id) continue;
      const startedAt = slot.crafting?.startedAt ?? null;
      const fac: FactorySnap = {
        id,
        level: slot.factory?.level ?? 0,
        areaId,
        symbol,
        startedAt,
        claimedAt: slot.crafting?.claimedAt ?? null,
        idle: !startedAt,
      };
      facs.push(fac);
      factories.push(fac);
    }
    areas.push({
      id: areaId,
      symbol,
      factories: facs,
      idleFactories: facs.filter((f) => f.idle).length,
    });
  }

  const mines = ((acc.mines as MineSnap[]) ?? []).map((m) => ({
    id: m.id,
    level: m.level ?? 0,
    startedAt: m.startedAt ?? null,
    claimedAt: m.claimedAt ?? null,
    idle: !m.startedAt,
  }));

  return {
    accountId: String(acc.id ?? ""),
    energy: Number(powerState.power ?? acc.power ?? 0),
    energyMax: Number(powerState.maxPower ?? 0),
    powerUsed: Number(acc.powerUsed ?? 0),
    xp: Number(acc.experiencePoints ?? 0),
    resources,
    factories,
    mines,
    areas,
  };
}

export async function fetchSnapshot(auth: string): Promise<GameSnap> {
  const raw = await graphql(auth, SNAP_QUERY);
  const data = asRecord(raw.data);
  const acc = asRecord(data?.account);
  if (!acc) {
    const err =
      (raw.errors as { message: string }[] | undefined)?.[0]?.message ||
      raw.error ||
      "GraphQL sem account";
    throw new Error(String(err));
  }
  return parseAccount(acc);
}

export function jwtExpiresAt(auth: string): number | null {
  try {
    const raw = auth.replace(/^Bearer\s+/i, "").replace(/^jwt_/, "");
    const part = raw.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      exp?: number;
    };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isJwtExpiring(auth: string, skewSec = 300) {
  const exp = jwtExpiresAt(auth);
  if (!exp) return true;
  return exp - Date.now() / 1000 < skewSec;
}

export function isAuthError(msg: string) {
  return /unauth|sign-in|sign in|token|expired|jwt/i.test(msg);
}

export async function refreshIdToken(
  refreshToken: string,
  apiKey = FIREBASE_API_KEY,
): Promise<{ authorization: string; refreshToken: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(`${FIREBASE_REFRESH}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    id_token?: string;
    refresh_token?: string;
    expires_in?: string;
    error?: { message?: string };
  };
  if (!data.id_token) {
    throw new Error(data.error?.message || "Falha ao renovar a sessão Firebase");
  }
  return {
    authorization: `Bearer jwt_${data.id_token}`,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
  };
}

export function ingestOk(res: Record<string, unknown>) {
  if (res.error) return false;
  const data = res.data as { processed?: string[] } | undefined;
  return Array.isArray(data?.processed) && data.processed.length > 0;
}

export function ingestError(res: Record<string, unknown>) {
  return typeof res.error === "string" ? res.error : null;
}

function stockMap(list: Resource[]) {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.symbol, Number(r.amount) || 0);
  return m;
}

export function resourceDiff(before: Resource[], after: Resource[]): Resource[] {
  const a = stockMap(after);
  const b = stockMap(before);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: Resource[] = [];
  for (const k of keys) {
    if (k === "COIN") continue;
    const d = (a.get(k) ?? 0) - (b.get(k) ?? 0);
    if (Math.abs(d) < 0.5) continue;
    out.push({ symbol: k, amount: d });
  }
  return out.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
}

export function positives(diff: Resource[]) {
  return diff.filter((r) => r.amount > 0).map((r) => ({ symbol: r.symbol, amount: r.amount }));
}

export function negatives(diff: Resource[]) {
  return diff
    .filter((r) => r.amount < 0)
    .map((r) => ({ symbol: r.symbol, amount: Math.abs(r.amount) }));
}

function formatList(list: Resource[], sign: "+" | "-") {
  return list
    .map((r) => `${r.symbol} ${sign}${Math.round(r.amount)}`)
    .join(" · ");
}

function formatStock(list: Resource[]) {
  return list
    .filter((r) => r.symbol !== "COIN")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map((r) => `${r.symbol} ${Math.round(r.amount)}`)
    .join(" · ");
}

async function withRetry(
  fn: () => Promise<Record<string, unknown>>,
  times = 2,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = { error: "retry" };
  for (let i = 0; i < times; i += 1) {
    last = await fn();
    if (ingestOk(last) || ingestError(last)) return last;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return last;
}

const startCooldown = new Map<string, number>();

function cooledDown(id: string) {
  const until = startCooldown.get(id) || 0;
  return Date.now() >= until;
}

function cool(id: string, ms: number) {
  startCooldown.set(id, Date.now() + ms);
}

/** Unity HUD energy = account.power / powerState.maxPower. Nodes after a factory = CLAIM_AREA. */
export const CYCLE_MS = 15_000;
export const FULL_POWER_CYCLE_MS = 8_000;

export async function runApiCycle(
  auth: string,
  log: (s: string) => void,
  energyMin = 100,
  factoryTargets: string[] = [],
  fullPower = false,
): Promise<CycleReport> {
  const before = await fetchSnapshot(auth);
  const idleFac = before.factories.filter((f) => f.idle).length;
  log(
    `API: energia ${before.energy}/${before.energyMax || "?"} (uso ${before.powerUsed}) · XP ${before.xp} · ${before.factories.length} fábricas (${idleFac} paradas) · ${before.areas.length} nodes`,
  );

  const claimItems = [
    ...before.areas.map((area) => ({
      actionType: "CLAIM_AREA",
      payload: { areaId: area.id, amountToClaim: 1_000_000 },
    })),
    ...before.mines.map((mine) => ({
      actionType: "CLAIM_MINE",
      payload: { mineId: mine.id },
    })),
  ];
  const claimRes = await withRetry(() => ingestMany(auth, claimItems));
  let claimedNodes = 0;
  let claimedMines = 0;
  if (ingestOk(claimRes)) {
    const n = ((claimRes.data as { processed?: string[] })?.processed || []).length;
    claimedNodes = Math.min(n, before.areas.length);
    claimedMines = Math.max(0, n - claimedNodes);
    if (n) log(`OK: CLAIM em lote (${n} ações)`);
  } else {
    const err = ingestError(claimRes) || "";
    if (err && !/nothing to claim/i.test(err)) {
      log(`CLAIM lote: ${err.split("\n")[0].slice(0, 120)} — tento um a um.`);
    }
    claimedNodes = 0;
    claimedMines = 0;
    for (const area of before.areas) {
      const res = await ingest(auth, "CLAIM_AREA", { areaId: area.id, amountToClaim: 1_000_000 });
      if (ingestOk(res)) {
        claimedNodes += 1;
        log(`OK: coletei node ${area.symbol}`);
      }
    }
    for (const mine of before.mines) {
      const res = await ingest(auth, "CLAIM_MINE", { mineId: mine.id });
      if (ingestOk(res)) {
        claimedMines += 1;
        log(`OK: coletei mina lv${mine.level}`);
      }
    }
  }

  const mid = await fetchSnapshot(auth);
  const collected = positives(resourceDiff(before.resources, mid.resources));
  const xpGained = Math.max(0, mid.xp - before.xp);
  if (collected.length) {
    log(`Coleta real: ${formatList(collected, "+")}${xpGained ? `  ·  XP +${Math.round(xpGained)}` : ""}`);
  } else {
    log("CLAIM ok, mas inventário igual — nodes já estavam vazios.");
  }

  const START_RANK: Record<string, number> = {
    EARTH: 0,
    WATER: 1,
    MUD: 2,
    SAND: 3,
    CLAY: 4,
    COPPER: 5,
  };
  const reserve = fullPower ? 0 : Math.max(40, Math.round((mid.energyMax || 1250) * 0.04));
  const maxStart = fullPower ? 10_000 : 1;
  let started = 0;
  let spent: Resource[] = [];
  let after = mid;
  let energyNow = mid.energy;

  for (const mine of mid.mines) {
    if (!cooledDown(mine.id)) continue;
    const res = await ingest(auth, "START_MINE", { mineId: mine.id });
    if (ingestOk(res)) log(`OK: START mina lv${mine.level}`);
    else {
      const err = ingestError(res) || "";
      if (/still running|not idle|already/i.test(err)) continue;
      if (err) {
        cool(mine.id, 60_000);
        log(`Mina: ${err.split("\n")[0].slice(0, 120)}`);
      }
    }
  }

  if (!fullPower && energyNow < reserve) {
    log(`Energia baixa (${energyNow}/${mid.energyMax}, piso ${reserve}). Só coleto — 1 fábrica quando recuperar.`);
  } else {
    if (fullPower) log(`FULL POWER · energia ${energyNow}/${mid.energyMax} · sem teto de START.`);
    let skippedRes = 0;
    const want = factoryTargets.map((s) => s.toUpperCase()).filter(Boolean);
    let idle = mid.factories.filter((f) => f.idle && (fullPower || cooledDown(f.id)));
    if (want.length) {
      idle = idle.filter((f) => want.includes(f.symbol.toUpperCase()));
      idle.sort((a, b) => {
        const ia = want.indexOf(a.symbol.toUpperCase());
        const ib = want.indexOf(b.symbol.toUpperCase());
        if (ia !== ib) return ia - ib;
        return b.level - a.level;
      });
      log(`Prioridade: ${want.join(" → ")} · ${idle.length} idle na lista.`);
    } else {
      idle.sort((a, b) => {
        const ra = (START_RANK[a.symbol] ?? 20) * 100 + a.level;
        const rb = (START_RANK[b.symbol] ?? 20) * 100 + b.level;
        return ra - rb;
      });
    }

    for (const fac of idle) {
      if (started >= maxStart) break;
      if (!fullPower && energyNow < reserve) {
        log(`Paro de ligar: energia ${energyNow} < ${reserve}.`);
        break;
      }
      if (!fullPower && fac.level >= 4 && energyNow < 300) {
        continue;
      }
      const stockBefore = after.resources;
      const res = await ingest(auth, "START_FACTORY", { factoryId: fac.id });
      if (ingestOk(res)) {
        started += 1;
        log(`OK: START fábrica ${fac.symbol} lv${fac.level}`);
        if (!fullPower || started % 5 === 0) {
          const snap = await fetchSnapshot(auth);
          energyNow = snap.energy;
          after = snap;
          if (!fullPower) {
            const burn = negatives(resourceDiff(stockBefore, snap.resources));
            const heavy = burn.find((r) => r.amount >= 250);
            if (heavy) {
              cool(fac.id, 120_000);
              log(`Essa ${fac.symbol} comeu ${Math.round(heavy.amount)} ${heavy.symbol}. Espero 2 min pra não secar o estoque.`);
            }
          }
        }
        continue;
      }
      const err = ingestError(res) || "";
      if (/not idle/i.test(err)) continue;
      if (/not enough balance/i.test(err)) {
        skippedRes += 1;
        cool(fac.id, fullPower ? 20_000 : 90_000);
        continue;
      }
      if (/not enough.*power|insufficient power|not enough energy/i.test(err)) {
        log(`Skip: ${fac.symbol} lv${fac.level} pede mais energia que ${energyNow}.`);
        cool(fac.id, fullPower ? 15_000 : 45_000);
        break;
      }
      if (err) log(`Fábrica ${fac.symbol} lv${fac.level}: ${err.split("\n")[0].slice(0, 120)}`);
    }
    if (skippedRes) log(`Skip: ${skippedRes} fábricas sem matéria-prima (offline ${fullPower ? 20 : 90}s).`);

    if (started) {
      if (fullPower) after = await fetchSnapshot(auth);
      spent = negatives(resourceDiff(mid.resources, after.resources));
      if (spent.length) log(`Gastou nas fábricas: ${formatList(spent, "-")}`);
    }
  }

  const top = formatStock(after.resources);
  if (top) log(`Estoque agora: ${top}`);
  log(
    `Ciclo: ${claimedNodes} nodes + ${claimedMines} minas · ${started} fábricas ligadas · energia ${after.energy}/${after.energyMax || "?"}.`,
  );

  return {
    snap: after,
    collected,
    spent,
    xpGained,
    claimedNodes,
    claimedMines,
    started,
    energyBefore: before.energy,
    energyAfter: after.energy,
  };
}
