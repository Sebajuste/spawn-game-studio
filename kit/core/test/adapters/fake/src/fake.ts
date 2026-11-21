// Adaptateur factice : un moteur imaginaire, honnête et minimal, qui sert de témoin
// à la suite de contrat. Projet = dossier avec `fake.project` ; code = fichiers `.fx` ;
// une ligne `ERROR` ne compile pas ; une ligne `PANIC` échoue à l'exécution ;
// tests = `test/test_*.fx`, une ligne `PASS` réussit, `FAIL` échoue ; scènes = fichiers `.scene`, une ligne `ERROR`
// ne se charge pas ; scène principale = ligne `main=<fichier>` de `fake.project`, vide = sans code ;
// un test qui cite le chemin de la scène principale est un test de bout en bout.
// Avec `liar`, il répond toujours ok: true : la suite de contrat doit le prendre en défaut.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Diagnostic, AdapterResult } from "../../../../src/adapter/types.ts";

// PNG 1×1 valide.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082",
  "hex",
);

const PROJECT_FILE = "fake.project";
const MAIN_PREFIX = "main=";

type Options = Map<string, string[]>;

function parseArgs(argv: string[]): { subcommand: string; options: Options } {
  const [subcommand = "", ...rest] = argv;
  const options: Options = new Map();
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i]?.replace(/^--/, "") ?? "";
    const next = rest[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return { subcommand, options };
}

class Usage extends Error {}

function option(options: Options, name: string): string {
  const v = options.get(name)?.[0];
  if (!v) throw new Usage(`option --${name} manquante`);
  return v;
}

function fxFiles(root: string, dir = root, extension = ".fx"): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith(".") ? [] : fxFiles(root, path, extension);
    return e.name.endsWith(extension) ? [path] : [];
  });
}

function mainScene(project: string): string | null {
  const path = join(project, PROJECT_FILE);
  if (!existsSync(path)) return null;
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(MAIN_PREFIX));
  const scene = line?.slice(MAIN_PREFIX.length).trim() ?? "";
  return scene === "" ? null : scene;
}

function rel(project: string, path: string): string {
  return relative(project, path).split("\\").join("/");
}

function markedLines(path: string, mark: string): number[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((l, i) => (l.trim() === mark ? [i + 1] : []));
}

