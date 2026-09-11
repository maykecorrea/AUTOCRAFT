import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Math.floor(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(2).replace(/\.?0+$/, "")}k`;
  return String(v);
}

export function formatRate(n: number): string {
  if (n < 0.1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return String(Math.round(n));
}
