import { getBot } from "./engine";

const bot = getBot();
if (!bot.authHeader) {
  console.error("Clique24: falta data/session-token.json");
  process.exit(1);
}
bot.startAuto();
console.log(
  `Clique24 AUTO ligado · ciclos ${bot.cycles} · token ok`,
);

setInterval(() => {
  const s = bot.status();
  const err = s.error ? ` · ${s.error}` : "";
  console.log(
    `${new Date().toISOString()} · ciclo ${s.cycles} · energia ${s.energy}/${s.energyMax} · auto ${s.auto}${err}`,
  );
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    bot.stopAuto();
    bot.persistLedger();
    process.exit(0);
  });
}
