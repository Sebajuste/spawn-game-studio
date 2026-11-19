import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { unzipSync } from "fflate";
import type { Diagnostic } from "../../../core/src/adapter/types.ts";
import { parseLog, projectFile, lines } from "./log.ts";
import { Failure, diagnostic } from "./result.ts";

export const GUT_VERSION = "9.6.0";
const GUT_URL = `https://github.com/bitwes/Gut/archive/refs/tags/v${GUT_VERSION}.zip`;
const GUT_SHA256 = "d01311bedab7b96caec275b1646757a52a1e13b8475eabfe76ac62b7134433f3";
const ZIP_PREFIX = `Gut-${GUT_VERSION}/addons/gut/`;

export function cacheDir(): string {
  const variable = process.env.SPAWN_CACHE;
  if (variable !== undefined && variable !== "") return variable;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "spawn", "cache");
  }
  return join(homedir(), ".cache", "spawn");
}

export function gutZipPath(): string {
  return join(cacheDir(), `gut-${GUT_VERSION}.zip`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// L'empreinte est vérifiée à chaque usage ; une archive fausse est une erreur, jamais un repli.
export async function gutArchive(): Promise<Uint8Array> {
  const path = gutZipPath();
  if (!existsSync(path)) {
    let bytes: Uint8Array;
    try {
      const response = await fetch(GUT_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      throw new Failure("gut-download", `téléchargement de GUT ${GUT_VERSION} impossible (${GUT_URL}) : ${String(e)}`);
    }
    const actual = sha256(bytes);
    if (actual !== GUT_SHA256) {
      throw new Failure("gut-checksum", `GUT téléchargé : empreinte ${actual}, attendue ${GUT_SHA256}`);
    }
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
    return bytes;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const actual = sha256(bytes);
  if (actual !== GUT_SHA256) {
    throw new Failure("gut-checksum", `${path} : empreinte ${actual}, attendue ${GUT_SHA256} ; supprimer le fichier pour le retélécharger`);
  }
  return bytes;
}

// Copie `Gut-x/addons/gut/` de l'archive dans `<projet>/addons/gut/`. Renvoie les fichiers écrits, relatifs au projet.
export async function installGut(project: string): Promise<string[]> {
  const entries = unzipSync(await gutArchive(), { filter: (f) => f.name.startsWith(ZIP_PREFIX) });
  const target = join(project, "addons", "gut");
  const written: string[] = [];
  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const rel = name.slice(ZIP_PREFIX.length);
    const destination = normalize(join(target, rel));
    if (!destination.startsWith(target + sep)) throw new Failure("gut-archive", `entrée d'archive hors de addons/gut : ${name}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    written.push(`addons/gut/${rel}`);
  }
  if (written.length === 0) throw new Failure("gut-archive", `l'archive GUT ne contient pas ${ZIP_PREFIX}`);
  return written.sort();
}

export function installedGutVersion(project: string): string | null {
  const cfg = join(project, "addons", "gut", "plugin.cfg");
  if (!existsSync(cfg)) return null;
  const m = /^version\s*=\s*"([^"]*)"/m.exec(readFileSync(cfg, "utf8"));
  return m?.[1] ?? "";
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: Diagnostic[];
  // Fichiers de test lancés (relatifs), d'après le rapport JUnit.
  files: string[];
}

// Rapport JUnit de GUT 9.6 : `<testsuite name="test/test_a.gd">` (relatif, sans `res://`),
// `<testcase status="pass|fail|pending">`, le texte utile de l'échec est dans le CDATA de
// `<failure message="failed">`, suivi de « at line N » (ou « at line -1 » pour une erreur moteur).
export function parseJUnit(xml: string, project?: string): TestSummary {
  const summary: TestSummary = { total: 0, passed: 0, failed: 0, skipped: 0, errors: [], files: [] };
  const suites = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
  for (const suite of xml.matchAll(suites)) {
    const file = projectFile(attribute(suite[1] ?? "", "name") ?? "", project);
    if (file !== undefined && !summary.files.includes(file)) summary.files.push(file);
    const cases = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    for (const c of (suite[2] ?? "").matchAll(cases)) {
      const attrs = c[1] ?? "";
      const body = c[2] ?? "";
      const status = attribute(attrs, "status") ?? "";
      const name = attribute(attrs, "name") ?? "?";
      summary.total++;
      const failure = /<failure\b([^>]*)>([\s\S]*?)<\/failure>/.exec(body);
      if (failure !== null || status === "fail") {
        summary.failed++;
        const text = failure === null ? "" : rawText(failure[2] ?? "");
        const message = text.trim() !== "" ? text : (attribute(failure?.[1] ?? "", "message") ?? "échec");
        const line = /at line (\d+)/.exec(message)?.[1];
        const short = message.replace(/\s*at line -?\d+\s*/g, " ").replace(/\s+/g, " ").trim();
        summary.errors.push(
          diagnostic("test-failed", `${name} : ${short}`, file, line === undefined ? undefined : Number(line)),
        );
      } else if (status === "pending" || status === "risky" || /<skipped\b/.test(body)) {
        summary.skipped++;
      } else {
        summary.passed++;
      }
    }
  }
  return summary;
}

function attribute(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m?.[1] === undefined ? undefined : decodeXml(m[1]);
}

function rawText(body: string): string {
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(body);
  return cdata !== null ? (cdata[1] ?? "") : decodeXml(body.replace(/<[^>]+>/g, " "));
}

function decodeXml(t: string): string {
  return t
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#10;", "\n")
    .replaceAll("&amp;", "&");
}

const LOAD_CODES = new Set(["syntax-error", "compile-error", "script-not-loaded"]);
const GUT_IGNORED = /Ignoring script (res:\/\/\S+) because it does not extend GutTest/;

// GUT ment par son code de sortie dans deux cas mesurés : un fichier de test qui ne se charge pas
// est ignoré (« All tests passed! », sortie 0) et rien de lancé donne « Nothing was run. » (sortie 0).
// Le verdict se fonde donc sur la sortie relue et sur le rapport JUnit.
export function parseTests(
  output: string,
  junit: string | null,
  exitCode: number | null,
  project?: string,
): TestSummary {
  const summary: TestSummary =
    junit === null ? { total: 0, passed: 0, failed: 0, skipped: 0, errors: [], files: [] } : parseJUnit(junit, project);
  const errors: Diagnostic[] = [];
  const notLoaded = new Set<string>();

  for (const d of parseLog(output, project)) {
    if (!LOAD_CODES.has(d.code)) continue;
    const key = d.file ?? d.message;
    if (notLoaded.has(key)) continue;
    notLoaded.add(key);
    const code = d.file !== undefined && isTestFile(d.file) ? "test-not-loaded" : d.code;
    errors.push(diagnostic(code, d.message, d.file, d.line));
  }
  for (const l of lines(output)) {
    const m = GUT_IGNORED.exec(l);
    const file = m === null ? undefined : projectFile(m[1] ?? "", project);
    if (file === undefined || notLoaded.has(file)) continue;
    notLoaded.add(file);
    errors.push(diagnostic("test-not-loaded", `GUT a ignoré ${file} : le script n'étend pas GutTest`, file));
  }

  const nothing = lines(output).some((l) => /Nothing was run\./.test(l));
  if (nothing || (junit !== null && summary.total === 0)) {
    errors.push(diagnostic("no-tests", "aucun test n'a été lancé"));
  } else if (junit === null) {
    errors.push(diagnostic("report-missing", "GUT n'a pas écrit de rapport JUnit"));
  }
  errors.push(...summary.errors);

  if (errors.length === 0 && exitCode !== 0) {
    errors.push(diagnostic("gut-failed", `GUT est sorti en ${String(exitCode)} sans échec identifiable ; voir le journal`));
  }
  summary.errors = errors;
  return summary;
}

function isTestFile(file: string): boolean {
  return file.startsWith("test/") || file.startsWith("tests/") || /(^|\/)test_[^/]*$/.test(file);
}
