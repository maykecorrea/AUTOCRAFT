import { useCallback, useEffect, useMemo, useState } from "react";
import { Circle, Pause, Play, RotateCcw, Zap } from "lucide-react";

type Amt = { symbol: string; amount: number };
type Log = { t: number; text: string };
type Area = { id: string; symbol: string; factories: number; idle: number };
type Hist = { t: number; collected: Amt[]; xp: number; nodes: number };

type Status = {
  auto: boolean;
  hasToken: boolean;
  error: string | null;
  energy: number | null;
  energyMax: number | null;
  xp: number | null;
  factories: number;
  mines: number;
  resources: Amt[];
  areas: Area[];
  collected: Amt[];
  lastCollected: Amt[];
  lastSpent: Amt[];
  cycles: number;
  xpCollected: number;
  sessionStartedAt: number;
  lastCycleAt: number;
  history: Hist[];
  logs: Log[];
};

function hasNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const CACHE_KEY = "clique24-live-status";

function loadCached(): Status {
  try {
    if (typeof sessionStorage === "undefined") return empty;
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw) as Partial<Status>;
    if (typeof data.hasToken !== "boolean") return empty;
    return { ...empty, ...data, logs: data.logs ?? [] };
  } catch {
    return empty;
  }
}

function saveCached(st: Status) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!st.hasToken && !st.cycles) return;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(st));
  } catch {
    /* quota */
  }
}

const empty: Status = {
  auto: false,
  hasToken: false,
  error: null,
  energy: null,
  energyMax: null,
  xp: null,
  factories: 0,
  mines: 0,
  resources: [],
  areas: [],
  collected: [],
  lastCollected: [],
  lastSpent: [],
  cycles: 0,
  xpCollected: 0,
  sessionStartedAt: 0,
  lastCycleAt: 0,
  history: [],
  logs: [],
};

