/** GeckoTerminal public API — Ronin / Katana. Cached ~1 min. */
const GT = "https://api.geckoterminal.com/api/v2";
const NET = "ronin";
const COIN = "0x7dc167e270d5ef683ceaf4afcdf2efbdd667a9a7";
export const COIN_WRON_POOL = "0xda021b3d91f82bf2bcfc1a8709545c3a643d47de";

/** Highest-liquidity Katana pool per Craft World resource (RESOURCE/COIN or COIN/RESOURCE). */
export const RESOURCE_POOLS: Record<string, string> = {
  COIN: COIN_WRON_POOL,
  EARTH: "0xc356cd52364541379ad4d31a889b7031e758220a",
  MUD: "0xb287ea5a5cd4f2b74571e30fdec96241aa5163d9",
  CLAY: "0x8b1a1b7b43a53904b0a05406c13399079e553501",
  SAND: "0x6d8839a585f7877a5e218a217c07334980f04a4a",
  COPPER: "0xa09dda31b854720b6d2f28dee9c87b05d0b80d14",
  STEEL: "0x70c063f17dacb35e4b3df06c8f36020416a44a3c",
  SCREWS: "0x0016c4c602cc1a96a9d35fe133a7e374d3cdc26d",
  WATER: "0xf14ad4a21a9e71ba967b8b99e278d03a1933b44a",
  FIRE: "0xe973dc221bb031010ec673105ed8b04c9e713b9d",
  SEAWATER: "0x98514550c92ae3b508e8c6ba97429de5162d3932",
  CERAMICS: "0xfa3a564b27deb29781f80032df662a4406eebef6",
  WIRE: "0xd0fdb28cbbac1808c3bda4c8deb93eb1a8357d0f",
  ALGAE: "0xe63f8cefea9a17a259bb3b375929bd10d5e1cdfa",
  NEST: "0xc2135a1b453e7f744b1725961cd97b5a597696aa",
};

export type TokenQuote = {
  symbol: string;
  usd: number;
  coin: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  pool: string;
};

export type MarketSnap = {
  at: number;
  coinUsd: number | null;
  coinChange24h: number | null;
  quotes: Record<string, TokenQuote>;
  error: string | null;
};

export type ValueRow = {
  symbol: string;
  amount: number;
  unitUsd: number | null;
  usd: number | null;
  coin: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
};

export type MarketView = MarketSnap & {
  stockUsd: number;
  sessionUsd: number;
  usdPerHour: number;
  stock: ValueRow[];
  session: ValueRow[];
};

let cache: MarketSnap | null = null;
let inflight: Promise<MarketSnap> | null = null;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function gt(path: string): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(`${GT}${path}`, {
      headers: {
        accept: "application/json;version=20230203",
        "user-agent": "clique24/1.0",
      },
      signal: ac.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: text.slice(0, 200) };
    }
  } finally {
    clearTimeout(t);
  }
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function poolSides(name: string): { base: string; quote: string } {
  const core = String(name || "")
    .replace(/\s+\d+(\.\d+)?%\s*$/, "")
    .trim();
  const [base, quote] = core.split(/\s*\/\s*/);
  return { base: (base || "").toUpperCase(), quote: (quote || "").toUpperCase() };
}

