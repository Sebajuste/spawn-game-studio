// Gabarit Node posé sur un projet existant : la section `node` de spawn.json déduite des scripts, et un premier test
// s'il n'y en a pas. Rien n'est écrasé ; un second passage ne change rien.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AdoptData, AdoptFile } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { readPackageJson, readSpawnJson, type NodeConfig } from "../project.ts";
import { Failure, type Report } from "../result.ts";
import { declareFromScripts, FIRST_TEST, FIRST_TEST_SCRIPT, hasTestScript, scriptGaps } from "../scripts.ts";

const FIRST_TEST_CONTENT = `// Premier test posé par Spawn à l'adoption : il prouve que la suite tourne. À remplacer par les vrais tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("package.json se lit", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(typeof pkg, "object");
});
`;

const SKIPPED = new Set(["node_modules", "dist", "build", "coverage", "target"]);
const SCANNED = /\.(?:[cm]?[jt]sx?|json)$/;

// Un fichier du projet écrit-il « SPAWN-URL » ? Borné : un grand dépôt n'est pas lu en entier.
function announcesUrl(dir: string, budget = { files: 3000 }): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (budget.files <= 0) return false;
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIPPED.has(e.name) && !e.name.startsWith(".") && announcesUrl(path, budget)) return true;
    } else if (e.isFile() && SCANNED.test(e.name)) {
      budget.files--;
      if (readFileSync(path, "utf8").includes("SPAWN-URL")) return true;
    }
  }
  return false;
}

// Réécrit un JSON en gardant l'indentation du fichier.
function writeJson(path: string, value: unknown): void {
  const indent = /^([ \t]+)"/m.exec(readFileSync(path, "utf8"))?.[1] ?? "  ";
  writeFileSync(path, `${JSON.stringify(value, null, indent)}\n`);
}

function rawSpawnJson(project: string): Record<string, unknown> {
  const path = join(project, "spawn.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
}

export function adopt(o: Options, r: Report): Promise<void> {
  r.data = { files: [], declared: null, gaps: [] } satisfies AdoptData;
  const project = o.required("project");
  if (!existsSync(join(project, "package.json"))) throw new Failure("not-a-project", `aucun package.json dans ${project}`);
  const dryRun = o.has("dry-run");
  const pkg = readPackageJson(project);
  // Le cœur écrit spawn.json avant l'adoption ; au diagnostic (--dry-run), il n'existe peut-être pas encore.
  const current = readSpawnJson(project);
  if (current === null && !dryRun) throw new Failure("spawn-json-missing", `spawn.json absent de ${project} : le cœur l'écrit avant adopt`, "spawn.json");
  const hasSection = current !== null && rawSpawnJson(project).node !== undefined;

  const files: AdoptFile[] = [];
  const addTest = !hasSection && !hasTestScript(pkg.scripts);
  const scripts = addTest ? { ...pkg.scripts, test: FIRST_TEST_SCRIPT } : pkg.scripts;
  const declared: NodeConfig = hasSection ? current.node : declareFromScripts(scripts);
  if (!hasSection) files.push({ path: "spawn.json", change: "complete" });
  if (addTest) {
    if (!existsSync(join(project, FIRST_TEST))) files.push({ path: FIRST_TEST, change: "add" });
    files.push({ path: "package.json", change: "complete" });
  }

  if (!dryRun) {
    if (addTest) {
      const test = join(project, FIRST_TEST);
      if (!existsSync(test)) {
        mkdirSync(dirname(test), { recursive: true });
        writeFileSync(test, FIRST_TEST_CONTENT);
      }
      const path = join(project, "package.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      writeJson(path, { ...raw, scripts: { ...(raw.scripts as Record<string, unknown> | undefined), test: FIRST_TEST_SCRIPT } });
    }
    if (!hasSection) writeJson(join(project, "spawn.json"), { ...rawSpawnJson(project), node: declared });
  }

  r.data = {
    files,
    declared: { ...declared },
    gaps: scriptGaps(declared, scripts, announcesUrl(project)),
  } satisfies AdoptData;
  return Promise.resolve();
}
