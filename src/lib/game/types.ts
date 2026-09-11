export type ResourceId =
  | "terra"
  | "lama"
  | "argila"
  | "tijolo"
  | "agua"
  | "vapor"
  | "cristal"
  | "metal"
  | "parafuso";

export type GoalId = "tijolo" | "cristal" | "parafuso";

export type FactoryId =
  | "mina"
  | "lama"
  | "argila"
  | "tijolo"
  | "agua"
  | "vapor"
  | "cristal"
  | "forja"
  | "parafuso"
  | "deposito";

export type RecipeInput = { resource: ResourceId; amount: number };

export type FactoryDef = {
  id: FactoryId;
  name: string;
  chain: "terra" | "agua" | "metal";
  sprite: string;
  x: number;
  y: number;
  output: ResourceId | null;
  inputs: RecipeInput[];
  baseDuration: number;
  baseOutput: number;
  energyCost: number;
  unlock: { resource?: ResourceId; amount?: number; stars?: number } | null;
  size: "sm" | "md" | "lg";
};

export type FactoryState = {
  id: FactoryId;
  level: number;
  running: boolean;
  remaining: number;
  cycle: number;
  pending: number;
  buffer: number;
  workers: number;
  unlocked: boolean;
  lastPulse: number;
};

export type Worker = {
  id: number;
  factoryId: FactoryId | null;
};

export type FloatText = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
};

export type AutoLog = {
  id: number;
  t: number;
  text: string;
};

export type GameSnapshot = {
  version: number;
  resources: Record<ResourceId, number>;
  factories: Record<FactoryId, FactoryState>;
  workers: Worker[];
  energy: number;
  energyMax: number;
  auto: boolean;
  autoUpgrade: boolean;
  goal: GoalId;
  boostUntil: number;
  boostCd: number;
  simTime: number;
  stars: number;
  clicksSaved: number;
  cycles: number;
  tutorial: number;
  started: boolean;
};
