import { specAt, rawBasket, recipeParentsOf } from "./recipes";
import type { GameSnap } from "./api";
import type { MarketSnap, TokenQuote } from "./prices";

const FEE = 0.01;
const SKIP = new Set(["COIN", "DUST", "PAPERWRAP", "SANDWRAP", "BOOK", "WRON"]);

export type ProfitRow = {
  symbol: string;
  owned: number;
  avgLevel: number;
  durationSeconds: number;
  powerCost: number;
  outputH: number;
  energyH: number;
  /** Spot conversion: sell output vs buy/sell the immediate parents. */
  convertUsd: number | null;
  convertPct: number | null;
  convertUsdH: number | null;
  /** Full tree vs selling the raw (EARTH/WATER/FIRE) on the market. */
  chainUsd: number | null;
  chainPct: number | null;
  chainUsdH: number | null;
  usdPerEnergy: number | null;
  liquidityUsd: number | null;
  change24h: number | null;
  score: number;
  verdict: "best" | "good" | "ok" | "skip" | "loss";
  why: string;
};

export type ProfitView = {
  at: number;
  best: ProfitRow | null;
  rows: ProfitRow[];
  energy: number;
  energyMax: number;
};

function usdOf(q: TokenQuote | undefined): number | null {
  const n = q?.usd;
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function fleet(snap: GameSnap | null): { symbol: string; level: number; kind: "factory" | "mine" }[] {
  const out: { symbol: string; level: number; kind: "factory" | "mine" }[] = [];
  for (const f of snap?.factories ?? []) {
    if (!f.symbol) continue;
    out.push({ symbol: f.symbol.toUpperCase(), level: f.level || 1, kind: "factory" });
  }
  for (const m of snap?.mines ?? []) {
    out.push({ symbol: "EARTH", level: m.level || 1, kind: "mine" });
  }
  if (!out.some((x) => x.symbol === "EARTH") && (snap?.mines?.length || snap?.areas?.some((a) => a.symbol === "EARTH"))) {
    out.push({ symbol: "EARTH", level: 1, kind: "mine" });
  }
  return out;
}

function groupFleet(list: ReturnType<typeof fleet>) {
  const g = new Map<string, { n: number; levels: number[] }>();
  for (const x of list) {
    const cur = g.get(x.symbol) ?? { n: 0, levels: [] };
    cur.n += 1;
    cur.levels.push(x.level);
    g.set(x.symbol, cur);
  }
  return g;
}

export function rankProfit(opts: {
  snap: GameSnap | null;
  market: MarketSnap | null;
  energy?: number | null;
  energyMax?: number | null;
}): ProfitView {
  const quotes = opts.market?.quotes ?? {};
  const energy = opts.energy ?? opts.snap?.energy ?? 0;
  const energyMax = opts.energyMax ?? opts.snap?.energyMax ?? 0;
  const items = fleet(opts.snap);
  const grouped = groupFleet(items);
  const energyRatio = energyMax > 0 ? energy / energyMax : 1;
  const rows: ProfitRow[] = [];

  const units = [...new Set([...grouped.keys(), ...Object.keys(quotes)])]
    .map((s) => s.toUpperCase())
    .filter((s) => !SKIP.has(s));

  for (const symbol of units) {
    const own = grouped.get(symbol);
    const owned = own?.n ?? 0;
    if (owned <= 0 && !specAt(symbol, 1)) continue;
    const px = usdOf(quotes[symbol]);
    if (px == null) continue;

    const levels = own?.levels?.length ? own.levels : [1];
    const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length;
    let outputH = 0;
    let energyH = 0;
    let convertUsdH = 0;
    let convertUsd: number | null = null;
    let convertPct: number | null = null;
    let durationSeconds = 0;
    let powerCost = 0;
    let convertReady = true;

    for (const lv of levels) {
      const spec = specAt(symbol, lv);
      if (!spec || spec.durationSeconds <= 0 || spec.output <= 0) continue;
      durationSeconds = spec.durationSeconds;
      powerCost = spec.powerCost;
      const cyclesH = 3600 / spec.durationSeconds;
      outputH += spec.output * cyclesH;
      energyH += spec.powerCost * cyclesH;
      let inCost = 0;
      for (const inp of spec.inputs) {
        const ip = usdOf(quotes[inp.symbol]);
        if (ip == null) {
          convertReady = false;
          continue;
        }
        inCost += inp.amount * ip;
      }
      const rev = spec.output * px * (1 - FEE);
      const spread = rev - inCost;
      convertUsdH += spread * cyclesH;
      convertUsd = spread / spec.output;
      convertPct = inCost > 0 ? (spread / inCost) * 100 : spec.inputs.length === 0 ? 100 : null;
    }

    const basket = rawBasket(symbol, 1);
    let chainCost = 0;
    let chainReady = true;
    for (const [raw, qty] of Object.entries(basket)) {
      if (raw === symbol && recipeParentsOf(symbol).length === 0) {
        chainCost = 0;
        continue;
      }
      const ip = usdOf(quotes[raw]);
      if (ip == null) {
        chainReady = false;
        continue;
      }
      chainCost += qty * ip;
    }
    const chainRev = px * (1 - FEE);
    const chainUsd = chainReady ? chainRev - chainCost : null;
    const chainPct = chainReady && chainCost > 0 ? ((chainRev - chainCost) / chainCost) * 100 : chainReady && chainCost === 0 ? 100 : null;
    const chainUsdH = chainUsd != null ? chainUsd * outputH : null;
    const usdPerEnergy = energyH > 0 && chainUsdH != null ? chainUsdH / energyH : chainUsdH != null && energyH === 0 ? chainUsdH : null;

    const liq = quotes[symbol]?.liquidityUsd ?? null;
    const chg = quotes[symbol]?.change24h ?? null;
    const liqF = Math.max(0.2, Math.min(1, (liq ?? 80) / 400));
    const momF = 1 + Math.max(-25, Math.min(25, chg ?? 0)) / 250;
    let energyF = 1;
    if (energyRatio < 0.22 && energyH > 800) energyF = 0.45;
    else if (energyRatio < 0.4 && energyH > 4000) energyF = 0.7;
    else if (energyH > 0) energyF = 1 / (1 + energyH / 25000);

    const usdH = chainUsdH ?? (convertReady ? convertUsdH : 0);
    let score = usdH * liqF * momF * energyF;
    if (owned <= 0) score *= 0.05;
    if (chainUsd != null && chainUsd < 0) score = Math.min(score, chainUsd * outputH * 0.2);

    let verdict: ProfitRow["verdict"] = "ok";
    let why: string;
    if (chainUsd != null && chainUsd < 0) {
      verdict = "loss";
      why = `prejuízo ${Math.abs(chainPct ?? 0).toFixed(1)}% vs vender a matéria-prima`;
    } else if (convertPct != null && convertPct < 0 && recipeParentsOf(symbol).length) {
      verdict = "skip";
      why = `converter destrói valor (${convertPct.toFixed(1)}%) · melhor vender o input`;
    } else if ((chainUsdH ?? 0) <= 0 && (convertUsdH ?? 0) <= 0) {
      verdict = "skip";
      why = "sem lucro líquido nesta cotação";
    } else if ((chainPct ?? 0) >= 8 || (chainUsdH ?? 0) > 0.05) {
      verdict = "good";
      why = `+${(chainPct ?? 0).toFixed(1)}% cadeia · ${outputH >= 1 ? outputH.toFixed(1) : outputH.toFixed(3)}/h · ${Math.round(energyH)} energia/h`;
    } else {
      verdict = "ok";
      why = `margem fina · ${Math.round(durationSeconds)}s/ciclo · ${Math.round(powerCost)} energia`;
    }

    rows.push({
      symbol,
      owned,
      avgLevel,
      durationSeconds,
      powerCost,
      outputH,
      energyH,
      convertUsd: convertReady ? convertUsd : null,
      convertPct: convertReady ? convertPct : null,
      convertUsdH: convertReady ? convertUsdH : null,
      chainUsd,
      chainPct,
      chainUsdH,
      usdPerEnergy,
      liquidityUsd: liq,
      change24h: chg,
      score,
      verdict,
      why,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  const playable = rows.filter((r) => r.owned > 0 && r.verdict !== "loss" && r.verdict !== "skip" && r.score > 0);
  const best = playable[0] ?? rows.find((r) => r.owned > 0 && r.score > 0) ?? null;
  if (best) best.verdict = "best";

  return { at: Date.now(), best, rows: rows.slice(0, 16), energy, energyMax };
}

export function shouldSwitch(current: string | null, view: ProfitView, hysteresis = 1.12): boolean {
  const best = view.best;
  if (!best) return false;
  const cur = (current || "").toUpperCase();
  if (!cur) return true;
  if (cur === best.symbol) return false;
  const row = view.rows.find((r) => r.symbol === cur);
  if (!row) return true;
  if (row.verdict === "loss" || row.verdict === "skip") return true;
  return best.score >= row.score * hysteresis;
}