function newLog(project: string, name: string): string {
  const dir = join(project, ".spawn", "logs", "engine");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}-${Date.now()}-${process.pid}.log`);
  writeFileSync(path, "");
  return path;
}

const SCENARIOS: Record<string, Record<string, string>> = {
  healthy: { "game.fx": "HELLO\n", "decor.scene": "BACKGROUND\n", "test/test_game.fx": "PASS\n", "test/test_round.fx": "LOADS game.fx\nPASS\n" },
  "code-error": { "game.fx": "HELLO\nERROR\n", "test/test_game.fx": "PASS\n" },
  "runtime-error": { "game.fx": "HELLO\nPANIC\n", "test/test_game.fx": "PASS\n" },
  "failing-test": { "game.fx": "HELLO\n", "test/test_game.fx": "PASS\nFAIL\n" },
  "test-not-loaded": { "game.fx": "HELLO\n", "test/test_game.fx": "PASS\n", "test/test_broken.fx": "ERROR\n" },
  "no-tests": { "game.fx": "HELLO\n" },
  "invalid-scene": { "game.fx": "HELLO\n", "level.scene": "ERROR\n", "test/test_game.fx": "PASS\n" },
  "no-main-scene": { "game.fx": "HELLO\n", "test/test_game.fx": "PASS\n" },
  "empty-main-scene": { "game.fx": "", "test/test_game.fx": "PASS\n" },
};

export function main(argv: string[], { liar = false } = {}): number {
  const start = Date.now();
  let subcommand = "";
  const errors: Diagnostic[] = [];
  const artifacts: AdapterResult["artifacts"] = [];
  let log: string | null = null;
  let data: Record<string, unknown> = {};

  const write = (text: string) => {
    if (log) appendFileSync(log, text + "\n");
  };
  const error = (d: Diagnostic) => {
    errors.push(d);
    write(`ERROR ${d.code} ${d.file ?? ""}:${d.line ?? ""} ${d.message}`);
  };

  try {
    const parsed = parseArgs(argv);
    subcommand = parsed.subcommand;
    const o = parsed.options;
    switch (subcommand) {
      case "prerequisites":
        data = { executable: process.execPath, version: "1.0.0", expected_version: null, tools: [] };
        break;
      case "file-types":
        data = { types: [{ extension: ".fx", category: "code", language: "fake", open: "editor" }, { extension: ".scene", category: "scene", open: "engine" }] };
        break;
      case "git-patterns":
        data = { gitignore: [".fake-cache/"], gitattributes: ["*.fx text eol=lf"], lfs: [], lockable: [] };
        break;
      case "new-project": {
        const project = resolve(option(o, "project"));
        if (existsSync(join(project, PROJECT_FILE))) {
          error({ code: "project-exists", message: "un projet factice existe déjà" });
          break;
        }
        writeFileSync(join(project, PROJECT_FILE), option(o, "name") + "\n");
        mkdirSync(join(project, "test"), { recursive: true });
        writeFileSync(join(project, "test", "test_project.fx"), "PASS\n");
        data = { files: [PROJECT_FILE, "test/test_project.fx"] };
        break;
      }
      case "example": {
        const project = resolve(option(o, "project"));
        const files = SCENARIOS[option(o, "scenario")];
        if (!files) throw new Usage("scénario inconnu");
        const main = option(o, "scenario") === "no-main-scene" ? "" : `${MAIN_PREFIX}game.fx\n`;
        writeFileSync(join(project, PROJECT_FILE), `example\n${main}`);
        for (const [name, content] of Object.entries(files)) {
          mkdirSync(join(project, name, ".."), { recursive: true });
          writeFileSync(join(project, name), content);
        }
        data = { scene: "game.fx" };
        break;
      }
      case "detect": {
        const project = resolve(option(o, "project"));
        if (!existsSync(project)) {
          error({ code: "project-not-found", message: `dossier absent : ${project}` });
          break;
        }
        const match = existsSync(join(project, PROJECT_FILE));
        data = { match, version: null, evidence: match ? PROJECT_FILE : null };
        break;
      }
      case "adopt": {
        const project = resolve(option(o, "project"));
        if (!existsSync(join(project, PROJECT_FILE))) {
          error({ code: "not-a-project", message: `aucun ${PROJECT_FILE} dans ${project}` });
          break;
        }
        // Gabarit factice : un premier test s'il n'y en a aucun.
        const files = fxFiles(join(project, "test"), join(project, "test")).length === 0 ? [{ path: "test/test_project.fx", change: "add" }] : [];
        if (!o.has("dry-run")) {
          for (const f of files) {
            mkdirSync(join(project, "test"), { recursive: true });
            writeFileSync(join(project, f.path), "PASS\n");
          }
        }
        data = { files, declared: null, gaps: [] };
        break;
      }
      case "prepare-worktree": {
        const project = resolve(option(o, "project"));
        mkdirSync(join(project, ".fake-cache"), { recursive: true });
        data = { cache: "none" };
        break;
      }
      case "compile": {
        const project = resolve(option(o, "project"));
        log = newLog(project, "compile");
        const files = fxFiles(project).filter((f) => !rel(project, f).startsWith("test/"));
        for (const f of files) {
          write(`compile ${rel(project, f)}`);
          for (const line of markedLines(f, "ERROR")) error({ code: "code-error", message: "instruction ERROR", file: rel(project, f), line });
        }
        const scenes = fxFiles(project, project, ".scene");
        for (const f of scenes) {
          if (markedLines(f, "ERROR").length > 0) error({ code: "invalid-scene", message: "scène illisible", file: rel(project, f) });
        }
        data = { files_checked: files.length, scenes_checked: scenes.length };
        break;
      }
      case "test": {
        const project = resolve(option(o, "project"));
        log = newLog(project, "test");
        let passed = 0;
        let failed = 0;
        const main = mainScene(project);
        const endToEnd: string[] = [];
        for (const f of fxFiles(join(project, "test"), join(project, "test")).filter((f) => /test_[^/\\]*\.fx$/.test(f))) {
          const name = rel(project, f);
          if (main !== null && readFileSync(f, "utf8").includes(main)) endToEnd.push(name);
          if (markedLines(f, "ERROR").length > 0) {
            error({ code: "test-not-loaded", message: "fichier de test illisible", file: name });
            continue;
          }
          passed += markedLines(f, "PASS").length;
          // `ABSENT <chemin>` : vert tant que ce fichier n'existe pas (simule deux branches vertes seules, rouges ensemble).
          readFileSync(f, "utf8")
            .split(/\r?\n/)
            .forEach((l, i) => {
              const m = /^ABSENT (.+)$/.exec(l.trim());
              if (!m) return;
              if (existsSync(join(project, m[1] ?? ""))) {
                failed++;
                error({ code: "test-failed", message: `${m[1]} existe`, file: name, line: i + 1 });
              } else passed++;
            });
          for (const line of markedLines(f, "FAIL")) {
            failed++;
            error({ code: "test-failed", message: "assertion FAIL", file: name, line });
          }
        }
        if (passed + failed === 0 && errors.length === 0) error({ code: "no-tests", message: "aucun test lancé" });
        data = { total: passed + failed, passed, failed, skipped: 0, end_to_end: endToEnd.sort() };
        break;
      }
      case "smoke-test": {
        const project = resolve(option(o, "project"));
        const seconds = Number(o.get("seconds")?.[0] ?? "3");
        const main = mainScene(project);
        data = { scene: main, seconds };
        if (main === null) {
          error({ code: "main-scene-missing", message: `${PROJECT_FILE} ne déclare pas ${MAIN_PREFIX}`, file: PROJECT_FILE });
          break;
        }
        log = newLog(project, "smoke-test");
        const path = join(project, main);
        if (!existsSync(path)) {
          error({ code: "scene-not-found", message: `scène principale absente : ${main}`, file: main });
          break;
        }
        if (readFileSync(path, "utf8").trim() === "") error({ code: "main-scene-empty", message: "la scène principale ne contient rien", file: main });
        for (const mark of ["PANIC", "ERROR"]) {
          for (const line of markedLines(path, mark)) error({ code: "runtime-error", message: `${mark} à l'exécution`, file: main, line });
        }
        break;
      }
      case "capture": {
        const project = resolve(option(o, "project"));
        const scene = join(project, option(o, "scene"));
        const output = option(o, "output");
        log = newLog(project, "capture");
        for (const line of markedLines(scene, "PANIC")) {
          error({ code: "runtime-error", message: "PANIC à l'exécution", file: rel(project, scene), line });
        }
        writeFileSync(output, PNG);
        artifacts.push({ path: resolve(output), role: "capture", type: "png" });
        data = { scene: option(o, "scene"), width: 1, height: 1 };
        break;
      }
      case "launch": {
        const project = resolve(option(o, "project"));
        if (!existsSync(join(project, PROJECT_FILE))) {
          error({ code: "project-not-found", message: `aucun ${PROJECT_FILE} dans ${project}` });
          break;
        }
        const scene = o.get("scene")?.[0] ?? null;
        if (scene !== null && !existsSync(join(project, scene))) {
          error({ code: "scene-not-found", message: `scène absente : ${scene}`, file: scene });
          break;
        }
        // Le « jeu » factice est un Node détaché qui se termine aussitôt : rien ne s'ouvre.
        const game = spawn(process.execPath, ["-e", ""], { stdio: "ignore", detached: true, windowsHide: true });
        game.on("error", () => undefined);
        game.unref();
        if (game.pid === undefined) error({ code: "engine-launch-failed", message: "le jeu factice n'a pas pu être lancé" });
        else data = { pid: game.pid, scene };
        break;
      }
      case "read-log": {
        const text = readFileSync(option(o, "file"), "utf8");
        const lines = text.split(/\r?\n/);
        lines.forEach((l, i) => {
          if (l.startsWith("ERROR ")) errors.push({ code: "log-error", message: l, line: i + 1 });
        });
        data = { lines: lines.length };
        break;
      }
      default:
        throw new Usage(`sous-commande inconnue : ${subcommand || "(aucune)"}`);
    }
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    errors.push({ code: "usage", message: e.message });
  }

  const usage = errors.some((e) => e.code === "usage");
  const result: AdapterResult = {
    contract: 1,
    engine: "fake",
    command: subcommand || "(none)",
    ok: errors.length === 0,
    errors,
    warnings: [],
    artifacts,
    log,
    duration_ms: Date.now() - start,
    data,
  };
  if (liar && !usage) {
    result.ok = true;
    result.errors = [];
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.ok ? 0 : usage ? 2 : 1;
}
