// Mots du domaine d'un projet (D9) : fournis par l'adaptateur de moteur (« jeu », « scène principale », « joueur » pour
// Godot), neutres sinon. Le cœur les prend ici et ne nomme jamais lui-même le domaine qu'il sert.
import type { AdapterDomain } from "./adapter/types.ts";
import { projectAdapter, type Project } from "./project.ts";

export const NEUTRAL_DOMAIN: AdapterDomain = { product: "projet", entry: "point d'entrée", user: "utilisateur" };

export function domain(project: Project): AdapterDomain {
  try {
    return projectAdapter(project).descriptor.domain ?? NEUTRAL_DOMAIN;
  } catch {
    return NEUTRAL_DOMAIN;
  }
}

// Un moteur sans scènes le déclare (not_applicable : invalid-scene) : sa capture vise la page que le projet déclare.
export function hasScenes(project: Project): boolean {
  try {
    return projectAdapter(project).descriptor.not_applicable?.includes("invalid-scene") !== true;
  } catch {
    return true;
  }
}
