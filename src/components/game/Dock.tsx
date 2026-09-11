import { CHAINS, FACTORY_MAP, RESOURCES, ratePerMin, upgradeCost } from "@/lib/game/defs";
import { useGame } from "@/lib/game/store";
import { formatNum, formatRate } from "@/lib/utils";
import type { GoalId } from "@/lib/game/types";
import { ArrowUp, Bot, Target, UserRound, Zap } from "lucide-react";

const GOALS: { id: GoalId; label: string }[] = [
  { id: "tijolo", label: "Tijolo" },
  { id: "cristal", label: "Cristal" },
  { id: "parafuso", label: "Parafuso" },
];

export function Dock() {
  const selected = useGame((s) => s.selected);
  const def = selected ? FACTORY_MAP[selected] : null;
  const f = useGame((s) => (selected ? s.factories[selected] : null));
  const auto = useGame((s) => s.auto);
  const autoUpgrade = useGame((s) => s.autoUpgrade);
  const goal = useGame((s) => s.goal);
  const workers = useGame((s) => s.workers);
  const pickWorker = useGame((s) => s.pickWorker);
  const boostCd = useGame((s) => s.boostCd);
  const boosted = useGame((s) => s.simTime < s.boostUntil);
  const resources = useGame((s) => s.resources);
  const logs = useGame((s) => s.logs);
  const start = useGame((s) => s.start);
  const upgrade = useGame((s) => s.upgrade);
  const boost = useGame((s) => s.boost);
  const setGoal = useGame((s) => s.setGoal);
  const toggleAutoUpgrade = useGame((s) => s.toggleAutoUpgrade);
  const setPickWorker = useGame((s) => s.setPickWorker);
  const assign = useGame((s) => s.assign);

  const cost = f ? upgradeCost(f.level) : null;
  const canUp = f && cost ? resources[cost.resource] >= cost.amount && f.level < 12 : false;
  const rate =
    def && f && def.output ? ratePerMin(def, f.level, f.workers, boosted) : 0;

  return (
    <aside className="relative z-20 flex max-h-[42vh] w-full flex-col gap-2 overflow-y-auto border-t border-line bg-surface/95 p-3 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-md lg:h-full lg:max-h-none lg:w-[320px] lg:gap-3 lg:border-l lg:border-t-0 lg:pb-4">
      <section className="rounded-[18px] bg-surface-2 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
          <Target className="size-3.5" />
          Meta da cadeia
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGoal(g.id)}
              className={`h-9 rounded-[10px] text-[12px] font-medium ${
                goal === g.id ? "bg-fg text-bg" : "bg-bg/40 text-muted"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-faint">
          O auto prioriza {GOALS.find((g) => g.id === goal)?.label} e alimenta {CHAINS[goal].length} fábricas.
        </p>
      </section>

      <section className="rounded-[18px] bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
            <UserRound className="size-3.5" />
            Operários
          </span>
          <span className="text-[11px] text-muted">toque e depois a fábrica</span>
        </div>
        <div className="flex gap-2">
          {workers.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                if (pickWorker === w.id) {
                  assign(w.id, null);
                  setPickWorker(null);
                } else {
                  setPickWorker(w.id);
                }
              }}
              className={`flex h-12 flex-1 flex-col items-center justify-center rounded-[12px] ${
                pickWorker === w.id ? "bg-accent text-bg" : "bg-bg/40 text-fg"
              }`}
            >
              <img src="/assets/game/robot.png" alt="" className="h-6 w-auto" />
              <span className="text-[9px] opacity-80">
                {w.factoryId ? FACTORY_MAP[w.factoryId].name.split(" ")[0] : "livre"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {def && f ? (
        <section className="rounded-[18px] bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold leading-tight">{def.name}</h2>
              <p className="text-[12px] text-muted">
                Nv.{f.level}
                {def.output ? ` · ${formatRate(rate)}/min` : " · só armazena"}
              </p>
            </div>
            {def.output ? (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: RESOURCES[def.output].chip,
                  color: "#f2ead8",
                }}
              >
                {RESOURCES[def.output].label}
              </span>
            ) : null}
          </div>
          {def.inputs.length > 0 ? (
            <p className="mt-2 text-[12px] text-muted">
              Consome{" "}
              {def.inputs
                .map((i) => `${i.amount} ${RESOURCES[i.resource].label}`)
                .join(" + ")}
            </p>
          ) : def.output ? (
            <p className="mt-2 text-[12px] text-muted">Extrai direto da ilha</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            {def.output && f.unlocked ? (
              <button
                type="button"
                disabled={f.running}
                onClick={() => start(def.id)}
                className="h-10 flex-1 rounded-[12px] bg-accent text-[13px] font-semibold text-bg disabled:opacity-40"
              >
                {f.running ? `Produzindo ${Math.ceil(f.remaining)}s` : "Ligar"}
              </button>
            ) : null}
            {f.unlocked && cost ? (
              <button
                type="button"
                disabled={!canUp}
                onClick={() => upgrade(def.id)}
                className="flex h-10 flex-1 items-center justify-center gap-1 rounded-[12px] bg-fg text-[13px] font-semibold text-bg disabled:opacity-40"
              >
                <ArrowUp className="size-3.5" />
                {formatNum(cost.amount)} {RESOURCES[cost.resource].label}
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="rounded-[18px] bg-surface-2 p-3 text-[13px] text-muted">
          Toque numa fábrica para melhorar, ligar ou ver a receita.
        </section>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={boost}
          disabled={boostCd > 0}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-line bg-bg/30 text-[12px] font-semibold text-fg disabled:opacity-40"
        >
          <Zap className="size-3.5 text-warn" />
          {boosted ? "x2 ativo" : boostCd > 0 ? `${Math.ceil(boostCd)}s` : "Boost x2"}
        </button>
        <button
          type="button"
          onClick={toggleAutoUpgrade}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-[12px] font-semibold ${
            autoUpgrade ? "bg-accent text-bg" : "border border-line bg-bg/30 text-fg"
          }`}
        >
          <Bot className="size-3.5" />
          Auto Nv.
        </button>
      </div>

      {auto && logs.length > 0 ? (
        <ul className="hidden max-h-28 space-y-1 overflow-hidden lg:block">
          {logs.slice(0, 5).map((l) => (
            <li key={l.id} className="truncate text-[11px] text-faint">
              {l.text}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
