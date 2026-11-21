// Les adaptateurs présents (`kit/engines/*/adapter.json`) : l'app propose ces moteurs, aucun n'est écrit en dur.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DESCRIPTOR_FILE, loadAdapter, type Adapter } from "./adapter/call.ts";
import { ENGINES_DIR } from "./project.ts";

export interface AdapterInfo {
  engine: string;
  title: string;
}

// Un descripteur illisible est ignoré : un adaptateur en cours d'écriture ne doit pas masquer les autres.
export function loadAdapters(dir: string = ENGINES_DIR): Adapter[] {
  if (!existsSync(dir)) return [];
  const found: Adapter[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(dir, e.name, DESCRIPTOR_FILE))) continue;
    try {
      // Un projet retrouve son adaptateur par `<engines>/<engine>` : un dossier d'un autre nom serait introuvable ensuite.
      const adapter = loadAdapter(join(dir, e.name));
      if (adapter.descriptor.engine === e.name) found.push(adapter);
    } catch {
      continue;
    }
  }
  return found.sort((a, b) => (a.descriptor.engine < b.descriptor.engine ? -1 : 1));
}

export function listAdapters(dir: string = ENGINES_DIR): AdapterInfo[] {
  return loadAdapters(dir).map((a) => ({ engine: a.descriptor.engine, title: a.descriptor.title ?? a.descriptor.engine }));
}
