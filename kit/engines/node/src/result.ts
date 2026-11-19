import type { Artifact, Diagnostic, AdapterResult } from "../../../core/src/adapter/types.ts";

export const ENGINE = "node";

// Appel invalide (contrat §3) : sortie 2 avec l'erreur `usage`.
export class UsageError extends Error {}

// Échec connu qui interrompt une sous-commande : il devient une erreur du résultat.
export class Failure extends Error {
  readonly code: string;
  readonly file: string | undefined;

  constructor(code: string, message: string, file?: string) {
    super(message);
    this.code = code;
    this.file = file;
  }
}

// Accumulateur partagé par les sous-commandes ; `cli.ts` le transforme en résultat final.
export class Report {
  readonly errors: Diagnostic[] = [];
  readonly warnings: Diagnostic[] = [];
  readonly artifacts: Artifact[] = [];
  log: string | null = null;
  data: Record<string, unknown> = {};

  error(code: string, message: string, file?: string, line?: number): void {
    this.errors.push(diagnostic(code, message, file, line));
  }

  warn(code: string, message: string, file?: string, line?: number): void {
    this.warnings.push(diagnostic(code, message, file, line));
  }

  artifact(path: string, role: string, type: string): void {
    this.artifacts.push({ path: toSlash(path), role, type });
  }
}

export function diagnostic(code: string, message: string, file?: string, line?: number): Diagnostic {
  const d: Diagnostic = { code, message: message.trim() === "" ? code : message.trim() };
  if (file !== undefined && file !== "") d.file = toSlash(file);
  if (line !== undefined && Number.isInteger(line) && line >= 1) d.line = line;
  return d;
}

export function toSlash(path: string): string {
  return path.replaceAll("\\", "/");
}

export function buildResult(command: string, report: Report, start: number): AdapterResult {
  return {
    contract: 1,
    engine: ENGINE,
    command,
    ok: report.errors.length === 0,
    errors: report.errors,
    warnings: report.warnings,
    artifacts: report.artifacts,
    log: report.log === null ? null : toSlash(report.log),
    duration_ms: Math.max(0, Math.round(performance.now() - start)),
    data: report.data,
  };
}
