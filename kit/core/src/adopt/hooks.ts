// Hooks git du kit : réglés par `core.hooksPath` local. Un autre gestionnaire de hooks se tranche par une personne.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitState } from "./git.ts";

export const GIT_HOOKS = fileURLToPath(new URL("../../git-hooks/", import.meta.url));

export type HooksStatus = "kit" | "absent" | "other" | "husky";

const normalize = (p: string) => resolve(p).replace(/[\\/]+$/, "").toLowerCase();

export function hooksStatus(state: GitState, kit: string = GIT_HOOKS): HooksStatus {
  if (state.hooksPath !== null) return normalize(state.hooksPath) === normalize(kit) ? "kit" : "other";
  return state.husky ? "husky" : "absent";
}
