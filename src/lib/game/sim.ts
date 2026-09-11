import {
  CHAINS,
  ENERGY_MAX,
  ENERGY_REGEN,
  FACTORIES,
  FACTORY_MAP,
  cycleDuration,
  outputAmount,
  upgradeCost,
} from "./defs";
import type {
  AutoLog,
  FactoryId,
  FactoryState,
  FloatText,
  GameSnapshot,
  ResourceId,
} from "./types";

export function emptyResources(): Record<ResourceId, number> {
  return {
    terra: 8,
    lama: 0,
    argila: 0,
    tijolo: 0,
    agua: 0,
    vapor: 0,
    cristal: 0,
    metal: 0,
    parafuso: 0,
  };
}

export function initialFactories(): Record<FactoryId, FactoryState> {
  const out = {} as Record<FactoryId, FactoryState>;
  for (const def of FACTORIES) {
    out[def.id] = {
      id: def.id,
      level: 1,
      running: false,
      remaining: 0,
      cycle: 0,
      pending: 0,
      buffer: 0,
      workers: 0,
      unlocked: def.unlock === null,
      lastPulse: 0,
    };
  }
  return out;
}

export function createInitial(): GameSnapshot {
  return {
    version: 1,
    resources: emptyResources(),
    factories: initialFactories(),
    workers: [
      { id: 0, factoryId: null },
      { id: 1, factoryId: null },
      { id: 2, factoryId: null },
      { id: 3, factoryId: null },
    ],
    energy: ENERGY_MAX,
    energyMax: ENERGY_MAX,
    auto: false,
    autoUpgrade: false,
    goal: "tijolo",
    boostUntil: 0,
    boostCd: 0,
    simTime: 0,
    stars: 0,
    clicksSaved: 0,
    cycles: 0,
    tutorial: 0,
    started: false,
  };
}

export type TickFx = {
  floats: FloatText[];
  logs: AutoLog[];
};

function hasInputs(
  s: GameSnapshot,
  id: FactoryId,
  batch: number,
): boolean {
  const def = FACTORY_MAP[id];
  if (!def.output) return false;
  for (const inp of def.inputs) {
    if (s.resources[inp.resource] < inp.amount * batch) return false;
  }
  return true;
}

function consumeInputs(s: GameSnapshot, id: FactoryId, batch: number) {
  const def = FACTORY_MAP[id];
  for (const inp of def.inputs) {
    s.resources[inp.resource] -= inp.amount * batch;
  }
}

export function canStart(s: GameSnapshot, id: FactoryId): boolean {
  const def = FACTORY_MAP[id];
  const f = s.factories[id];
  if (!def.output || !f.unlocked || f.running) return false;
  if (s.energy < def.energyCost) return false;
  const boosted = s.simTime < s.boostUntil;
  const batch = outputAmount(def, f.level, f.workers, boosted);
  if (def.inputs.length === 0) return true;
  return hasInputs(s, id, 1) && s.resources[def.inputs[0].resource] >= def.inputs[0].amount * Math.max(1, batch / def.baseOutput);
}

function inputScale(s: GameSnapshot, id: FactoryId, batch: number): number {
  const def = FACTORY_MAP[id];
  if (def.inputs.length === 0) return batch;
  let scale = batch;
  for (const inp of def.inputs) {
    const need = inp.amount;
    const have = s.resources[inp.resource];
    const maxBatch = have / need;
    scale = Math.min(scale, maxBatch);
  }
  return Math.max(0, scale);
}

export function startFactory(
  s: GameSnapshot,
  id: FactoryId,
  auto: boolean,
  fx: TickFx,
): boolean {
  const def = FACTORY_MAP[id];
  const f = s.factories[id];
  if (!def.output || !f.unlocked || f.running) return false;
  if (s.energy < def.energyCost) return false;
  const boosted = s.simTime < s.boostUntil;
  const full = outputAmount(def, f.level, f.workers, boosted);
  const batch = inputScale(s, id, full);
  if (batch < 0.5) return false;
  consumeInputs(s, id, batch);
  s.energy -= def.energyCost;
  f.running = true;
  f.cycle = cycleDuration(def, f.level, f.workers, boosted);
  f.remaining = f.cycle;
  f.pending = batch;
  f.lastPulse = s.simTime;
  if (auto) s.clicksSaved += 1;
  fx.logs.push({
    id: Math.random(),
    t: s.simTime,
    text: auto
      ? `Auto ligou ${def.name}`
      : `Ligou ${def.name}`,
  });
  if (s.tutorial === 1 && id === "mina") s.tutorial = 2;
  return true;
}

export function collectFactory(s: GameSnapshot, id: FactoryId, fx: TickFx): number {
  const def = FACTORY_MAP[id];
  const f = s.factories[id];
  if (!def.output || f.buffer <= 0) return 0;
  const amt = f.buffer;
  if (amt < 1) return 0;
  const give = Math.floor(amt);
  s.resources[def.output] += give;
  f.buffer = amt - give;
  fx.floats.push({
    id: Math.random(),
    x: def.x,
    y: def.y,
    text: `+${give}`,
    color: "#f2ead8",
    born: s.simTime,
  });
  if (s.tutorial === 2 && id === "mina") s.tutorial = 3;
  return amt;
}

