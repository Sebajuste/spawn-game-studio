// Un dossier existant est-il un projet Node ? `package.json` à la racine ; la version vient de ce que le projet déclare.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { Failure, type Report } from "../result.ts";

// Première version majeure citée (« >=20.11 », « ^18 », « v22.1.0 », « 20.x ») ; « lts/* » n'en a pas.
export function majorOf(text: string): string | null {
  return /(\d+)/.exec(text.trim())?.[1] ?? null;
}

function enginesNode(project: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as { engines?: { node?: unknown } };
    return typeof raw.engines?.node === "string" ? majorOf(raw.engines.node) : null;
  } catch {
    return null;
  }
}

// Ce que déclare le projet, sinon le Node qui exécute l'adaptateur (celui de la machine).
export function nodeVersion(project: string): string {
  const declared = enginesNode(project);
  if (declared !== null) return declared;
  for (const file of [".nvmrc", ".node-version"]) {
    const path = join(project, file);
    if (existsSync(path)) {
      const v = majorOf(readFileSync(path, "utf8"));
      if (v !== null) return v;
    }
  }
  return process.versions.node.split(".")[0] ?? "";
}

export function detect(o: Options, r: Report): Promise<void> {
  r.data = { match: false, version: null, evidence: null } satisfies DetectData;
  const project = o.required("project");
  if (!existsSync(project)) throw new Failure("project-not-found", `dossier absent : ${project}`);
  if (existsSync(join(project, "package.json"))) {
    r.data = { match: true, version: nodeVersion(project), evidence: "package.json" } satisfies DetectData;
  }
  return Promise.resolve();
}
