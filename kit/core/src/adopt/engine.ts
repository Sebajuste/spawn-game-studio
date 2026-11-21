// Quel adaptateur reconnaît le dossier : le premier dont `detect` répond oui (ordre alphabétique des moteurs).
import { callAdapter, type Adapter } from "../adapter/call.ts";
import type { DetectData } from "../adapter/types.ts";
import { loadAdapters } from "../adapters.ts";
import { ENGINES_DIR } from "../project.ts";

export interface DetectedEngine {
  engine: string;
  title: string;
  version: string | null;
  evidence: string | null;
}

export async function detectWith(adapter: Adapter, dir: string): Promise<DetectedEngine | null> {
  const r = await callAdapter(adapter, "detect", { project: dir }, { timeoutMs: 30_000 });
  // Un adaptateur qui répond mal ne reconnaît rien : il ne doit pas empêcher les autres de répondre.
  if (!r.result || r.defects.length > 0 || !r.result.ok) return null;
  const d = r.result.data as Partial<DetectData>;
  if (d.match !== true) return null;
  return {
    engine: adapter.descriptor.engine,
    title: adapter.descriptor.title ?? adapter.descriptor.engine,
    version: typeof d.version === "string" && d.version !== "" ? d.version : null,
    evidence: typeof d.evidence === "string" ? d.evidence : null,
  };
}

export async function detectEngine(dir: string, engines: string = ENGINES_DIR): Promise<DetectedEngine | null> {
  for (const adapter of loadAdapters(engines)) {
    const found = await detectWith(adapter, dir);
    if (found) return found;
  }
  return null;
}
