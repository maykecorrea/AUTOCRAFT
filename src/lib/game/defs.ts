import type { FactoryDef, FactoryId, GoalId, ResourceId } from "./types";

export const ENERGY_MAX = 24;
export const ENERGY_REGEN = 0.42;
export const BOOST_DURATION = 22;
export const BOOST_COOLDOWN = 48;
export const SAVE_KEY = "autoilha-save-v1";
export const SAVE_VERSION = 1;
export const ISLAND_H = 1980;

export const RESOURCES: Record<
  ResourceId,
  { label: string; color: string; chip: string }
> = {
  terra: { label: "Terra", color: "#b0793a", chip: "#8b5a2b" },
  lama: { label: "Lama", color: "#6b4a2b", chip: "#5c3d22" },
  argila: { label: "Argila", color: "#c47a48", chip: "#a85d32" },
  tijolo: { label: "Tijolo", color: "#c45c3a", chip: "#a34428" },
  agua: { label: "Água", color: "#3aa0b8", chip: "#2a7a8c" },
  vapor: { label: "Vapor", color: "#7ec8c4", chip: "#4e9a96" },
  cristal: { label: "Cristal", color: "#7ec8a3", chip: "#3d9a72" },
  metal: { label: "Metal", color: "#8a93a0", chip: "#5c6570" },
  parafuso: { label: "Parafuso", color: "#d4b46a", chip: "#b08a3a" },
};

export const FACTORIES: FactoryDef[] = [
  {
    id: "mina",
    name: "Mina de Terra",
    chain: "terra",
    sprite: "/assets/game/mine.png",
    x: 50,
    y: 7.2,
    output: "terra",
    inputs: [],
    baseDuration: 11,
    baseOutput: 14,
    energyCost: 1,
    unlock: null,
    size: "md",
  },
  {
    id: "lama",
    name: "Moinho de Lama",
    chain: "terra",
    sprite: "/assets/game/silo.png",
    x: 47,
    y: 18.4,
    output: "lama",
    inputs: [{ resource: "terra", amount: 2 }],
    baseDuration: 12,
    baseOutput: 8,
    energyCost: 1,
    unlock: null,
    size: "md",
  },
  {
    id: "argila",
    name: "Forno de Argila",
    chain: "terra",
    sprite: "/assets/game/kiln.png",
    x: 53,
    y: 29.6,
    output: "argila",
    inputs: [{ resource: "lama", amount: 2 }],
    baseDuration: 13,
    baseOutput: 6,
    energyCost: 1,
    unlock: null,
    size: "md",
  },
  {
    id: "agua",
    name: "Bomba d'Água",
    chain: "agua",
    sprite: "/assets/game/water.png",
    x: 36,
    y: 42.5,
    output: "agua",
    inputs: [],
    baseDuration: 10,
    baseOutput: 12,
    energyCost: 1,
    unlock: { resource: "lama", amount: 24 },
    size: "lg",
  },
  {
    id: "vapor",
    name: "Caldeira",
    chain: "agua",
    sprite: "/assets/game/water.png",
    x: 64,
    y: 42.5,
    output: "vapor",
    inputs: [{ resource: "agua", amount: 2 }],
    baseDuration: 12,
    baseOutput: 7,
    energyCost: 1,
    unlock: { resource: "lama", amount: 24 },
    size: "lg",
  },
  {
    id: "cristal",
    name: "Cristaleira",
    chain: "agua",
    sprite: "/assets/game/silo.png",
    x: 50,
    y: 53.2,
    output: "cristal",
    inputs: [
      { resource: "vapor", amount: 2 },
      { resource: "lama", amount: 1 },
    ],
    baseDuration: 15,
    baseOutput: 4,
    energyCost: 1,
    unlock: { resource: "lama", amount: 24 },
    size: "md",
  },
  {
    id: "tijolo",
    name: "Olaria",
    chain: "terra",
    sprite: "/assets/game/kiln.png",
    x: 49,
    y: 64.4,
    output: "tijolo",
    inputs: [{ resource: "argila", amount: 2 }],
    baseDuration: 14,
    baseOutput: 5,
    energyCost: 1,
    unlock: null,
    size: "md",
  },
  {
    id: "forja",
    name: "Forja",
    chain: "metal",
    sprite: "/assets/game/forge.png",
    x: 38,
    y: 76.2,
    output: "metal",
    inputs: [
      { resource: "tijolo", amount: 2 },
      { resource: "cristal", amount: 1 },
    ],
    baseDuration: 16,
    baseOutput: 3,
    energyCost: 1,
    unlock: { stars: 7 },
    size: "md",
  },
  {
    id: "parafuso",
    name: "Oficina",
    chain: "metal",
    sprite: "/assets/game/forge.png",
    x: 62,
    y: 76.2,
    output: "parafuso",
    inputs: [{ resource: "metal", amount: 2 }],
    baseDuration: 16,
    baseOutput: 3,
    energyCost: 1,
    unlock: { stars: 11 },
    size: "md",
  },
  {
    id: "deposito",
    name: "Depósito",
    chain: "terra",
    sprite: "/assets/game/warehouse.png",
    x: 50,
    y: 88.4,
    output: null,
    inputs: [],
    baseDuration: 0,
    baseOutput: 0,
    energyCost: 0,
    unlock: null,
    size: "lg",
  },
];

