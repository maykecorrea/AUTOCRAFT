import { useGame } from "@/lib/game/store";
import { Play, RotateCcw } from "lucide-react";

export function StartScreen() {
  const begin = useGame((s) => s.begin);
  const reset = useGame((s) => s.reset);
  const hasSave = useGame((s) => s.cycles > 0 || s.clicksSaved > 0);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-end overflow-hidden bg-bg text-fg">
      <img
        src="/assets/game/island-bg.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/20" />
      <div className="pointer-events-none absolute left-1/2 top-[20%] -translate-x-1/2">
        <img
          src="/assets/game/robot.png"
          alt=""
          className="w-28 drop-shadow-lg sm:w-36"
          style={{ animation: "bob 2.4s ease-in-out infinite" }}
        />
      </div>
      <div className="relative z-10 flex w-full max-w-md flex-col gap-5 px-6 pb-12 pt-8">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-accent">Ilha de produção</p>
        <h1 className="pixel-title text-5xl leading-none text-fg sm:text-6xl">AutoIlha</h1>
        <p className="max-w-[34ch] text-[15px] leading-relaxed text-muted">
          Fábricas param. Energia acaba. O piloto automático liga, coleta e equilibra a cadeia sozinho.
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={begin}
            className="flex h-12 items-center justify-center gap-2 rounded-[18px] bg-fg px-5 text-[15px] font-semibold text-bg transition-transform duration-150 hover:brightness-105 active:scale-[0.98]"
          >
            <Play className="size-4 fill-current" />
            {hasSave ? "Continuar" : "Ligar fábricas"}
          </button>
          {hasSave ? (
            <button
              type="button"
              onClick={reset}
              className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-line bg-surface px-5 text-sm font-medium text-muted transition-colors hover:text-fg"
            >
              <RotateCcw className="size-3.5" />
              Nova ilha
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
