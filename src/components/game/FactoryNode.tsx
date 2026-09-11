import { FACTORY_MAP, RESOURCES, ratePerMin } from "@/lib/game/defs";
import { useGame } from "@/lib/game/store";
import { formatNum, formatRate } from "@/lib/utils";
import type { FactoryId } from "@/lib/game/types";
import { Lock, Play } from "lucide-react";

const SIZE = { sm: 78, md: 104, lg: 128 };

export function FactoryNode({ id }: { id: FactoryId }) {
  const def = FACTORY_MAP[id];
  const f = useGame((s) => s.factories[id]);
  const selected = useGame((s) => s.selected === id);
  const auto = useGame((s) => s.auto);
  const boosted = useGame((s) => s.simTime < s.boostUntil);
  const pickWorker = useGame((s) => s.pickWorker);
  const select = useGame((s) => s.select);
  const start = useGame((s) => s.start);
  const collect = useGame((s) => s.collect);
  const assign = useGame((s) => s.assign);
  const inventory = useGame((s) => (def.output ? s.resources[def.output] : 0));

  const w = SIZE[def.size];
  const canPlay = f.unlocked && !f.running && !!def.output;
  const progress = f.running && f.cycle > 0 ? 1 - f.remaining / f.cycle : 0;
  const rate = def.output ? ratePerMin(def, f.level, f.workers, boosted) : 0;
  const shown = Math.floor(f.buffer) > 0 ? Math.floor(f.buffer) : Math.floor(inventory);

  const onClick = () => {
    if (pickWorker !== null && f.unlocked && def.output) {
      assign(pickWorker, id);
      return;
    }
    select(id);
  };

  return (
    <div
      className="absolute z-10"
      style={{
        left: `${def.x}%`,
        top: `${def.y}%`,
        transform: "translate(-50%, -50%)",
        width: w,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`relative block w-full ${selected ? "brightness-110" : ""}`}
        aria-label={def.name}
      >
        {!f.unlocked ? (
          <img
            src="/assets/game/chest.png"
            alt=""
            className="mx-auto h-auto w-[72%] opacity-90 drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]"
            draggable={false}
          />
        ) : (
          <img
            src={def.sprite}
            alt=""
            className="mx-auto h-auto w-full drop-shadow-[0_8px_12px_rgba(0,0,0,0.5)]"
            draggable={false}
          />
        )}
        {selected ? (
          <span className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-accent" />
        ) : null}
      </button>

      {f.unlocked && def.output ? (
        <button
          type="button"
          onClick={() => collect(id)}
          className="absolute -top-1 left-1/2 z-20 -translate-x-1/2 rounded-md bg-bg/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-fg ring-1 ring-white/10"
        >
          {formatNum(shown)}
        </button>
      ) : null}

      {canPlay ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            start(id);
          }}
          className={`play-btn absolute -left-1 bottom-3 z-20 flex size-8 items-center justify-center rounded-full bg-accent text-bg shadow-md ${auto ? "opacity-90" : ""}`}
          aria-label={`Ligar ${def.name}`}
        >
          <Play className="size-3.5 fill-current" />
        </button>
      ) : null}

      {f.running ? (
        <div className="absolute bottom-1 left-1/2 z-20 h-1 w-14 -translate-x-1/2 overflow-hidden rounded-full bg-bg/70">
          <div
            className="h-full bg-accent"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      ) : null}

      {!f.unlocked ? (
        <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-bg/80 px-2 py-0.5 text-[10px] text-muted">
          <Lock className="size-2.5" />
          {def.unlock?.stars ? `${def.unlock.stars}` : def.unlock?.amount}
        </div>
      ) : null}

      {f.unlocked && f.workers > 0 ? (
        <div className="absolute -right-1 top-4 z-20 flex items-center">
          {Array.from({ length: f.workers }).map((_, i) => (
            <img
              key={i}
              src="/assets/game/robot.png"
              alt=""
              className="-ml-2 h-7 w-auto drop-shadow"
              style={{ zIndex: 5 - i }}
            />
          ))}
        </div>
      ) : null}

      {f.unlocked && def.output && f.running && rate > 0.2 ? (
        <div className="pointer-events-none absolute -right-[4.6rem] top-1 hidden rounded-md bg-bg/70 px-1.5 py-1 sm:block">
          <p className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted">
            <span
              className="size-1.5 rounded-full"
              style={{ background: RESOURCES[def.output].color }}
            />
            {formatRate(rate)}/min
          </p>
        </div>
      ) : null}
    </div>
  );
}
