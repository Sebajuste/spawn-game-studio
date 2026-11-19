import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrerequisitesData, PrerequisiteTool } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { gutZipPath, GUT_VERSION, installedGutVersion } from "../gut.ts";
import { lines } from "../log.ts";
import { Failure, toSlash, type Report } from "../result.ts";
import { Session } from "../session.ts";

// `4.7.2.stable.official.ed1daf0bf` correspond à `4.7.2` et à `4.7`, pas à `4.7.20`.
export function versionCompatible(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}.`);
}

function readSpawnJson(project: string, r: Report): string | null {
  const path = join(project, "spawn.json");
  if (!existsSync(path)) {
    r.warn("spawn-json-missing", "spawn.json absent : version attendue inconnue", "spawn.json");
    return null;
  }
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Failure("spawn-json-invalid", `spawn.json illisible : ${String(e)}`, "spawn.json");
  }
  const c = content as { engine?: unknown; version?: unknown };
  if (c.engine !== undefined && c.engine !== "godot") {
    throw new Failure("engine-mismatch", `spawn.json déclare le moteur ${String(c.engine)}`, "spawn.json");
  }
  return typeof c.version === "string" ? c.version : null;
}

export async function prerequisites(o: Options, r: Report): Promise<void> {
  const data: PrerequisitesData = { executable: null, version: null, expected_version: null, tools: [] };
  r.data = data as unknown as Record<string, unknown>;
  const project = o.text("project");

  const gut: PrerequisiteTool =
    project !== undefined
      ? (() => {
          const version = installedGutVersion(project);
          return { name: "gut", present: version !== null, version, path: version === null ? null : toSlash(join(project, "addons", "gut")) };
        })()
      : existsSync(gutZipPath())
        ? { name: "gut", present: true, version: GUT_VERSION, path: toSlash(gutZipPath()) }
        : { name: "gut", present: false, version: null, path: null };
  data.tools.push(gut);
  if (project !== undefined && !gut.present) r.warn("gut-missing", "GUT n'est pas installé dans addons/gut", "addons/gut");

  if (project !== undefined) data.expected_version = readSpawnJson(project, r);

  const session = new Session("prerequisites", o, r, 60, project);
  data.executable = toSlash(session.executable);
  // D'où vient le chemin : le cœur retient dans le réglage machine un Godot trouvé par recherche.
  (r.data as Record<string, unknown>).source = session.source;
  const l = await session.run(["--headless", "--version"]);
  const version = lines(l.output)
    .map((x) => x.trim())
    .find((x) => /^\d+\.\d+/.test(x));
  if (version === undefined) throw new Failure("version-unreadable", "Godot n'a pas donné de version reconnaissable");
  data.version = version;
  if (data.expected_version !== null && !versionCompatible(version, data.expected_version)) {
    r.error("version-mismatch", `Godot ${version} trouvé, ${data.expected_version} attendu (spawn.json)`, "spawn.json");
  }
}
