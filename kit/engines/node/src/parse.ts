// Relecture de la sortie des outils de la pile : tsc, eslint (format stylish), cargo, erreurs non rattrapées de
// Node, et résumé du lanceur de tests de Node (reporter spec, ou TAP).
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnostic } from "./result.ts";
import type { Diagnostic } from "../../../core/src/adapter/types.ts";

// Séquences de couleur des terminaux (ESC [ … lettre).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

export function lines(text: string): string[] {
  return text.replace(ANSI, "").split(/\r?\n/);
}

// Chemins d'une sortie, rapportés au projet. Un chemin relatif l'est au dossier où le script a tourné : la racine,
// ou le dossier d'un espace de travail npm, repéré par l'en-tête qu'npm écrit avant chaque script.
export class Paths {
  private readonly project: string;
  private readonly workspaces: ReadonlyMap<string, string>;
  private current = ".";

  constructor(project: string | undefined, workspaces: ReadonlyMap<string, string> = new Map()) {
    this.project = project ?? "";
    this.workspaces = workspaces;
  }

  // Suit les en-têtes d'npm (`> nom@version script`, ou `npm notice run nom@version script` depuis npm 12) ;
  // rend vrai si la ligne en est un.
  follow(line: string): boolean {
    const m = /^(?:> |npm notice run )(@?[^@\s]+)@\S* \S+$/.exec(line);
    if (!m?.[1]) return false;
    this.current = this.workspaces.get(m[1]) ?? ".";
    return true;
  }

  // Chemin relatif au projet (`/`), ou undefined s'il sort du projet ou n'est pas un fichier.
  file(raw: string): string | undefined {
    let path = raw.trim();
    if (path.startsWith("file://")) {
      try {
        path = fileURLToPath(path);
      } catch {
        return undefined;
      }
    }
    if (path === "" || path.startsWith("node:")) return undefined;
    if (this.project === "") return isAbsolute(path) ? undefined : normalize(path).replaceAll("\\", "/");
    if (!isAbsolute(path)) {
      const fromCurrent = join(this.current, path);
      path = this.current !== "." && existsSync(join(this.project, fromCurrent)) ? fromCurrent : path;
      return inside(normalize(path)) ? normalize(path).replaceAll("\\", "/") : undefined;
    }
    const rel = relative(this.project, path);
    return inside(rel) ? rel.replaceAll("\\", "/") : undefined;
  }
}

