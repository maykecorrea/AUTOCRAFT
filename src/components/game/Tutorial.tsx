import { useGame } from "@/lib/game/store";

const COPY = [
  "",
  "Toque no play verde da Mina para começar a extrair.",
  "Toque no número em cima da mina para recolher a terra.",
  "Ligue o AUTO no topo — o piloto aperta os botões por você.",
];

export function Tutorial() {
  const step = useGame((s) => s.tutorial);
  if (step < 1 || step > 3) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4 lg:bottom-8">
      <div className="pointer-events-auto max-w-sm rounded-[16px] bg-fg px-4 py-3 text-[13px] font-medium leading-snug text-bg shadow-lg">
        {COPY[step]}
      </div>
    </div>
  );
}
