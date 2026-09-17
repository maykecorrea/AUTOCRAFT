import table from "./recipes.json";

type Raw = { in: string[]; lv: number[][] };
const DATA = table as Record<string, Raw>;

export type RecipeInput = { symbol: string; amount: number };
export type RecipeSpec = {
  symbol: string;
  level: number;
  output: number;
  durationSeconds: number;
  powerCost: number;
  inputs: RecipeInput[];
};

export function recipeSymbols(): string[] {
  return Object.keys(DATA);
}

export function recipeParentsOf(symbol: string): string[] {
  return DATA[symbol.toUpperCase()]?.in ?? [];
}

export const RECIPE_PARENTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(DATA).map(([sym, row]) => [sym, [...row.in]]),
);

export function specAt(symbol: string, level: number): RecipeSpec | null {
  const rec = DATA[symbol.toUpperCase()];
  if (!rec) return null;
  const want = Math.max(1, Math.round(level || 1));
  let row = rec.lv[0];
  for (const r of rec.lv) {
    if (r[0] <= want) row = r;
    else break;
  }
  const inputs: RecipeInput[] = rec.in.map((sym, i) => ({ symbol: sym, amount: row[4 + i] ?? 0 }));
  return {
    symbol: symbol.toUpperCase(),
    level: row[0],
    output: row[1],
    durationSeconds: row[2],
    powerCost: row[3],
    inputs,
  };
}

/** Input amount per 1 output unit, at the given level (falls back to lv1). */
export function inputsPerOut(symbol: string, level = 1): RecipeInput[] {
  const spec = specAt(symbol, level);
  if (!spec || spec.output <= 0) return [];
  return spec.inputs.map((x) => ({ symbol: x.symbol, amount: x.amount / spec.output }));
}

export function rawBasket(symbol: string, qty = 1, memo = new Map<string, Record<string, number>>): Record<string, number> {
  const key = `${symbol.toUpperCase()}:${qty}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const spec = specAt(symbol, 1);
  const out: Record<string, number> = {};
  const add = (s: string, n: number) => {
    out[s] = (out[s] ?? 0) + n;
  };
  if (!spec || spec.inputs.length === 0) {
    add(symbol.toUpperCase(), qty);
    memo.set(key, out);
    return out;
  }
  for (const inp of spec.inputs) {
    const need = qty * (inp.amount / spec.output);
    const sub = rawBasket(inp.symbol, need, memo);
    for (const [s, n] of Object.entries(sub)) add(s, n);
  }
  memo.set(key, out);
  return out;
}
