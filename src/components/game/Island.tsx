import { useEffect, useRef, useState } from "react";
import { FACTORIES, ISLAND_H } from "@/lib/game/defs";
import { useGame } from "@/lib/game/store";
import { FactoryNode } from "./FactoryNode";
import { Pipes } from "./Pipes";

export function Island() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(420);
  const floats = useGame((s) => s.floats);
  const simTime = useGame((s) => s.simTime);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-[440px]"
      style={{ height: ISLAND_H }}
    >
      <img
        src="/assets/game/island-bg.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ imageRendering: "auto" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/40" />
      <Pipes width={w} />
      {FACTORIES.map((f) => (
        <FactoryNode key={f.id} id={f.id} />
      ))}
      {floats.map((f) => {
        const age = simTime - f.born;
        return (
          <span
            key={f.id}
            className="pointer-events-none absolute z-30 font-mono text-xs font-semibold tabular-nums text-fg"
            style={{
              left: `${f.x}%`,
              top: `${f.y}%`,
              animation: "float-up 1.2s ease-out forwards",
              opacity: Math.max(0, 1 - age / 1.4),
            }}
          >
            {f.text}
          </span>
        );
      })}
    </div>
  );
}
