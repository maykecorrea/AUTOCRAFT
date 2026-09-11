import { RESOURCES, RESOURCE_ORDER, ENERGY_MAX } from "@/lib/game/defs";
import { useGame } from "@/lib/game/store";
import { formatNum } from "@/lib/utils";
import { Battery, Star, Zap } from "lucide-react";

export function Hud() {
  const resources = useGame((s) => s.resources);
  const energy = useGame((s) => s.energy);
  const energyMax = useGame((s) => s.energyMax);
  const stars = useGame((s) => s.stars);
  const auto = useGame((s) => s.auto);
  const clicksSaved = useGame((s) => s.clicksSaved);
  const boosted = useGame((s) => s.simTime < s.boostUntil);
  const toggleAuto = useGame((s) => s.toggleAuto);

  const pct = Math.max(0, Math.min(100, (energy / energyMax) * 100));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-3 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="hud-chip flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-full px-2.5 py-1.5">
          {RESOURCE_ORDER.map((id) => {
            const n = resources[id];
            if (n <= 0 && id !== "terra") return null;
            const r = RESOURCES[id];
            return (
              <span key={id} className="flex shrink-0 items-center gap-1.5 pr-1">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: r.color }}
                  aria-hidden
                />
                <span className="font-mono text-[11px] font-semibold tabular-nums text-fg">
                  {formatNum(n)}
                </span>
              </span>
            );
          })}
        </div>
        <div className="hud-chip flex items-center gap-1 rounded-full px-2.5 py-1.5">
          <Star className="size-3.5 text-warn" />
          <span className="font-mono text-[11px] font-semibold tabular-nums">{stars}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hud-chip pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1.5">
          <Battery className="size-3.5 text-accent" />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {Math.floor(energy)}/{ENERGY_MAX}
          </span>
        </div>
        {boosted ? (
          <div className="hud-chip pointer-events-auto flex items-center gap-1 rounded-full px-2.5 py-1.5 text-warn">
            <Zap className="size-3.5" />
            <span className="text-[11px] font-semibold">x2</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={toggleAuto}
          className={`pointer-events-auto flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold tracking-wide transition-colors duration-200 ${
            auto ? "bg-accent text-bg" : "bg-fg text-bg"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${auto ? "bg-bg" : "bg-accent"}`}
            aria-hidden
          />
          {auto ? "AUTO ON" : "AUTO"}
        </button>
      </div>

      {auto && clicksSaved > 0 ? (
        <p className="px-1 text-[11px] text-accent">
          {clicksSaved} clique{clicksSaved === 1 ? "" : "s"} poupado{clicksSaved === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
