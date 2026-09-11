import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, MousePointerClick, Power, Square, Undo2 } from "lucide-react";

type Log = { t: number; text: string };

type Status = {
  open: boolean;
  auto: boolean;
  url: string;
  title: string;
  clicks: number;
  lastClick: string | null;
  popup: boolean;
  google: boolean;
  loggedHint: boolean;
  error: string | null;
  uptimeSec: number;
  factories: number;
  mines: number;
  logs: Log[];
};

const empty: Status = {
  open: false,
  auto: false,
  url: "",
  title: "",
  clicks: 0,
  lastClick: null,
  popup: false,
  google: false,
  loggedHint: false,
  error: null,
  uptimeSec: 0,
  factories: 0,
  mines: 0,
  logs: [],
};

async function api(path: string, body?: unknown) {
  const get = (path.endsWith("/status") || path.endsWith("/frame")) && body === undefined;
  const res = await fetch(path, {
    method: get ? "GET" : "POST",
    headers: get ? undefined : { "content-type": "application/json" },
    body: get ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.headers.get("content-type")?.includes("application/json")) {
    const data = (await res.json().catch(() => ({}))) as Status & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!get && data.error && (data.open === false || path.includes("/open"))) {
      throw new Error(data.error);
    }
    return data;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {} as Status;
}

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

export function Dashboard() {
  const [st, setSt] = useState<Status>(empty);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const booted = useRef(false);
  const closedByUser = useRef(false);
  const shownRef = useRef(false);
  const frameUrlRef = useRef<string | null>(null);

  const visible = st.open && !!frameUrl && frameUrl.startsWith("blob:");

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/bot/status");
      if (typeof data.open !== "boolean") return;
      setSt({ ...empty, ...data, logs: data.logs ?? [] });
    } catch {
      /* ignore flaps */
    }
  }, []);

  const pullFrame = useCallback(async () => {
    if (closedByUser.current) return;
    try {
      const res = await fetch("/api/bot/frame", { cache: "no-store" });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("image")) return;
      const blob = await res.blob();
      if (blob.size < 400) return;
      const url = URL.createObjectURL(blob);
      const prev = frameUrlRef.current;
      frameUrlRef.current = url;
      setFrameUrl(url);
      if (prev && prev !== url) URL.revokeObjectURL(prev);
    } catch {
      /* keep last frame */
    }
  }, []);

  useEffect(() => {
    let stop = false;
    async function boot() {
      try {
        const data = await api("/api/bot/status");
        if (stop) return;
        if (typeof data.open === "boolean") {
          setSt({ ...empty, ...data, logs: data.logs ?? [] });
        }
        if (!data.open && !booted.current) {
          booted.current = true;
          setMsg("Abrindo o Craft World…");
          await api("/api/bot/open");
          if (stop) return;
          await refresh();
          setMsg(null);
        }
      } catch {
        if (!stop) setMsg("Servidor ligando…");
      }
    }
    void boot();
    const id = setInterval(() => {
      void refresh();
      void pullFrame();
    }, 700);
    void pullFrame();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [refresh, pullFrame]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await refresh();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "falhou");
    } finally {
      setBusy(false);
    }
  }

  function pointerNorm(e: { clientX: number; clientY: number }) {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const natW = img.naturalWidth || r.width;
    const natH = img.naturalHeight || r.height;
    const scale = Math.min(r.width / natW, r.height / natH);
    const dispW = natW * scale;
    const dispH = natH * scale;
    const ox = r.left + (r.width - dispW) / 2;
    const oy = r.top + (r.height - dispH) / 2;
    const nx = (e.clientX - ox) / dispW;
    const ny = (e.clientY - oy) / dispH;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
    return { nx, ny };
  }

  function clickNorm(e: React.MouseEvent) {
    if (!visible) return;
    viewRef.current?.focus();
    const n = pointerNorm(e);
    if (!n) return;
    void api("/api/bot/click", n);
  }

  function onWheel(e: React.WheelEvent) {
    if (!visible) return;
    e.preventDefault();
    const n = pointerNorm(e);
    if (!n) return;
    void api("/api/bot/wheel", { dy: e.deltaY, nx: n.nx, ny: n.ny });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!visible) return;
    if (e.metaKey || (e.ctrlKey && e.key.toLowerCase() !== "v")) return;
    e.preventDefault();
    if (e.key === "v" && e.ctrlKey) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      void api("/api/bot/type", { text: e.key });
      return;
    }
    void api("/api/bot/key", { key: e.key });
  }

  function onPaste(e: React.ClipboardEvent) {
    if (!visible) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (text) void api("/api/bot/type", { text });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:flex-row">
      <section className="flex min-h-0 flex-1 flex-col p-3 lg:p-5">
        <header className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
              Craft World · bot 24h
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Clique24</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Circle
              className={`size-2.5 fill-current ${st.auto ? "text-accent" : visible ? "text-warn" : "text-faint"}`}
            />
            {st.auto ? "clicando" : st.open ? "navegador aberto" : "fechado"}
          </div>
        </header>

        <div
          ref={viewRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onWheel={onWheel}
          onClick={clickNorm}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`relative mx-auto flex min-h-[52vh] w-full max-w-[430px] flex-1 items-center justify-center overflow-hidden rounded-lg border bg-surface outline-none lg:min-h-0 ${
            focused ? "border-accent" : "border-line"
          }`}
        >
          {frameUrl && frameUrl.startsWith("blob:") ? (
            <img
              ref={imgRef}
              src={frameUrl}
              alt="Craft World ao vivo"
              className="h-full w-full cursor-text object-contain"
              draggable={false}
            />
          ) : (
            <div className="px-8 py-16 text-center">
              <p className="text-sm text-muted">
                {st.open ? "Esperando a primeira foto do jogo…" : "Navegador fechado. Aperte Abrir."}
              </p>
            </div>
          )}
          {visible ? (
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-md bg-bg/80 px-3 py-2 text-center text-xs text-muted">
              {focused
                ? "Pode digitar. Roleta pra baixo = afastar o mapa."
                : "Clique nesta tela, roleta pra baixo afasta o zoom."}
            </div>
          ) : null}
        </div>
      </section>

      <aside className="flex w-full flex-col gap-3 border-t border-line bg-surface p-4 lg:h-dvh lg:w-[340px] lg:overflow-y-auto lg:border-l lg:border-t-0">
        <p className="text-sm leading-relaxed text-muted">
          Agora só o login. O bot tira uma foto PNG; o <strong className="text-fg">código Node</strong>{" "}
          (não uma IA) lê os pixels e acha as barras roxas EMAIL/PHONE. Phone = a de baixo. Depois
          digita o número salvo.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              closedByUser.current = false;
              void run(async () => {
                const data = await api("/api/bot/open");
                setSt({ ...empty, ...data, logs: data.logs ?? [] });
                await pullFrame();
              }, "Chrome aberto");
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-md bg-fg text-sm font-semibold text-bg disabled:opacity-40"
          >
            <Power className="size-3.5" />
            Abrir
          </button>
          <button
            type="button"
            disabled={busy || !visible}
            onClick={() => {
              closedByUser.current = true;
              shownRef.current = false;
              sessionStorage.removeItem("c24-on");
              if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
              frameUrlRef.current = null;
              setFrameUrl(null);
              void run(() => api("/api/bot/close"));
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-line text-sm font-semibold text-muted"
          >
            <Square className="size-3.5" />
            Fechar
          </button>
        </div>

        <button
          type="button"
          disabled={busy || !visible}
          onClick={() => run(() => api("/api/bot/reload"), "Jogo recarregado, sessão mantida")}
          className="flex h-11 items-center justify-center rounded-md border border-line text-sm font-semibold text-muted"
        >
          Recuperar tela
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api("/api/bot/account", { kind: "email" }), "Email enviado")}
            className="flex h-11 items-center justify-center rounded-md bg-fg text-sm font-semibold text-bg disabled:opacity-40"
          >
            Clicar Email
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api("/api/bot/phone"), "Phone enviado")}
            className="flex h-11 items-center justify-center rounded-md bg-fg text-sm font-semibold text-bg disabled:opacity-40"
          >
            Clicar Phone
          </button>
        </div>

        <button
          type="button"
          disabled={busy || !visible}
          onClick={() => run(() => api("/api/bot/game"), "Foco no Craft World")}
          className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-line text-sm font-semibold text-muted"
        >
          <Undo2 className="size-3.5" />
          Voltar ao Craft World
        </button>

        <button
          type="button"
          disabled={busy || !visible}
          onClick={() =>
            run(
              () => api("/api/bot/auto", { on: !st.auto }),
              st.auto ? "AUTO pausado" : "AUTO 24h ligado",
            )
          }
          className={`flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${
            st.auto ? "bg-accent text-bg" : "bg-accent-dim text-fg"
          } disabled:opacity-40`}
        >
          <MousePointerClick className="size-4" />
          {st.auto ? "AUTO ON — clicando" : "Ligar AUTO 24h"}
        </button>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-surface-2 p-3 font-mono text-xs tabular-nums">
          <dt className="text-faint">Cliques</dt>
          <dd>{st.clicks}</dd>
          <dt className="text-faint">Uptime</dt>
          <dd>{fmtUptime(st.uptimeSec)}</dd>
          <dt className="text-faint">Fábricas</dt>
          <dd>{st.factories}</dd>
          <dt className="text-faint">Minas</dt>
          <dd>{st.mines}</dd>
        </dl>

        {st.error ? (
          <p className="rounded-md bg-danger/15 px-3 py-2 text-xs text-danger">{st.error}</p>
        ) : null}
        {msg ? <p className="text-xs text-accent">{msg}</p> : null}

        <p className="break-all font-mono text-xs text-faint">{st.url || "—"}</p>

        <button
          type="button"
          onClick={() =>
            void run(async () => {
              const data = await api("/api/bot/clearlogs");
              setSt({ ...empty, ...data, logs: data.logs ?? [] });
            })
          }
          className="h-9 rounded-md border border-line text-xs font-semibold text-muted"
        >
          Limpar logs
        </button>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto text-xs leading-snug text-faint">
          {st.logs.length === 0 ? (
            <li>Sem atividade ainda.</li>
          ) : (
            st.logs.map((l) => (
              <li key={l.t + l.text}>
                <span className="font-mono text-[10px] text-line">
                  {new Date(l.t).toLocaleTimeString("pt-BR", { hour12: false })}
                </span>{" "}
                <span className={l.text.startsWith("ERRO") ? "text-danger" : l.text.startsWith("OK") ? "text-accent" : ""}>
                  {l.text}
                </span>
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}
