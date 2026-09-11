import { useEffect, useRef } from "react";
import { useGame } from "@/lib/game/store";
import { Dock } from "./Dock";
import { Hud } from "./Hud";
import { Island } from "./Island";
import { StartScreen } from "./StartScreen";
import { Tutorial } from "./Tutorial";

export function Game() {
  const started = useGame((s) => s.started);
  const persist = useGame((s) => s.persist);
  const tick = useGame((s) => s.tick);
  const running = useRef(true);

  useEffect(() => {
    running.current = true;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      acc += dt;
      const step = 1 / 20;
      while (acc >= step) {
        tick(step);
        acc -= step;
      }
    };
    raf = requestAnimationFrame((t) => {
      last = t;
      loop(t);
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persist);
    return () => {
      running.current = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [tick, persist]);

  if (!started) return <StartScreen />;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg text-fg lg:flex-row">
      <div className="pointer-events-none absolute inset-0">
        <img
          src="/assets/game/island-bg.jpg"
          alt=""
          className="h-full w-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-bg/55" />
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
        <Hud />
        <div className="island-scroll mx-auto h-full w-full overflow-y-auto overflow-x-hidden pt-24">
          <Island />
        </div>
        <Tutorial />
      </div>
      <Dock />
    </div>
  );
}
