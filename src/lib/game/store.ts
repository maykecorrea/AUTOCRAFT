import { create } from "zustand";
import { SAVE_KEY, SAVE_VERSION } from "./defs";
import {
  activateBoost,
  assignWorker,
  canStart,
  collectFactory,
  createInitial,
  startFactory,
  tick,
  tryUpgrade,
  type TickFx,
} from "./sim";
import type {
  FactoryId,
  FactoryState,
  FloatText,
  AutoLog,
  GameSnapshot,
  GoalId,
} from "./types";

type GameStore = GameSnapshot & {
  selected: FactoryId | null;
  floats: FloatText[];
  logs: AutoLog[];
  pickWorker: number | null;
  tick: (dt: number) => void;
  start: (id: FactoryId) => void;
  collect: (id: FactoryId) => void;
  upgrade: (id: FactoryId) => void;
  select: (id: FactoryId | null) => void;
  toggleAuto: () => void;
  toggleAutoUpgrade: () => void;
  setGoal: (g: GoalId) => void;
  boost: () => void;
  assign: (workerId: number, factoryId: FactoryId | null) => void;
  setPickWorker: (id: number | null) => void;
  begin: () => void;
  reset: () => void;
  persist: () => void;
};

function cloneInitial(): GameSnapshot {
  return structuredClone(createInitial());
}

function cloneFactories(src: Record<FactoryId, FactoryState>): Record<FactoryId, FactoryState> {
  const out = {} as Record<FactoryId, FactoryState>;
  for (const id of Object.keys(src) as FactoryId[]) {
    out[id] = { ...src[id] };
  }
  return out;
}

function loadSaved(): GameSnapshot {
  if (typeof window === "undefined") return cloneInitial();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return cloneInitial();
    const parsed = JSON.parse(raw) as GameSnapshot;
    if (!parsed || parsed.version !== SAVE_VERSION) return cloneInitial();
    const base = cloneInitial();
    return {
      ...base,
      ...parsed,
      resources: { ...base.resources, ...parsed.resources },
      factories: { ...base.factories, ...parsed.factories },
      workers: parsed.workers?.length === 4 ? parsed.workers : base.workers,
    };
  } catch {
    return cloneInitial();
  }
}

let floatSeq = 1;
let logSeq = 1;
let lastSave = 0;

export const useGame = create<GameStore>((set, get) => ({
  ...loadSaved(),
  selected: null,
  floats: [],
  logs: [],
  pickWorker: null,

  tick: (dt) => {
    const fx: TickFx = { floats: [], logs: [] };
    set((prev) => {
      if (!prev.started) return prev;
      tick(prev, dt, fx);
      const now = prev.simTime;
      const floats = [
        ...prev.floats.filter((f) => now - f.born < 1.4),
        ...fx.floats.map((f) => ({ ...f, id: floatSeq++ })),
      ].slice(-24);
      const logs = [
        ...fx.logs.map((l) => ({ ...l, id: logSeq++ })),
        ...prev.logs,
      ].slice(0, 18);
      return {
        energy: prev.energy,
        simTime: prev.simTime,
        stars: prev.stars,
        clicksSaved: prev.clicksSaved,
        cycles: prev.cycles,
        boostUntil: prev.boostUntil,
        boostCd: prev.boostCd,
        tutorial: prev.tutorial,
        resources: { ...prev.resources },
        factories: cloneFactories(prev.factories),
        workers: prev.workers.map((w) => ({ ...w })),
        floats,
        logs,
      };
    });
    const t = get().simTime;
    if (t - lastSave > 4) {
      lastSave = t;
      get().persist();
    }
  },

  start: (id) => {
    const fx: TickFx = { floats: [], logs: [] };
    set((prev) => {
      startFactory(prev, id, false, fx);
      return {
        energy: prev.energy,
        factories: cloneFactories(prev.factories),
        resources: { ...prev.resources },
        clicksSaved: prev.clicksSaved,
        tutorial: prev.tutorial,
        logs: [...fx.logs.map((l) => ({ ...l, id: logSeq++ })), ...prev.logs].slice(0, 18),
      };
    });
  },

  collect: (id) => {
    const fx: TickFx = { floats: [], logs: [] };
    set((prev) => {
      collectFactory(prev, id, fx);
      return {
        resources: { ...prev.resources },
        factories: cloneFactories(prev.factories),
        tutorial: prev.tutorial,
        floats: [
          ...prev.floats,
          ...fx.floats.map((f) => ({ ...f, id: floatSeq++ })),
        ].slice(-24),
      };
    });
  },

  upgrade: (id) => {
    const fx: TickFx = { floats: [], logs: [] };
    set((prev) => {
      tryUpgrade(prev, id, fx);
      return {
        resources: { ...prev.resources },
        factories: cloneFactories(prev.factories),
        logs: [...fx.logs.map((l) => ({ ...l, id: logSeq++ })), ...prev.logs].slice(0, 18),
      };
    });
  },

  select: (id) => set({ selected: id, pickWorker: null }),

  toggleAuto: () =>
    set((s) => {
      const auto = !s.auto;
      let tutorial = s.tutorial;
      if (auto && tutorial < 4) tutorial = 4;
      return { auto, tutorial };
    }),

  toggleAutoUpgrade: () => set((s) => ({ autoUpgrade: !s.autoUpgrade })),

  setGoal: (goal) => set({ goal }),

  boost: () => {
    const fx: TickFx = { floats: [], logs: [] };
    set((prev) => {
      activateBoost(prev, fx);
      return {
        boostUntil: prev.boostUntil,
        boostCd: prev.boostCd,
        logs: [...fx.logs.map((l) => ({ ...l, id: logSeq++ })), ...prev.logs].slice(0, 18),
      };
    });
  },

  assign: (workerId, factoryId) =>
    set((s) => {
      assignWorker(s, workerId, factoryId);
      return {
        workers: s.workers.map((w) => ({ ...w })),
        factories: cloneFactories(s.factories),
        pickWorker: null,
      };
    }),

  setPickWorker: (id) => set({ pickWorker: id }),

  begin: () =>
    set((s) => ({
      started: true,
      tutorial: s.tutorial === 0 ? 1 : s.tutorial,
    })),

  reset: () => {
    if (typeof window !== "undefined") localStorage.removeItem(SAVE_KEY);
    const fresh = cloneInitial();
    set({
      ...fresh,
      selected: null,
      floats: [],
      logs: [],
      pickWorker: null,
      started: true,
      tutorial: 1,
    });
  },

  persist: () => {
    if (typeof window === "undefined") return;
    const s = get();
    const snap: GameSnapshot = {
      version: SAVE_VERSION,
      resources: s.resources,
      factories: s.factories,
      workers: s.workers,
      energy: s.energy,
      energyMax: s.energyMax,
      auto: s.auto,
      autoUpgrade: s.autoUpgrade,
      goal: s.goal,
      boostUntil: s.boostUntil,
      boostCd: s.boostCd,
      simTime: s.simTime,
      stars: s.stars,
      clicksSaved: s.clicksSaved,
      cycles: s.cycles,
      tutorial: s.tutorial,
      started: s.started,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
    } catch {
      /* ignore quota */
    }
  },
}));

export function canStartNow(id: FactoryId) {
  return canStart(useGame.getState(), id);
}
