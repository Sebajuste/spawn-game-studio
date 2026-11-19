// Rend un worktree utilisable : ses dépendances. Reprises de la source par des liens si le package-lock.json est le
// même (`cache: shared`), sinon installées par `npm ci` (`cache: none`).
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrepareWorktreeData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { logDir, readPackageJson, timestamp } from "../project.ts";
import { run } from "../process.ts";
import { Failure, toSlash, type Report } from "../result.ts";

function sameFile(a: string, b: string): boolean {
  return existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
}

function linkStatus(path: string): "absent" | "link" | "directory" {
  try {
    return lstatSync(path).isSymbolicLink() ? "link" : "directory";
  } catch {
    return "absent";
  }
}

// Lien symbolique de dossier, pas jonction : `git worktree remove --force` (Git pour Windows 2.47) suit une
// jonction et vide le dossier visé, ici le node_modules du projet principal ; un lien symbolique est seulement retiré.
// Sous Windows sans le mode développeur, la création échoue : l'adaptateur installe alors les dépendances.
// Tous les node_modules que décrit le package-lock.json : celui de la racine et ceux des espaces de travail
// (`kit/core/node_modules` quand une version y diffère de la racine), ceux qui sont dans d'autres node_modules exclus.
export function moduleDirs(lockText: string): string[] {
  let packages: Record<string, unknown>;
  try {
    const lock = JSON.parse(lockText) as { packages?: Record<string, unknown> };
    packages = lock.packages ?? {};
  } catch {
    return ["node_modules"];
  }
  const dirs = new Set<string>(["node_modules"]);
  for (const key of Object.keys(packages)) {
    const at = key.split("/").indexOf("node_modules");
    if (at >= 0) dirs.add(key.split("/").slice(0, at + 1).join("/"));
  }
  return [...dirs].sort();
}

// Crée les liens qui manquent ; rend faux si le système en refuse un (les liens créés sont alors retirés).
function share(source: string, project: string, dirs: readonly string[]): boolean {
  const created: string[] = [];
  for (const dir of dirs) {
    const from = join(source, dir);
    const to = join(project, dir);
    if (!existsSync(from) || linkStatus(to) !== "absent" || !existsSync(dirname(to))) continue;
    try {
      symlinkSync(from, to, "dir");
      created.push(to);
    } catch {
      for (const c of created) rmSync(c, { force: true, recursive: true });
      return false;
    }
  }
  return true;
}

export async function prepareWorktree(o: Options, r: Report): Promise<void> {
  r.data = { cache: "none" } satisfies PrepareWorktreeData;
  const project = o.required("project");
  const pkg = readPackageJson(project);
  const source = o.text("source");
  if (source !== undefined && !existsSync(source)) throw new Failure("source-not-found", `dossier source absent : ${source}`);

  const modules = join(project, "node_modules");
  const lock = join(project, "package-lock.json");
  const status = linkStatus(modules);
  // Idempotent : des dépendances déjà là sont gardées (les liens manquants des espaces de travail sont complétés).
  if (status === "link") {
    if (!existsSync(modules)) throw new Failure("dependencies-broken", `${toSlash(modules)} est un lien vers un dossier disparu : le supprimer et relancer prepare-worktree`, "node_modules");
    if (source !== undefined && existsSync(lock)) share(source, project, moduleDirs(readFileSync(lock, "utf8")));
    r.data = { cache: "shared" } satisfies PrepareWorktreeData;
    return;
  }
  if (status === "directory" || pkg.dependencyCount === 0) return;

  if (source !== undefined) {
    const sourceModules = join(source, "node_modules");
    if (sameFile(lock, join(source, "package-lock.json")) && existsSync(sourceModules)) {
      if (share(source, project, moduleDirs(readFileSync(lock, "utf8")))) {
        r.data = { cache: "shared" } satisfies PrepareWorktreeData;
        return;
      }
      r.warn("link-refused", "lien symbolique refusé (mode développeur de Windows inactif ?) : dépendances installées par npm ci");
    }
  }

  if (!existsSync(lock)) {
    throw new Failure("lockfile-missing", "package-lock.json absent : npm ci impossible ; lancer « npm install » dans le projet principal et versionner package-lock.json", "package-lock.json");
  }
  const log = join(logDir(o, project), `prepare-worktree-${timestamp()}.log`);
  writeFileSync(log, "");
  r.log = log;
  const result = await run({ command: "npm ci --no-audit --no-fund", cwd: project, log, deadline: Date.now() + (o.integer("timeout") ?? 900) * 1000 });
  if (result.timedOut) throw new Failure("timeout", "délai dépassé : npm ci arrêté par son PID et ses descendants");
  if (result.code !== 0) throw new Failure("install-failed", `npm ci a échoué (code ${String(result.code)}) : voir le journal`, "package-lock.json");
}
