import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrerequisitesData, PrerequisiteTool } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { lines } from "../parse.ts";
import { logDir, readPackageJson, readSpawnJson, timestamp } from "../project.ts";
import { run } from "../process.ts";
import { Failure, toSlash, type Report } from "../result.ts";
import { findEdge } from "../session.ts";

// « 24.22.0 » correspond à « 24 » et à « 24.22 », pas à « 2 ».
export function versionCompatible(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}.`);
}

// Node et npm sont ceux du PATH : ceux qu'utilisent les scripts du projet, pas forcément celui de l'adaptateur.
export async function prerequisites(o: Options, r: Report): Promise<void> {
  const data: PrerequisitesData = { executable: null, version: null, expected_version: null, tools: [] };
  r.data = data as unknown as Record<string, unknown>;
  (r.data as Record<string, unknown>).source = "path";
  const project = o.text("project");
  if (project !== undefined) {
    readPackageJson(project);
    data.expected_version = readSpawnJson(project)?.version ?? null;
    if (data.expected_version === null) r.warn("spawn-json-missing", "spawn.json absent ou sans version : version de Node attendue inconnue", "spawn.json");
  }

  const log = join(logDir(o, project), `prerequisites-${timestamp()}.log`);
  writeFileSync(log, "");
  r.log = log;
  const deadline = Date.now() + (o.integer("timeout") ?? 60) * 1000;
  const cwd = project ?? process.cwd();

  const nodeRun = await run({ command: 'node -p "JSON.stringify([process.execPath, process.versions.node])"', cwd, log, deadline });
  const reported = lines(nodeRun.output).map((l) => l.trim()).find((l) => l.startsWith("["));
  if (nodeRun.code !== 0 || reported === undefined) {
    throw new Failure("engine-not-found", `Node introuvable dans le PATH : installer Node${data.expected_version ? ` ${data.expected_version}` : ""} (https://nodejs.org) et rouvrir le terminal`);
  }
  const [executable, version] = JSON.parse(reported) as [string, string];
  data.executable = toSlash(executable);
  data.version = version;
  if (data.expected_version !== null && !versionCompatible(version, data.expected_version)) {
    r.error("version-mismatch", `Node ${version} trouvé, ${data.expected_version} attendu (spawn.json)`, "spawn.json");
  }

  const npmRun = await run({ command: "npm --version", cwd, log, deadline });
  const npmVersion = lines(npmRun.output).map((l) => l.trim()).find((l) => /^\d+\.\d+/.test(l)) ?? null;
  data.tools.push({ name: "npm", present: npmRun.code === 0 && npmVersion !== null, version: npmVersion, path: null });
  if (npmRun.code !== 0 || npmVersion === null) r.error("npm-not-found", "npm introuvable dans le PATH : il est livré avec Node, réinstaller Node");

  const edge = findEdge();
  data.tools.push({ name: "edge", present: edge.path !== null, version: null, path: edge.path === null ? null : toSlash(edge.path) });
  if (edge.path === null) r.warn("edge-missing", `Edge introuvable (cherché : ${edge.searched.join(", ")}) : capture impossible`);

  if (project !== undefined) {
    const pkg = readPackageJson(project);
    const modules = join(project, "node_modules");
    const installed = pkg.dependencyCount === 0 || existsSync(modules);
    const tool: PrerequisiteTool = { name: "dependencies", present: installed, version: null, path: existsSync(modules) ? toSlash(modules) : null };
    data.tools.push(tool);
    if (!installed) {
      const command = existsSync(join(project, "package-lock.json")) ? "npm ci" : "npm install";
      r.error("dependencies-missing", `dépendances non installées : lancer « ${command} » dans ${toSlash(project)}`, "package.json");
    }
  }
}