function inside(rel: string): boolean {
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const TSC_PAREN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const TSC_PRETTY = /^(.+?):(\d+):(\d+) - error (TS\d+): (.+)$/;
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+error\s+(.+?)(?:\s{2,}(\S+))?\s*$/;
const CARGO_ERROR = /^error(?:\[(E\d+)\])?: (.+)$/;
const CARGO_WARNING = /^warning(?:\[\w+\])?: /;
const CARGO_AT = /^\s*--> (.+):(\d+):(\d+)$/;
// En-tête d'une erreur non rattrapée : `chemin:ligne` seul sur sa ligne, puis la ligne fautive.
const NODE_HEADER = /^(?=\S)((?:file:\/\/\/)?(?:[A-Za-z]:)?[^:]*?\.[cm]?[jt]sx?):(\d+)$/;
const NODE_ERROR = /^((?:[A-Z][A-Za-z]*)?Error)(?: \[[A-Z0-9_]+\])?: (.+)$/;
const NODE_FRAME = /^\s+at (?:.*?\()?((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^()]+?):(\d+):(\d+)\)?$/;

// Erreurs de compilation et d'exécution : tsc, eslint, cargo et erreurs non rattrapées de Node.
export function parseErrors(text: string, paths: Paths): Diagnostic[] {
  const all = lines(text);
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  const add = (code: string, message: string, file?: string, line?: number): void => {
    const d = diagnostic(code, message, file, line);
    const key = `${d.code}|${d.message}|${d.file ?? ""}|${String(d.line ?? "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(d);
  };

  let eslintFile: string | undefined;
  let cargo: string | undefined;
  let header: { file: string | undefined; line: number; index: number } | undefined;

  for (let i = 0; i < all.length; i++) {
    const line = all[i] ?? "";
    if (line.startsWith("# spawn:")) continue;
    if (paths.follow(line)) continue;

    let m = TSC_PAREN.exec(line) ?? TSC_PRETTY.exec(line);
    if (m) {
      const file = paths.file(m[1] ?? "");
      add("compile-error", `${m[4] ?? ""} : ${m[5] ?? ""}${file === undefined ? ` (${m[1] ?? ""})` : ""}`, file, Number(m[2]));
      continue;
    }

    m = ESLINT_ROW.exec(line);
    if (m && eslintFile !== undefined) {
      const file = paths.file(eslintFile);
      add("lint-error", `${m[3] ?? ""}${m[4] ? ` (${m[4]})` : ""}${file === undefined ? ` (${eslintFile})` : ""}`, file, Number(m[1]));
      continue;
    }
    // Fichier d'eslint : une ligne non indentée qui n'est qu'un chemin de fichier.
    if (/^(?:[A-Za-z]:[\\/]|\/)\S.*\.\w+$/.test(line)) eslintFile = line.trim();
    else if (line.trim() === "") eslintFile = undefined;

    m = CARGO_ERROR.exec(line);
    if (m) {
      cargo = `${m[1] ? `${m[1]} : ` : ""}${m[2] ?? ""}`;
      continue;
    }
    if (CARGO_WARNING.test(line)) {
      cargo = undefined;
      continue;
    }
    m = CARGO_AT.exec(line);
    if (m && cargo !== undefined) {
      const file = paths.file(m[1] ?? "");
      add("compile-error", `${cargo}${file === undefined ? ` (${m[1] ?? ""})` : ""}`, file, Number(m[2]));
      cargo = undefined;
      continue;
    }

    m = NODE_HEADER.exec(line);
    if (m) {
      header = { file: paths.file(m[1] ?? ""), line: Number(m[2]), index: i };
      continue;
    }
    m = NODE_ERROR.exec(line);
    if (m) {
      const kind = m[1] ?? "Error";
      const code = kind === "SyntaxError" ? "compile-error" : "runtime-error";
      let file: string | undefined;
      let at: number | undefined;
      if (header !== undefined && i - header.index <= 6 && header.file !== undefined) {
        file = header.file;
        at = header.line;
      } else {
        // Sinon, le premier cadre de la pile qui est dans le projet.
        for (let j = i + 1; j < all.length && j <= i + 30; j++) {
          const f = NODE_FRAME.exec(all[j] ?? "");
          if (!f) {
            if (!/^\s+at /.test(all[j] ?? "")) break;
            continue;
          }
          const candidate = paths.file(f[1] ?? "");
          if (candidate !== undefined && !candidate.includes("node_modules/")) {
            file = candidate;
            at = Number(f[2]);
            break;
          }
        }
      }
      add(code, `${kind} : ${m[2] ?? ""}`, file, at);
      header = undefined;
    }
  }
  return found;
}

export interface FailedTest {
  name: string;
  file?: string;
  line?: number;
}

export interface TestSummary {
  // Nombre de résumés lus (un par suite : `npm test --workspaces` en lance plusieurs).
  suites: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: FailedTest[];
}

const SUMMARY = /^[ℹ#] (tests|pass|fail|cancelled|skipped|todo) (\d+)$/;
const FAILING_MARK = /^✖ failing tests:$/;
const FAILING_AT = /^test at (.+):(\d+):(\d+)$/;
const FAILING_NAME = /^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/;
const TAP_NOT_OK = /^\s*not ok \d+ - (.+?)(?: #.*)?$/;

// Résumé du lanceur de tests de Node. Les suites successives (espaces de travail) s'additionnent.
export function parseTestOutput(text: string, paths: Paths): TestSummary {
  const s: TestSummary = { suites: 0, total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  let inFailing = false;
  let location: { file: string | undefined; line: number } | undefined;
  let spec = false;
  const tap: string[] = [];
  for (const line of lines(text)) {
    if (paths.follow(line)) {
      inFailing = false;
      continue;
    }
    const m = SUMMARY.exec(line);
    if (m) {
      inFailing = false;
      const n = Number(m[2]);
      if (m[1] === "tests") {
        s.suites++;
        s.total += n;
      } else if (m[1] === "pass") s.passed += n;
      else if (m[1] === "fail" || m[1] === "cancelled") s.failed += n;
      else s.skipped += n;
      continue;
    }
    if (FAILING_MARK.test(line)) {
      inFailing = true;
      spec = true;
      continue;
    }
    if (inFailing) {
      const at = FAILING_AT.exec(line);
      if (at) {
        location = { file: paths.file(at[1] ?? ""), line: Number(at[2]) };
        continue;
      }
      const name = FAILING_NAME.exec(line);
      if (name?.[1] && location !== undefined) {
        s.failures.push({ name: name[1], ...(location.file !== undefined ? { file: location.file, line: location.line } : {}) });
        location = undefined;
      }
      continue;
    }
    const t = TAP_NOT_OK.exec(line);
    if (t?.[1]) tap.push(t[1]);
  }
  if (!spec) for (const name of tap) s.failures.push({ name });
  return s;
}