function parsePools(raw: Record<string, unknown>): Record<string, TokenQuote> {
  const out: Record<string, TokenQuote> = {};
  const rows = (raw.data as unknown[]) ?? [];
  for (const row of rows) {
    const rec = asRec(row);
    const a = asRec(rec?.attributes);
    if (!a) continue;
    const pool = String(a.address || "");
    const { base, quote } = poolSides(String(a.name || ""));
    const baseUsd = num(a.base_token_price_usd);
    const quoteUsd = num(a.quote_token_price_usd);
    const baseInQuote = num(a.base_token_price_quote_token);
    const quoteInBase = num(a.quote_token_price_base_token);
    const chg = num(asRec(a.price_change_percentage)?.h24);
    const liq = num(a.reserve_in_usd);
    const vol = num(asRec(a.volume_usd)?.h24);
    const push = (symbol: string, usd: number | null, coinAmt: number | null) => {
      if (!symbol || usd == null) return;
      const prev = out[symbol];
      const isCoinHub = pool.toLowerCase() === COIN_WRON_POOL;
      if (symbol === "COIN") {
        if (prev && !isCoinHub && prev.pool.toLowerCase() === COIN_WRON_POOL) return;
      } else if (prev && (prev.liquidityUsd ?? 0) > (liq ?? 0)) {
        return;
      }
      out[symbol] = {
        symbol,
        usd,
        coin: coinAmt,
        change24h: symbol === base ? chg : chg != null ? -chg : null,
        liquidityUsd: liq,
        volume24h: vol,
        pool,
      };
    };
    if (base === "COIN") {
      push("COIN", baseUsd, 1);
      const coinPerQuote = quoteInBase;
      push(quote, quoteUsd, coinPerQuote);
    } else if (quote === "COIN") {
      push(base, baseUsd, baseInQuote);
      if (!out.COIN) push("COIN", quoteUsd, 1);
    } else {
      push(base, baseUsd, null);
      push(quote, quoteUsd, null);
    }
  }
  return out;
}

export async function fetchMarket(): Promise<MarketSnap> {
  const addrs = [...new Set(Object.values(RESOURCE_POOLS).map((a) => a.toLowerCase()))];
  try {
    const raw = await gt(`/networks/${NET}/pools/multi/${addrs.join(",")}`);
    if (raw.status || raw.error) {
      const msg =
        String(asRec(raw.status)?.error_message || raw.error || "gecko indisponível").slice(0, 160);
      return { at: Date.now(), coinUsd: cache?.coinUsd ?? null, coinChange24h: cache?.coinChange24h ?? null, quotes: cache?.quotes ?? {}, error: msg };
    }
    const quotes = parsePools(raw);
    const coin = quotes.COIN;
    return {
      at: Date.now(),
      coinUsd: coin?.usd ?? null,
      coinChange24h: coin?.change24h ?? null,
      quotes,
      error: null,
    };
  } catch (e) {
    return {
      at: Date.now(),
      coinUsd: cache?.coinUsd ?? null,
      coinChange24h: cache?.coinChange24h ?? null,
      quotes: cache?.quotes ?? {},
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getMarket(force = false): Promise<MarketSnap> {
  if (!force && cache && Date.now() - cache.at < 55_000 && !cache.error) return cache;
  if (inflight) return inflight;
  inflight = fetchMarket().then((m) => {
    cache = m;
    inflight = null;
    return m;
  });
  return inflight;
}

export function peekMarket(): MarketSnap | null {
  return cache;
}

function valueRow(symbol: string, amount: number, quotes: Record<string, TokenQuote>): ValueRow {
  const q = quotes[symbol.toUpperCase()];
  const unit = q?.usd ?? null;
  return {
    symbol: symbol.toUpperCase(),
    amount,
    unitUsd: unit,
    usd: unit != null ? amount * unit : null,
    coin: q?.coin ?? null,
    change24h: q?.change24h ?? null,
    liquidityUsd: q?.liquidityUsd ?? null,
  };
}

export function marketView(
  market: MarketSnap,
  stock: { symbol: string; amount: number }[],
  collected: { symbol: string; amount: number }[],
  sessionStartedAt: number,
): MarketView {
  const skip = new Set(["COIN", "DUST", "PAPERWRAP", "SANDWRAP", "BOOK"]);
  const stockRows = stock
    .filter((r) => r.symbol && !skip.has(r.symbol) && r.amount > 0)
    .map((r) => valueRow(r.symbol, r.amount, market.quotes))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const sessionRows = collected
    .filter((r) => r.symbol && r.symbol !== "COIN" && !skip.has(r.symbol) && r.amount > 0)
    .map((r) => valueRow(r.symbol, r.amount, market.quotes))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const stockUsd = stockRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const sessionUsd = sessionRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const hours = Math.max(1 / 60, (Date.now() - (sessionStartedAt || Date.now())) / 3.6e6);
  return {
    ...market,
    stockUsd,
    sessionUsd,
    usdPerHour: sessionUsd / hours,
    stock: stockRows,
    session: sessionRows,
  };
}