export const FACTORY_MAP: Record<FactoryId, FactoryDef> = Object.fromEntries(
  FACTORIES.map((f) => [f.id, f]),
) as Record<FactoryId, FactoryDef>;

export const PIPES: { from: FactoryId; to: FactoryId }[] = [
  { from: "mina", to: "lama" },
  { from: "lama", to: "argila" },
  { from: "argila", to: "tijolo" },
  { from: "agua", to: "vapor" },
  { from: "vapor", to: "cristal" },
  { from: "agua", to: "cristal" },
  { from: "tijolo", to: "deposito" },
  { from: "cristal", to: "tijolo" },
  { from: "tijolo", to: "forja" },
  { from: "forja", to: "parafuso" },
  { from: "parafuso", to: "deposito" },
];

export const CHAINS: Record<GoalId, FactoryId[]> = {
  tijolo: ["mina", "lama", "argila", "tijolo"],
  cristal: ["mina", "lama", "agua", "vapor", "cristal"],
  parafuso: ["mina", "lama", "argila", "tijolo", "agua", "vapor", "cristal", "forja", "parafuso"],
};

export const RESOURCE_ORDER: ResourceId[] = [
  "terra",
  "lama",
  "argila",
  "tijolo",
  "agua",
  "vapor",
  "cristal",
  "metal",
  "parafuso",
];

export function speedMult(level: number, workers: number, boosted: boolean) {
  return (1 + (level - 1) * 0.08) * (1 + workers * 0.5) * (boosted ? 2 : 1);
}

export function outputAmount(def: FactoryDef, level: number, workers: number, boosted: boolean) {
  return def.baseOutput * (1 + (level - 1) * 0.18) * (1 + workers * 0.25) * (boosted ? 2 : 1);
}

export function cycleDuration(def: FactoryDef, level: number, workers: number, boosted: boolean) {
  return def.baseDuration / speedMult(level, workers, boosted);
}

export function upgradeCost(level: number): { resource: ResourceId; amount: number } {
  const amount = Math.round(12 * Math.pow(1.55, level - 1));
  if (level < 3) return { resource: "terra", amount };
  if (level < 5) return { resource: "lama", amount: Math.round(amount * 0.7) };
  if (level < 8) return { resource: "tijolo", amount: Math.round(amount * 0.45) };
  return { resource: "cristal", amount: Math.round(amount * 0.28) };
}

export function ratePerMin(def: FactoryDef, level: number, workers: number, boosted: boolean) {
  if (!def.output || def.baseDuration <= 0) return 0;
  return (outputAmount(def, level, workers, boosted) / cycleDuration(def, level, workers, boosted)) * 60;
}
