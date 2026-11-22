import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectData } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { readVersion } from "../project-godot.ts";
import { Failure, type Report } from "../result.ts";
import { isDir } from "../session.ts";

export function detectProject(project: string): DetectData {
  if (!isDir(project)) throw new Failure("directory-not-found", `le dossier n'existe pas : ${project}`);
  const path = join(project, "project.godot");
  if (!existsSync(path)) return { match: false, version: null, evidence: null };
  return { match: true, version: readVersion(readFileSync(path, "utf8")), evidence: "project.godot" };
}

export function detect(o: Options, r: Report): Promise<void> {
  r.data = { ...detectProject(o.required("project")) };
  return Promise.resolve();
}
