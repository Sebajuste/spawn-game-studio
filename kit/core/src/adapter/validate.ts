// Relecture d'une réponse d'adaptateur : schéma JSON et invariants du contrat (§3).
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, type AdapterResult } from "./types.ts";

const schema: unknown = JSON.parse(
  readFileSync(new URL("../../schemas/adapter-result.v1.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<AdapterResult>(schema as object);

export interface RawResponse {
  subcommand: string;
  engine: string;
  exitCode: number | null;
  stdout: string;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function validateResponse(raw: RawResponse): { defects: string[]; result: AdapterResult | null } {
  const defects: string[] = [];
  let object: unknown;
  try {
    object = JSON.parse(raw.stdout);
  } catch {
    const excerpt = raw.stdout.trim().slice(0, 200) || "(vide)";
    return { defects: [`stdout n'est pas un unique objet JSON : ${excerpt}`], result: null };
  }
  if (!validateSchema(object)) {
    for (const e of validateSchema.errors ?? []) defects.push(`schéma : ${e.instancePath || "/"} ${e.message ?? ""}`.trim());
    return { defects, result: null };
  }
  const r = object;

  if (r.engine !== raw.engine) defects.push(`engine « ${r.engine} » au lieu de « ${raw.engine} »`);
  if (r.command !== raw.subcommand) defects.push(`command « ${r.command} » au lieu de « ${raw.subcommand} »`);

  if (r.ok && r.errors.length > 0) defects.push("ok: true avec des erreurs");
  if (!r.ok && r.errors.length === 0) defects.push("ok: false sans erreur");

  const usage = r.errors.some((e) => e.code === "usage");
  const expected = r.ok ? EXIT_OK : usage ? EXIT_USAGE : EXIT_FAILURE;
  if (raw.exitCode !== expected) defects.push(`code de sortie ${String(raw.exitCode)} au lieu de ${expected} (ok: ${r.ok})`);

  for (const d of [...r.errors, ...r.warnings]) {
    if (d.file !== undefined && isAbsolute(d.file)) defects.push(`diagnostic ${d.code} : fichier absolu ${d.file}`);
  }
  if (r.log !== null) {
    if (!isAbsolute(r.log)) defects.push(`journal non absolu : ${r.log}`);
    else if (!isFile(r.log)) defects.push(`journal introuvable : ${r.log}`);
  }
  for (const a of r.artifacts) {
    if (!isAbsolute(a.path)) defects.push(`artefact ${a.role} non absolu : ${a.path}`);
    else if (!isFile(a.path)) defects.push(`artefact ${a.role} introuvable : ${a.path}`);
  }
  return { defects, result: r };
}