async function api(path: string, body?: unknown) {
  const get = path.endsWith("/status") && body === undefined;
  const res = await fetch(path, {
    method: get ? "GET" : "POST",
    headers: get ? undefined : { "content-type": "application/json" },
    body: get ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as Status & { error?: string; autoPatch?: number };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function isLiveStatus(data: Partial<Status> & { autoPatch?: number; stale?: boolean }) {
  if (typeof data.hasToken === "boolean" && typeof data.auto === "boolean") return true;
  if (hasNum(data.energyMax) || (data.cycles ?? 0) > 0) return true;
  return false;
}

function mergeStatus(prev: Status, data: Partial<Status>): Status {
  return {
    ...prev,
    ...data,
    hasToken: Boolean(data.hasToken || prev.hasToken),
    auto: typeof data.auto === "boolean" ? data.auto : prev.auto,
    logs: data.logs?.length ? data.logs : prev.logs,
    collected: data.collected?.length || data.cycles ? data.collected ?? prev.collected : prev.collected,
    lastCollected: data.lastCollected?.length ? data.lastCollected : prev.lastCollected,
    resources: data.resources?.length ? data.resources : prev.resources,
    areas: data.areas?.length ? data.areas : prev.areas,
    energyMax: hasNum(data.energyMax) && data.energyMax > 0 ? data.energyMax : prev.energyMax ?? 1250,
    energy: hasNum(data.energy) ? data.energy : prev.energy,
    xp: hasNum(data.xp) ? data.xp : prev.xp,
    cycles: Math.max(data.cycles ?? 0, prev.cycles),
    xpCollected: Math.max(data.xpCollected ?? 0, prev.xpCollected),
    sessionStartedAt: data.sessionStartedAt || prev.sessionStartedAt,
  };
}

function fmt(n: number | null | undefined) {
  if (!hasNum(n)) return "—";
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}M`;
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtSigned(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "" : "+";
  return `${sign}${fmt(n)}`;
}

function ago(ts: number) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function sessionHours(started: number) {
  if (!started) return 0;
  return Math.max(1 / 60, (Date.now() - started) / 3_600_000);
}

export function Dashboard({ initial }: { initial?: Partial<Status> | null }) {
  const [st, setSt] = useState<Status>(() => {
    if (initial && isLiveStatus(initial)) return mergeStatus(empty, initial);
    const cached = loadCached();
    if (cached.hasToken || cached.cycles) return cached;
    return empty;
  });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState(() => !!(initial && isLiveStatus(initial)));

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/bot/status");
      if (!isLiveStatus(data)) return false;
      setLive(true);
      setSt((prev) => {
        const next = mergeStatus(prev, data);
        saveCached(next);
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const cached = loadCached();
    if (cached.hasToken || cached.cycles) setSt(cached);
    void refresh();
    const id = setInterval(() => {
      void refresh();
      setNow(Date.now());
    }, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const hours = sessionHours(st.sessionStartedAt);
  const maxCollected = Math.max(1, ...st.collected.map((r) => r.amount));
  const lastTotal = st.lastCollected.reduce((s, r) => s + r.amount, 0);
  const sessionTotal = st.collected.reduce((s, r) => s + r.amount, 0);
  const energyPct =
    hasNum(st.energyMax) && st.energyMax > 0 && hasNum(st.energy)
      ? Math.max(0, Math.min(100, (st.energy / st.energyMax) * 100))
      : 0;

  const spark = useMemo(() => {
    const rows = [...(st.history ?? [])].slice(0, 16).reverse();
    const vals = rows.map((h) => h.collected.reduce((s, r) => s + r.amount, 0));
    const max = Math.max(1, ...vals);
    return vals.map((v) => (v / max) * 100);
  }, [st.history]);

  const stockBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of st.resources) m.set(r.symbol, r.amount);
    return m;
  }, [st.resources]);

  const lastBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of st.lastCollected) m.set(r.symbol, r.amount);
    return m;
  }, [st.lastCollected]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-accent">Craft World · coleta real</p>
            <h1 className="pixel-title mt-1 text-3xl font-semibold tracking-tight">Clique24</h1>
            <p className="mt-1 text-sm text-muted">
              Cada número vem do GraphQL antes e depois do CLAIM. Nada estimado.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Circle className={`size-2.5 fill-current ${st.auto ? "text-accent" : "text-faint"}`} />
            {st.auto ? "AUTO 15s" : st.hasToken || st.cycles ? "pausado" : "sem sessão"}
            {!live && (st.hasToken || st.cycles) ? <span className="text-faint"> · sincronizando</span> : null}
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-faint">Energia</p>
            <p className="mt-1 font-mono text-2xl tabular-nums">
              {fmt(st.energy)}
              <span className="text-sm text-faint">/{fmt(st.energyMax)}</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${energyPct}%` }} />
            </div>
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-faint">XP coletado</p>
            <p className="mt-1 font-mono text-2xl tabular-nums text-accent">{fmtSigned(st.xpCollected)}</p>
            <p className="mt-2 font-mono text-xs text-muted">conta {fmt(st.xp)}</p>
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-faint">Sessão</p>
            <p className="mt-1 font-mono text-2xl tabular-nums">{st.cycles} ciclos</p>
            <p className="mt-2 font-mono text-xs text-muted">
              {st.sessionStartedAt ? ago(st.sessionStartedAt) : "aguardando"} · {fmt(sessionTotal)} un.
            </p>
          </div>
        </section>

        <section className="rounded-xl bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Neste ciclo</h2>
            <p className="font-mono text-xs text-faint">{st.lastCycleAt ? `há ${ago(st.lastCycleAt)}` : "ainda não rodou"}</p>
          </div>
          {st.lastCollected.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              {st.cycles ? "CLAIM não moveu o inventário — nodes vazios." : "Esperando o primeiro CLAIM."}
            </p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {st.lastCollected.map((r) => (
                <li
                  key={r.symbol}
                  className="rounded-md bg-surface-2 px-3 py-2 font-mono text-sm tabular-nums"
                >
                  <span className="text-accent">{fmtSigned(r.amount)}</span>{" "}
                  <span className="text-muted">{r.symbol}</span>
                </li>
              ))}
              {st.xpCollected && lastTotal ? (
                <li className="rounded-md bg-surface-2 px-3 py-2 font-mono text-sm tabular-nums text-muted">
                  total {fmtSigned(lastTotal)}
                </li>
              ) : null}
            </ul>
          )}
          {st.lastSpent.length ? (
            <p className="mt-3 text-xs text-faint">
              Gastou nas fábricas:{" "}
              {st.lastSpent.map((r) => `${r.symbol} −${fmt(r.amount)}`).join(" · ")}
            </p>
          ) : null}
          {spark.length > 1 ? (
            <div className="mt-5 flex h-12 items-end gap-1">
              {spark.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-accent-dim"
                  style={{ height: `${Math.max(6, h)}%` }}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">Cálculo por recurso</h2>
          <p className="mb-4 text-sm text-muted">
            sessão = soma dos CLAIMs · ritmo = sessão ÷ tempo · estoque = inventário agora
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(st.collected.length ? st.collected : st.resources.filter((r) => r.symbol !== "COIN")).map((r) => {
              const sessionAmt = st.collected.find((c) => c.symbol === r.symbol)?.amount ?? r.amount;
              const isSession = st.collected.some((c) => c.symbol === r.symbol);
              const last = lastBy.get(r.symbol) ?? 0;
              const stock = stockBy.get(r.symbol) ?? 0;
              const rate = isSession && st.sessionStartedAt ? sessionAmt / hours : 0;
              const fill = isSession ? (sessionAmt / maxCollected) * 100 : 0;
              return (
                <article key={r.symbol} className="rounded-xl bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium tracking-wide">{r.symbol}</h3>
                    <span className="font-mono text-xs text-faint">estoque {fmt(stock)}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    <div>
                      <dt className="text-faint">ciclo</dt>
                      <dd className={last ? "text-accent" : "text-muted"}>{last ? fmtSigned(last) : "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">sessão</dt>
                      <dd>{isSession ? fmtSigned(sessionAmt) : "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">ritmo</dt>
                      <dd>{rate ? `${fmt(rate)}/h` : "—"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500"
                      style={{ width: `${Math.max(last ? 4 : 0, fill)}%` }}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {st.areas.length ? (
          <section className="rounded-xl bg-surface p-5">
            <h2 className="text-sm font-medium">Nodes</h2>
            <ul className="mt-3 divide-y divide-line">
              {st.areas.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 font-mono text-sm tabular-nums">
                  <span>{a.symbol}</span>
                  <span className="text-faint">
                    {a.factories} fáb.{a.idle ? ` · ${a.idle} parada${a.idle > 1 ? "s" : ""}` : a.factories ? " · rodando" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !st.hasToken}
            onClick={() => run(() => api("/api/bot/auto", { on: !st.auto }))}
            className={`flex h-12 min-w-40 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-40 ${
              st.auto ? "bg-accent text-bg" : "bg-accent-dim text-fg"
            }`}
          >
            {st.auto ? <Pause className="size-4" /> : <Play className="size-4" />}
            {st.auto ? "Pausar AUTO" : "Ligar AUTO 24h"}
          </button>
          <button
            type="button"
            disabled={busy || !st.hasToken || st.auto}
            onClick={() => run(() => api("/api/bot/cycle"))}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-muted disabled:opacity-40"
          >
            <Zap className="size-4" />
            1 ciclo
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api("/api/bot/clearlogs"))}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-muted disabled:opacity-40"
          >
            <RotateCcw className="size-4" />
            Limpar log
          </button>
        </section>

        {st.error ? <p className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">{st.error}</p> : null}

        <ul className="space-y-1 font-mono text-xs leading-snug text-faint">
          {st.logs.length === 0 ? (
            <li>Sem ciclo ainda.</li>
          ) : (
            st.logs.slice(0, 18).map((l) => (
              <li key={l.t + l.text}>
                <span className="text-line">{new Date(l.t).toLocaleTimeString("pt-BR", { hour12: false })}</span>{" "}
                <span className={l.text.startsWith("ERRO") ? "text-danger" : l.text.startsWith("Coleta real") || l.text.startsWith("OK") ? "text-accent" : ""}>
                  {l.text}
                </span>
              </li>
            ))
          )}
        </ul>
        <p className="hidden">{now}</p>
      </div>
    </div>
  );
}