export function assignWorker(s: GameSnapshot, workerId: number, factoryId: FactoryId | null) {
  const w = s.workers[workerId];
  if (!w) return;
  if (w.factoryId) s.factories[w.factoryId].workers = Math.max(0, s.factories[w.factoryId].workers - 1);
  w.factoryId = factoryId;
  if (factoryId) s.factories[factoryId].workers += 1;
}

function tryUnlocks(s: GameSnapshot, fx: TickFx) {
  for (const def of FACTORIES) {
    const f = s.factories[def.id];
    if (f.unlocked || !def.unlock) continue;
    const u = def.unlock;
    let ok = true;
    if (u.resource && (s.resources[u.resource] ?? 0) < (u.amount ?? 0)) ok = false;
    if (u.stars && s.stars < u.stars) ok = false;
    if (ok) {
      f.unlocked = true;
      fx.logs.push({ id: Math.random(), t: s.simTime, text: `Desbloqueou ${def.name}` });
    }
  }
}

function rebalanceWorkers(s: GameSnapshot) {
  if (!s.auto) return;
  const chain = CHAINS[s.goal].filter((id) => s.factories[id].unlocked && FACTORY_MAP[id].output);
  if (chain.length === 0) return;
  for (let i = 0; i < s.workers.length; i++) {
    if (s.workers[i].factoryId) {
      s.factories[s.workers[i].factoryId!].workers = 0;
    }
  }
  const targets = chain.slice().reverse();
  for (let i = 0; i < s.workers.length; i++) {
    const id = targets[i % targets.length];
    s.workers[i].factoryId = id;
  }
  for (const w of s.workers) {
    if (w.factoryId) s.factories[w.factoryId].workers += 1;
  }
}

function autoUpgrade(s: GameSnapshot, fx: TickFx) {
  if (!s.autoUpgrade) return;
  const chain = CHAINS[s.goal];
  for (const id of chain) {
    const f = s.factories[id];
    if (!f.unlocked || f.level >= 12) continue;
    const cost = upgradeCost(f.level);
    if (s.resources[cost.resource] >= cost.amount) {
      s.resources[cost.resource] -= cost.amount;
      f.level += 1;
      s.clicksSaved += 1;
      fx.logs.push({ id: Math.random(), t: s.simTime, text: `Auto melhorou ${FACTORY_MAP[id].name} Nv.${f.level}` });
      return;
    }
  }
}

function autoStart(s: GameSnapshot, fx: TickFx) {
  if (!s.auto) return;
  const goalChain = CHAINS[s.goal];
  const rest = FACTORIES.map((d) => d.id).filter((id) => !goalChain.includes(id));
  const order = [...goalChain, ...rest];
  for (const id of order) {
    const def = FACTORY_MAP[id];
    if (!def.output) continue;
    const f = s.factories[id];
    if (!f.unlocked || f.running) continue;
    const reserve = goalChain.includes(id) ? 0 : 6;
    if (s.energy < def.energyCost + reserve) continue;
    startFactory(s, id, true, fx);
  }
}

export function tryUpgrade(s: GameSnapshot, id: FactoryId, fx: TickFx): boolean {
  const f = s.factories[id];
  if (!f.unlocked || f.level >= 12) return false;
  const cost = upgradeCost(f.level);
  if (s.resources[cost.resource] < cost.amount) return false;
  s.resources[cost.resource] -= cost.amount;
  f.level += 1;
  fx.logs.push({ id: Math.random(), t: s.simTime, text: `Melhorou ${FACTORY_MAP[id].name} Nv.${f.level}` });
  return true;
}

export function activateBoost(s: GameSnapshot, fx: TickFx): boolean {
  if (s.boostCd > 0) return false;
  s.boostUntil = s.simTime + 22;
  s.boostCd = 48;
  fx.logs.push({ id: Math.random(), t: s.simTime, text: "Boost x2 ligado" });
  return true;
}

export function tick(s: GameSnapshot, dt: number, fx: TickFx) {
  s.simTime += dt;
  s.energy = Math.min(s.energyMax, s.energy + ENERGY_REGEN * dt);
  if (s.boostCd > 0) s.boostCd = Math.max(0, s.boostCd - dt);

  for (const def of FACTORIES) {
    const f = s.factories[def.id];
    if (!f.running || !def.output) continue;
    const prev = f.remaining;
    f.remaining -= dt;
    const total = Math.max(0.001, f.cycle);
    const produced = f.pending * (Math.min(prev, total) - Math.max(f.remaining, 0)) / total;
    if (produced > 0) {
      f.buffer += produced;
    }
    if (f.remaining <= 0) {
      f.running = false;
      f.remaining = 0;
      f.pending = 0;
      s.cycles += 1;
      if (def.output === "tijolo" || def.output === "cristal" || def.output === "parafuso" || def.output === "metal") {
        s.stars += 1;
      }
    }
  }

  if (s.auto) {
    for (const def of FACTORIES) {
      if (s.factories[def.id].buffer >= 1) collectFactory(s, def.id, fx);
    }
    autoStart(s, fx);
    if (Math.floor(s.simTime) !== Math.floor(s.simTime - dt)) {
      rebalanceWorkers(s);
      autoUpgrade(s, fx);
    }
  }

  tryUnlocks(s, fx);
}
