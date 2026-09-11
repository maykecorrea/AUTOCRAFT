import { FACTORY_MAP, ISLAND_H, PIPES } from "@/lib/game/defs";
import { useGame } from "@/lib/game/store";

export function Pipes({ width }: { width: number }) {
  const factories = useGame((s) => s.factories);
  const h = ISLAND_H;
  const w = width || 420;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[1]"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      aria-hidden
    >
      {PIPES.map((p) => {
        const a = FACTORY_MAP[p.from];
        const b = FACTORY_MAP[p.to];
        const x1 = (a.x / 100) * w;
        const y1 = (a.y / 100) * h;
        const x2 = (b.x / 100) * w;
        const y2 = (b.y / 100) * h;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const flowing =
          factories[p.from].running || factories[p.from].unlocked && factories[p.to].unlocked;
        const d = `M ${x1} ${y1} Q ${cx + (x1 - x2) * 0.08} ${cy} ${x2} ${y2}`;
        return (
          <g key={`${p.from}-${p.to}`}>
            <path
              d={d}
              fill="none"
              stroke="#3a3348"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <path
              d={d}
              fill="none"
              stroke="#8b7aa8"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d={d}
              fill="none"
              stroke={flowing ? "#c4b8dc" : "#6d6280"}
              strokeWidth="3"
              strokeLinecap="round"
              className={factories[p.from].running ? "pipe-flow" : undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}
