import { isAbsolute, relative } from "node:path";
import type { Diagnostic } from "../../../core/src/adapter/types.ts";
import { diagnostic, toSlash } from "./result.ts";

// Motifs repris de l'outillage éprouvé de Deep Front. Ni `ERROR:` seul ni `Condition ".*" is true` :
// le moteur en écrit pour des situations bénignes, ce sont des faux positifs mesurés.
// L'ordre compte : le premier motif qui correspond donne le code.
const PATTERNS: readonly { pattern: RegExp; code: string }[] = [
  { pattern: /Parse Error/, code: "syntax-error" },
  { pattern: /Compile Error/, code: "compile-error" },
  { pattern: /Failed to load script/, code: "script-not-loaded" },
  { pattern: /USER SCRIPT ERROR/, code: "script-error" },
  { pattern: /SCRIPT ERROR/, code: "script-error" },
  { pattern: /Cannot open file/, code: "file-unreadable" },
  { pattern: /Failed loading resource/, code: "resource-not-loaded" },
  { pattern: /Invalid scene/, code: "invalid-scene" },
  { pattern: /Attempt to call function .* on a null instance/, code: "script-error" },
  { pattern: /Uniforms were never supplied for set/, code: "render-error" },
  { pattern: /Parameter "uniform_set" is null/, code: "render-error" },
  { pattern: /is not a valid texture/, code: "render-error" },
];

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const POSITION = /^\s+at: .*\((res:\/\/[^)]*?):(\d+)\)\s*$/;
const POSITION_WITHOUT_LINE = /^\s+at: .*\((res:\/\/[^)]*?)\)\s*$/;
const RES_IN_MESSAGE = /["'](res:\/\/[^"']+)["']/;
// Erreur du lecteur de scènes et de ressources texte : `ERROR: res://a/b.tscn:7 - Parse Error: …`.
const RESOURCE_POSITION = /(res:\/\/[^\s"':]+):(\d+) - /;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export function lines(text: string): string[] {
  const clean = stripAnsi(text).replace(/\r\n?/g, "\n");
  const list = clean.split("\n");
  if (list.length > 0 && list[list.length - 1] === "") list.pop();
  return list;
}

// `res://a/b.gd` → `a/b.gd`. Un chemin absolu sous le projet devient relatif ; tout le reste
// (`user://`, scripts d'outil hors projet) ne donne pas de fichier ; un chemin relatif l'est déjà au projet.
export function projectFile(path: string, project?: string): string | undefined {
  if (path.startsWith("res://")) {
    const rel = path.slice("res://".length).replace(/^\/+/, "");
    return rel === "" ? undefined : rel;
  }
  if (path === "" || path.includes("://")) return undefined;
  if (!isAbsolute(path)) return toSlash(path);
  if (project !== undefined) {
    const rel = relative(project, path);
    if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return toSlash(rel);
  }
  return undefined;
}

// Une erreur Godot tient sur une ligne, suivie d'une ligne `   at: … (res://chemin.gd:N)` qui la situe.
export function parseLog(text: string, project?: string): Diagnostic[] {
  const all = lines(text);
  const result: Diagnostic[] = [];
  for (let i = 0; i < all.length; i++) {
    const line = all[i] ?? "";
    if (/^\s+at: /.test(line)) continue;
    const match = PATTERNS.find((m) => m.pattern.test(line));
    if (match === undefined) continue;

    let file: string | undefined;
    let number: number | undefined;
    const next = all[i + 1] ?? "";
    const pos = POSITION.exec(next);
    if (pos !== null) {
      file = projectFile(pos[1] ?? "", project);
      number = Number(pos[2]);
    } else {
      const withoutLine = POSITION_WITHOUT_LINE.exec(next);
      if (withoutLine !== null) file = projectFile(withoutLine[1] ?? "", project);
    }
    const header = RESOURCE_POSITION.exec(line);
    if (file === undefined && header !== null) {
      file = projectFile(header[1] ?? "", project);
      number = Number(header[2]);
    }
    if (file === undefined) {
      const inMessage = RES_IN_MESSAGE.exec(line);
      if (inMessage !== null) file = projectFile(inMessage[1] ?? "", project);
      number = undefined;
    }

    // « Failed to load script » répète une erreur de syntaxe déjà relevée pour le même fichier.
    if (
      match.code === "script-not-loaded" &&
      file !== undefined &&
      result.some((d) => d.file === file && d.code !== "script-not-loaded")
    ) {
      continue;
    }
    result.push(diagnostic(match.code, cleanMessage(line), file, number));
  }
  return result;
}

function cleanMessage(line: string): string {
  return line
    .trim()
    .replace(/^(USER )?SCRIPT ERROR:\s*/, "")
    .replace(/^ERROR:\s*/, "");
}
