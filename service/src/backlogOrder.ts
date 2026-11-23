// Ordre du Backlog d'un projet (P7 de docs/parcours.md) : `.spawn/backlog-order.json`, les noms de stories du premier au
// dernier. Une story absente de la liste passe après les autres. Lu par la file d'attente (docs/reglages.md §3.2).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const orderPath = (root: string) => join(root, ".spawn", "backlog-order.json");

export function readBacklogOrder(root: string): string[] {
  const path = orderPath(root);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function writeBacklogOrder(root: string, stories: readonly string[]): void {
  mkdirSync(dirname(orderPath(root)), { recursive: true });
  writeFileSync(orderPath(root), JSON.stringify([...new Set(stories)], null, 2) + "\n");
}

// Rang d'une story dans un ordre : les absentes à égalité, après les autres.
export const rankIn = (order: readonly string[], story: string): number => {
  const i = order.indexOf(story);
  return i < 0 ? order.length : i;
};
