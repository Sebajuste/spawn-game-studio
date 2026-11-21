// Runtime : une version de Spawn figée hors du dépôt, dans <SPAWN_CONFIG ou ~/.spawn>/runtime/<version>/
// (docs/specs/spawn-sur-spawn.md, story 1). Claude Code, OpenCode, les commandes des agents et l'app l'exécutent ;
// modifier le dépôt ne change rien à ce qui tourne tant qu'une nouvelle version n'est pas installée.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { busyAgents, describeActivity } from "./activity.ts";
import { git } from "./git.ts";
import { KIT_ROOT, binDir, completeKit, embeddedNode, NODE_EXE, readCurrent, runtimeRoot } from "./location.ts";
import { CLI_PATH } from "./next.ts";
import { generateOpencode, opencodeConfigDir, type GeneratedFile } from "./opencode.ts";
import { MARKETPLACE, PLUGIN } from "./prerequisites.ts";

// Versions gardées (SGS-08) : la version active n'est jamais supprimée.
export const KEPT_VERSIONS = 3;
// Ce qui est copié du commit installé, disposition du dépôt gardée (SGS-01).
const COPIED = ["kit/core", "kit/engines", "service", "package-lock.json"];
const WORKSPACES = ["kit/core", "kit/engines/godot", "kit/engines/node", "service"];
export const EXE = process.platform === "win32" ? "spawn-game-studio.exe" : "spawn-game-studio";

const toSlash = (p: string) => p.split("\\").join("/");

export interface Output {
  code: number;
  stdout: string;
  stderr: string;
}
export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  // Sortie du programme montrée à l'utilisateur (sur stderr) au lieu d'être capturée : étapes longues.
  show?: boolean;
}
export type Exec = (program: string, args: readonly string[], o: ExecOptions) => Output;

// npm et npx sont des scripts .cmd sous Windows : ils passent par le shell, en une seule ligne (arguments sans espace).
export const exec: Exec = (program, args, o) => {
  const viaShell = process.platform === "win32" && (program === "npm" || program === "npx");
  const common: SpawnSyncOptionsWithStringEncoding = {
    cwd: o.cwd,
    env: o.env ?? process.env,
    windowsHide: true,
    timeout: o.timeoutMs ?? 120_000,
    encoding: "utf8",
    stdio: o.show ? ["ignore", 2, 2] : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  };
  const r = viaShell ? spawnSync([program, ...args].join(" "), { ...common, shell: true }) : spawnSync(program, args, common);
  if (r.error) return { code: -1, stdout: "", stderr: r.error.message };
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export interface RuntimeDeps {
  exec: Exec;
  // Vérifications du dépôt (SGS-02) : la liste des échecs, vide si tout passe.
  checks: (repo: string) => string[];
  // Construction de l'app en release (SGS-03) : le chemin de l'exécutable produit.
  buildApp: (repo: string) => string;
  // Commandes de Claude Code (SGS-04) ; null : Claude Code n'est pas mis à jour par l'outil.
  claude: ((args: readonly string[]) => Output) | null;
  log: (line: string) => void;
  // Node copié dans la version (défaut : celui qui exécute l'installation).
  node?: string;
}

const CHECKS: readonly { name: string; args: string[]; env?: Record<string, string> }[] = [
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "lint", args: ["run", "lint"] },
  { name: "tests du kit", args: ["test", "--workspace", "kit/core"], env: { SPAWN_NO_GODOT: "1" } },
  { name: "tests du service", args: ["test", "--workspace", "service"] },
];
export const CHECK_NAMES = CHECKS.map((c) => c.name);

// Claude Code lit sa config dans CLAUDE_CONFIG_DIR ; SPAWN_CLAUDE_CONFIG l'impose aux commandes lancées par l'outil.
export function claudeExec(ex: Exec = exec): (args: readonly string[]) => Output {
  return (args) => {
    const env = process.env.SPAWN_CLAUDE_CONFIG ? { ...process.env, CLAUDE_CONFIG_DIR: process.env.SPAWN_CLAUDE_CONFIG } : process.env;
    // Hors de tout projet : la commande vaut pour toutes les installations du plugin.
    return ex("claude", args, { cwd: homedir(), env, timeoutMs: 180_000 });
  };
}

export function defaultDeps(log: (line: string) => void = console.log): RuntimeDeps {
  return {
    exec,
    log,
    checks: (repo) => {
      const failures: string[] = [];
      for (const c of CHECKS) {
        log(`  ${c.name} : npm ${c.args.join(" ")}`);
        const r = exec("npm", c.args, { cwd: repo, env: { ...process.env, ...c.env }, timeoutMs: 1_800_000, show: true });
        if (r.code !== 0) failures.push(`${c.name} (npm ${c.args.join(" ")}, code ${r.code})`);
      }
      return failures;
    },
    buildApp: (repo) => {
      const r = exec("npm", ["run", "tauri", "--", "build", "--no-bundle"], { cwd: repo, timeoutMs: 3_600_000, show: true });
      const exe = join(repo, "src-tauri", "target", "release", EXE);
      if (r.code !== 0 || !existsSync(exe)) throw new Error(`construction de l'app échouée (npm run tauri -- build --no-bundle, code ${r.code}) ; ${exe} absent`);
      return exe;
    },
    claude: claudeExec(),
  };
}

export class RuntimeRefusal extends Error {}

export interface RuntimeInfo {
  version: string;
  commit: string;
  installed: string;
  repo: string;
}

export const versionDir = (version: string, root = runtimeRoot()) => join(root, version);
export const versionCore = (version: string, root = runtimeRoot()) => join(versionDir(version, root), "kit", "core");
export const versionCli = (version: string, root = runtimeRoot()) => join(versionCore(version, root), "src", "cli.ts");
export const versionMarketplace = (version: string, root = runtimeRoot()) => join(versionDir(version, root), "claude");
export const versionExe = (version: string, root = runtimeRoot()) => join(versionDir(version, root), "app", EXE);
export const versionNode = (version: string, root = runtimeRoot()) => embeddedNode(versionCore(version, root));

export function readInfo(version: string, root = runtimeRoot()): RuntimeInfo | null {
  const path = join(versionDir(version, root), "runtime.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RuntimeInfo;
  } catch {
    return null;
  }
}

// Versions installées, de la plus récente à la plus ancienne.
export function installedVersions(root = runtimeRoot()): RuntimeInfo[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((v) => readInfo(v, root))
    .filter((i): i is RuntimeInfo => i !== null)
    .sort((a, b) => b.installed.localeCompare(a.installed));
}

// `<version de package.json>+<commit court>` (SGS-01), lue dans le commit, pas dans le dossier de travail.
export function versionOf(repo: string, commit = "HEAD"): { version: string; commit: string } {
  const full = git(repo, ["rev-parse", commit]).stdout;
  const short = git(repo, ["rev-parse", "--short=7", commit]).stdout;
  const pkg = git(repo, ["show", `${commit}:package.json`]);
  if (!full || !short || pkg.code !== 0) throw new RuntimeRefusal(`${repo} : commit ou package.json illisible (${pkg.stderr || "git rev-parse"})`);
  const version = (JSON.parse(pkg.stdout) as { version?: string }).version;
  if (!version) throw new RuntimeRefusal(`${repo}/package.json : champ "version" absent`);
  return { version: `${version}+${short}`, commit: full };
}

// Sous Windows, un antivirus ou l'indexeur tient parfois un instant les exécutables tout juste copiés : le renommage
// du dossier échoue alors en EPERM, EBUSY ou EACCES. On réessaie quelques fois avant d'abandonner.
function renameWithRetry(from: string, to: string, attempts = 10): void {
  for (let i = 1; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (i >= attempts || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * i);
    }
  }
}

// Plugin Claude Code mince de la version (SGS-04) : manifeste, hooks, skills et agents dont chaque commande est un
// chemin absolu dans le runtime. Claude Code peut le copier où il veut : il ne contient aucun code à exécuter.
// `core` : les sources lues ; `written` : le kit que désignent les chemins écrits (par défaut le même).
// `node` : le Node que lancent les hooks (le Node embarqué de la version) ; sans lui, `node` du PATH.
export function generateClaudePlugin(core: string, version: string, dest: string, written = core, node?: string): GeneratedFile[] {
  const root = toSlash(written).replace(/\/$/, "");
  const absolute = (text: string) => text.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  const hooks = absolute(readFileSync(join(core, "hooks", "hooks.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(core, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  const plugin = join(dest, "plugin");
  const files: GeneratedFile[] = [
    {
      path: join(dest, ".claude-plugin", "marketplace.json"),
      content:
        JSON.stringify(
          {
            name: MARKETPLACE,
            description: `Marketplace du runtime de Spawn Game Studio, version ${version} (générée par spawn runtime install).`,
            owner: manifest.author ?? { name: "Spawn" },
            plugins: [{ name: "spawnstudio", source: "./plugin", description: manifest.description }],
          },
          null,
          2,
        ) + "\n",
    },
    { path: join(plugin, ".claude-plugin", "plugin.json"), content: JSON.stringify({ ...manifest, version }, null, 2) + "\n" },
    // Les hooks sont des lignes de commande `node "<script>" …` : on remplace `node` par le Node embarqué, entre guillemets.
    { path: join(plugin, "hooks", "hooks.json"), content: node ? hooks.replaceAll('"command": "node ', `"command": ${JSON.stringify(`"${toSlash(node)}" `).slice(0, -1)}`) : hooks },
  ];
  for (const name of readdirSync(join(core, "skills"))) {
    const source = join(core, "skills", name, "SKILL.md");
    if (existsSync(source)) files.push({ path: join(plugin, "skills", name, "SKILL.md"), content: absolute(readFileSync(source, "utf8")) });
  }
  for (const f of readdirSync(join(core, "agents")).filter((x) => x.endsWith(".md"))) {
    files.push({ path: join(plugin, "agents", f), content: absolute(readFileSync(join(core, "agents", f), "utf8")) });
  }
  return files;
}

function writeFiles(files: readonly GeneratedFile[]): void {
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content);
  }
}

interface Step {
  description: string;
  run: () => void;
}

function refuseIfBusy(): string[] {
  return busyAgents().map((a) => `un agent du runtime travaille : ${describeActivity(a)}. Attendre la fin (ou l'arrêter dans l'app), puis relancer`);
}

// Commandes Claude Code qui font désigner la version à la marketplace locale, puis reprendre le plugin (SGS-04).
export function claudeCommands(version: string, root = runtimeRoot()): string[][] {
  return [
    ["plugin", "marketplace", "add", versionMarketplace(version, root)],
    ["plugin", "marketplace", "update", MARKETPLACE],
    ["plugin", "update", PLUGIN],
  ];
}

// Lanceurs de la commande `spawn` que tapent les agents : à côté du runtime (`~/.spawn/bin`), ils désignent la version
// active par un chemin relatif à leur dossier. Les consignes n'ont ainsi aucun chemin absolu à recopier (essai du 19/11).
// Textes en ASCII : cmd.exe lit un .cmd dans la page de code de la console.
export const launcherDir = (root = runtimeRoot()) => (root === runtimeRoot() ? binDir() : join(root, "..", "bin"));

export function launchers(version: string, root = runtimeRoot()): GeneratedFile[] {
  const bin = launcherDir(root);
  const dir = relative(bin, versionDir(version, root));
  const node = existsSync(join(versionDir(version, root), "node", NODE_EXE)) ? join(dir, "node", NODE_EXE) : null;
  const cli = join(dir, "kit", "core", "src", "cli.ts");
  const win = (p: string) => `"%~dp0${p.replaceAll("/", "\\")}"`;
  const sh = (p: string) => `"$d/${p.replaceAll("\\", "/")}"`;
  return [
    {
      path: join(bin, "spawn.cmd"),
      content: `@echo off\r\nrem Genere par spawn runtime : ne pas modifier. Lance Spawn ${version}.\r\n${node ? win(node) : "node"} ${win(cli)} %*\r\nexit /b %errorlevel%\r\n`,
    },
    {
      path: join(bin, "spawn"),
      content: `#!/bin/sh\n# Genere par spawn runtime : ne pas modifier. Lance Spawn ${version}.\nd=$(dirname "$0")\nexec ${node ? sh(node) : "node"} ${sh(cli)} "$@"\n`,
    },
  ];
}

const quote = (a: string) => (/[\s"]/.test(a) ? `"${a}"` : a);
const shown = (args: readonly string[]) => `claude ${args.map(quote).join(" ")}`;

function activationSteps(version: string, deps: RuntimeDeps, root: string, problems: string[]): Step[] {
  const core = versionCore(version, root);
  const steps: Step[] = [
    {
      description: `version active : ${version} (${join(root, "current.json")})`,
      run: () => writeFileSync(join(root, "current.json"), JSON.stringify({ version, since: new Date().toISOString() }, null, 2) + "\n"),
    },
  ];
  const opencode = opencodeConfigDir();
  if (existsSync(opencode)) {
    steps.push({
      description: `couche OpenCode régénérée depuis ${core} dans ${opencode} (plugin de périmètre, skills, agents)`,
      run: () => writeFiles(generateOpencode(opencode, core)),
    });
  } else {
    steps.push({ description: `OpenCode : ${opencode} absent, couche non installée (spawn prerequisites --install --agent opencode le fera)`, run: () => {} });
  }
  const commands = claudeCommands(version, root);
  steps.push({
    description: `Claude Code : la marketplace ${MARKETPLACE} désigne ${versionMarketplace(version, root)}, puis le plugin est repris (${commands.map(shown).join(" ; ")})`,
    run: () => {
      const claude = deps.claude;
      if (claude === null) {
        problems.push(`Claude Code non mis à jour ; taper : ${commands.map(shown).join(" ; ")}`);
        return;
      }
      for (const args of commands) {
        // Un plugin jamais installé (il s'installe par projet) n'a rien à reprendre.
        if (args[1] === "update" && !installedPlugin(claude)) {
          deps.log(`  ${PLUGIN} n'est installé dans aucun projet : rien à reprendre (spawn prerequisites --install dans un projet)`);
          continue;
        }
        const r = claude(args);
        if (r.code !== 0) {
          problems.push(`Claude Code : « ${shown(args)} » a échoué (${(r.stderr || r.stdout).trim().split(/\r?\n/)[0] ?? `code ${r.code}`}) ; taper : ${commands.map(shown).join(" ; ")}`);
          return;
        }
      }
      deps.log("  Claude Code à jour : relancer les sessions ouvertes pour qu'elles prennent la version");
    },
  });
  const bin = launcherDir(root);
  steps.push({ description: `commande spawn : ${bin} (spawn.cmd, spawn), vers ${version}`, run: () => writeFiles(launchers(version, root)) });
  steps.push({ description: `app : ${versionExe(version, root)} (elle démarre ${join(versionDir(version, root), "service", "src", "main.ts")})`, run: () => {} });
  return steps;
}

function installedPlugin(claude: (args: readonly string[]) => Output): boolean {
  const r = claude(["plugin", "list", "--json"]);
  if (r.code !== 0) return true;
  try {
    return (JSON.parse(r.stdout) as { id: string }[]).some((p) => p.id === PLUGIN);
  } catch {
    return true;
  }
}

function report(title: string, refusals: readonly string[], steps: readonly Step[], dryRun: boolean, log: (l: string) => void): void {
  log(title);
  for (const r of refusals) log(`refusé : ${r}`);
  if (dryRun) {
    log(`actions${refusals.length > 0 ? " (après correction des refus)" : ""}, rien n'est fait (--dry-run) :`);
    steps.forEach((s, i) => log(`  ${i + 1}. ${s.description}`));
  }
}

function execute(steps: readonly Step[], log: (l: string) => void): void {
  steps.forEach((s, i) => {
    log(`${i + 1}/${steps.length} ${s.description}`);
    s.run();
  });
}

export interface InstallOptions {
  repo: string;
  dryRun?: boolean;
  root?: string;
}

// SGS-01 à SGS-05 : copie du commit, dépendances de production, app, plugin Claude Code, tag, activation, ménage.
export function install(o: InstallOptions, deps: RuntimeDeps): number {
  const root = o.root ?? runtimeRoot();
  const log = deps.log;
  if (!existsSync(join(o.repo, ".git"))) {
    log(`refusé : ${o.repo} n'est pas le dépôt de Spawn ; lancer depuis le dépôt : node "<dépôt>/kit/core/src/cli.ts" runtime install`);
    return 1;
  }
  const refusals = refuseIfBusy();
  const dirty = git(o.repo, ["status", "--porcelain"]).stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (dirty.length > 0) {
    refusals.push(`le dépôt ${o.repo} a des changements non commités (${dirty.slice(0, 8).join(", ")}${dirty.length > 8 ? `, et ${dirty.length - 8} autre(s)` : ""}) ; rien n'est installé qui ne soit dans un commit : commiter, puis relancer`);
  }
  const { version, commit } = versionOf(o.repo);
  const dir = versionDir(version, root);
  const partial = `${dir}.partial`;
  const already = readInfo(version, root) !== null;
  const tag = `runtime-${version}`;
  const steps: Step[] = [];
  const problems: string[] = [];

  if (already) {
    steps.push({ description: `${version} déjà installée dans ${dir} : copie, vérifications et construction sautées`, run: () => {} });
  } else {
    steps.push({
      description: `vérifications du dépôt : ${CHECK_NAMES.join(", ")} (SPAWN_NO_GODOT=1 pour les tests du kit)`,
      run: () => {
        const failures = deps.checks(o.repo);
        if (failures.length > 0) throw new RuntimeRefusal(`vérifications en échec : ${failures.join(" ; ")}. Corriger, commiter, puis relancer`);
      },
    });
    steps.push({
      description: `copie de ${COPIED.join(", ")} du commit ${commit.slice(0, 10)} dans ${partial} (git archive)`,
      run: () => {
        rmSync(partial, { recursive: true, force: true, maxRetries: 5 });
        mkdirSync(partial, { recursive: true });
        const archive = deps.exec("git", ["archive", "--format=tar", "-o", join(partial, "commit.tar"), commit, ...COPIED], { cwd: o.repo });
        if (archive.code !== 0) throw new Error(`git archive : ${archive.stderr.trim()}`);
        // Nom relatif et dossier courant : le tar de Git lit « C: » comme un hôte distant.
        const tar = deps.exec("tar", ["-xf", "commit.tar"], { cwd: partial });
        if (tar.code !== 0) throw new Error(`tar : ${tar.stderr.trim()}`);
        rmSync(join(partial, "commit.tar"));
      },
    });
    steps.push({
      description: "dépendances de production : package.json du runtime (espaces de travail du kit et du service), npm install --omit=dev --ignore-scripts",
      run: () => {
        const pkg = { name: "spawn-runtime", private: true, version, type: "module", workspaces: WORKSPACES };
        writeFileSync(join(partial, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
        const r = deps.exec("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: partial, timeoutMs: 600_000 });
        if (r.code !== 0) throw new Error(`npm install : ${(r.stderr || r.stdout).trim().slice(-800)}`);
      },
    });
    steps.push({
      description: `app construite en release (npm run tauri -- build --no-bundle dans ${o.repo}), exécutable copié dans ${join(partial, "app", EXE)}`,
      run: () => {
        const exe = deps.buildApp(o.repo);
        mkdirSync(join(partial, "app"), { recursive: true });
        copyFileSync(exe, join(partial, "app", EXE));
      },
    });
    const node = deps.node ?? process.execPath;
    steps.push({
      description: `Node embarqué (${process.version}) : ${node} copié dans ${join(partial, "node", NODE_EXE)} ; l'app, les hooks et les agents lancés par l'app l'utilisent`,
      run: () => {
        mkdirSync(join(partial, "node"), { recursive: true });
        copyFileSync(node, join(partial, "node", NODE_EXE));
      },
    });
    steps.push({
      description: `plugin Claude Code de la version, chemins absolus vers ${versionCore(version, root)} : ${versionMarketplace(version, root)}`,
      run: () => writeFiles(generateClaudePlugin(join(partial, "kit", "core"), version, join(partial, "claude"), versionCore(version, root), versionNode(version, root))),
    });
    steps.push({
      description: `version notée (runtime.json) et mise en place : ${dir}`,
      run: () => {
        const info: RuntimeInfo = { version, commit, installed: new Date().toISOString(), repo: o.repo };
        writeFileSync(join(partial, "runtime.json"), JSON.stringify(info, null, 2) + "\n");
        rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        renameWithRetry(partial, dir);
      },
    });
  }
  const tagged = git(o.repo, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).code === 0;
  steps.push({
    description: tagged ? `tag ${tag} déjà posé` : `tag ${tag} sur le commit ${commit.slice(0, 10)}`,
    run: () => {
      if (tagged) return;
      const r = git(o.repo, ["tag", tag, commit]);
      if (r.code !== 0) throw new Error(`git tag ${tag} : ${r.stderr}`);
    },
  });
  steps.push(...activationSteps(version, deps, root, problems));
  const kept = [version, ...installedVersions(root).map((i) => i.version).filter((v) => v !== version)];
  const active = readCurrent(root)?.version;
  const removed = kept.slice(KEPT_VERSIONS).filter((v) => v !== active);
  if (removed.length > 0) {
    steps.push({
      description: `${KEPT_VERSIONS} dernières versions gardées : suppression de ${removed.join(", ")}`,
      run: () => {
        for (const v of removed) rmSync(versionDir(v, root), { recursive: true, force: true, maxRetries: 5 });
      },
    });
  }

  report(`runtime install : ${version} (commit ${commit.slice(0, 10)}, dépôt ${o.repo}) → ${dir}`, refusals, steps, o.dryRun === true, log);
  if (refusals.length > 0) return 1;
  if (o.dryRun) return 0;
  mkdirSync(root, { recursive: true });
  try {
    execute(steps, log);
  } catch (e) {
    rmSync(partial, { recursive: true, force: true, maxRetries: 5 });
    log(`${e instanceof RuntimeRefusal ? "refusé" : "échec"} : ${(e as Error).message}`);
    return 1;
  }
  for (const p of problems) log(`à faire : ${p}`);
  log(problems.length === 0 ? `installée et active : ${version}` : `installée et active : ${version}, mais ${problems.length} composant(s) non à jour (spawn runtime status)`);
  return problems.length === 0 ? 0 : 1;
}

// SGS-08 : rend active une version déjà installée, avec les mêmes mises à jour qu'à l'installation.
export function use(version: string, o: { dryRun?: boolean; root?: string }, deps: RuntimeDeps): number {
  const root = o.root ?? runtimeRoot();
  if (readInfo(version, root) === null) {
    const known = installedVersions(root).map((i) => i.version);
    deps.log(`refusé : ${version} n'est pas installée (installées : ${known.join(", ") || "aucune"})`);
    return 1;
  }
  const problems: string[] = [];
  const steps = activationSteps(version, deps, root, problems);
  const refusals = refuseIfBusy();
  report(`runtime use : ${version} (${versionDir(version, root)})`, refusals, steps, o.dryRun === true, deps.log);
  if (refusals.length > 0) return 1;
  if (o.dryRun) return 0;
  execute(steps, deps.log);
  for (const p of problems) deps.log(`à faire : ${p}`);
  deps.log(`active : ${version}`);
  return problems.length === 0 ? 0 : 1;
}

// --- État (SGS-07) ---

export interface Component {
  name: string;
  executes: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const norm = (p: string) => {
  const r = toSlash(resolve(p)).replace(/\/$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};
const inside = (path: string, dir: string) => norm(path) === norm(dir) || norm(path).startsWith(norm(dir) + "/");

// Ce que désigne un chemin exécuté : la version active, une autre version, le dépôt, ou une copie.
export function classify(path: string, root: string, active: string | null, repos: readonly string[]): { ok: boolean; where: string } {
  if (inside(path, root)) {
    const version = toSlash(relative(root, path)).split("/")[0] ?? "";
    if (version === active) return { ok: true, where: `runtime actif (${version})` };
    return { ok: false, where: `autre version du runtime (${version})${active ? "" : " alors qu'aucune n'est active"}` };
  }
  if (repos.some((r) => inside(path, r))) return { ok: false, where: "le dépôt" };
  return { ok: false, where: "une copie hors du runtime" };
}

interface ClaudePluginEntry {
  id: string;
  version?: string;
  scope?: string;
  projectPath?: string;
  installPath?: string;
  readFromFolder?: string;
}

function json<T>(r: Output | null): T | null {
  if (r === null || r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return null;
  }
}

// Chemins de code qu'exécute un plugin Claude Code : arguments de ses hooks, outil `spawn` de ses skills.
function pluginTargets(folder: string): { hook: string | null; cli: string | null } {
  const root = toSlash(folder).replace(/\/$/, "");
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replaceAll("${CLAUDE_PLUGIN_ROOT}", root) : "");
  // Dans hooks.json, le script est entre guillemets échappés (`node \"…ts\"`) : on les déséchappe avant de chercher.
  const hook = /"([^"]*pre-tool-use\.ts)"/.exec(read(join(folder, "hooks", "hooks.json")).replaceAll('\\"', '"'))?.[1] ?? null;
  const cli = /node "([^"]*cli\.ts)"/.exec(read(join(folder, "skills", "story", "SKILL.md")))?.[1] ?? null;
  return { hook, cli };
}

export function status(o: { root?: string; claude: ((args: readonly string[]) => Output) | null }): { lines: string[]; components: Component[] } {
  const root = o.root ?? runtimeRoot();
  const current = readCurrent(root);
  const active = current?.version ?? null;
  const versions = installedVersions(root);
  const activeInfo = active ? readInfo(active, root) : null;
  const ownRepo = existsSync(join(KIT_ROOT, ".git")) ? KIT_ROOT : null;
  const repos = [...new Set([ownRepo, ...versions.map((v) => v.repo)].filter((r): r is string => !!r))];
  const repoCli = ownRepo ? join(ownRepo, "kit", "core", "src", "cli.ts") : "<dépôt>/kit/core/src/cli.ts";
  const fix = active && activeInfo ? `node "${versionCli(active, root)}" runtime use ${active}` : `node "${repoCli}" runtime install`;
  const where = (p: string) => classify(p, root, active, repos);

  const lines: string[] = [`runtime : ${root}`];
  lines.push(active ? `version active : ${active}${activeInfo ? ` (commit ${activeInfo.commit.slice(0, 10)}, installée le ${activeInfo.installed}, depuis ${activeInfo.repo})` : " (dossier absent : réinstaller)"}` : "version active : aucune (rien n'est installé dans le runtime)");
  lines.push(`versions installées : ${versions.map((v) => `${v.version}${v.version === active ? " (active)" : ""}`).join(", ") || "aucune"}`);

  const components: Component[] = [];
  const add = (c: Component) => components.push(c);

  // Claude Code : ce que la marketplace désigne, puis, par installation, le dossier lu et ce que ses hooks exécutent.
  if (o.claude === null) {
    add({ name: "Claude Code", executes: "?", ok: false, detail: "non interrogé" });
  } else {
    const markets = json<{ name: string; path?: string; installLocation?: string }[]>(o.claude(["plugin", "marketplace", "list", "--json"]));
    const plugins = json<ClaudePluginEntry[]>(o.claude(["plugin", "list", "--json"]));
    if (markets === null || plugins === null) {
      add({ name: "Claude Code", executes: "?", ok: false, detail: "claude plugin list --json illisible ou Claude Code absent" });
    } else {
      const market = markets.find((m) => m.name === MARKETPLACE);
      const marketPath = market?.path ?? market?.installLocation ?? null;
      const wanted = active ? versionMarketplace(active, root) : null;
      const marketOk = marketPath !== null && wanted !== null && norm(marketPath) === norm(wanted);
      add({
        name: `Claude Code, marketplace ${MARKETPLACE}`,
        executes: marketPath ?? "absente",
        ok: marketOk,
        detail: marketPath === null ? "non déclarée" : marketOk ? "désigne la version active" : `désigne ${where(marketPath).where}${wanted ? ` au lieu de ${wanted}` : ""}`,
        ...(marketOk ? {} : { fix }),
      });
      const entries = plugins.filter((p) => p.id === PLUGIN);
      if (entries.length === 0) add({ name: `Claude Code, plugin ${PLUGIN}`, executes: "non installé", ok: true, detail: "s'installe par projet (spawn prerequisites --install)" });
      for (const e of entries) {
        const folder = e.readFromFolder ?? e.installPath ?? "";
        const targets = folder ? pluginTargets(folder) : { hook: null, cli: null };
        const runs = targets.hook ?? folder;
        const w = where(runs);
        const copied = !e.readFromFolder;
        // Une copie du cache n'est à jour que si sa version est celle du runtime actif (SGS-04).
        const stale = copied && (active === null || e.version !== active);
        const incomplete = !completeKit(targets.hook ? resolve(dirname(targets.hook), "..", "..") : folder);
        const ok = w.ok && !stale && !incomplete;
        const how = copied ? `copie ${e.version ?? "?"} dans le cache (${e.installPath})` : `lu dans son dossier ${e.readFromFolder}${e.installPath ? ` (la copie ${e.version ?? "?"} du cache, ${e.installPath}, n'est pas lue)` : ""}`;
        add({
          name: `Claude Code, plugin (${e.scope ?? "?"}${e.projectPath ? ` ${e.projectPath}` : ""})`,
          executes: runs,
          ok,
          detail: `${how} ; hooks : ${w.where}${incomplete ? ", copie incomplète (sans kit/engines)" : ""}${stale ? `, périmé (version ${e.version ?? "?"}, active ${active ?? "aucune"})` : ""}${targets.cli ? ` ; commandes des agents : ${where(targets.cli).where} (${targets.cli})` : ""}`,
          ...(ok ? {} : { fix }),
        });
      }
    }
  }

  // OpenCode : le point d'entrée du plugin de périmètre et l'outil `spawn` des skills générés.
  const oc = opencodeConfigDir();
  const ocPlugin = join(oc, "plugins", "spawn-game-studio", "index.ts");
  if (!existsSync(ocPlugin)) {
    add({ name: "OpenCode", executes: "non installée", ok: true, detail: `${ocPlugin} absent (spawn prerequisites --install --agent opencode)` });
  } else {
    const entry = /const ENTRY = "([^"]+)"/.exec(readFileSync(ocPlugin, "utf8"))?.[1] ?? "";
    const skill = join(oc, "skills", "spawn-story", "SKILL.md");
    const cli = existsSync(skill) ? (/node "([^"]*cli\.ts)"/.exec(readFileSync(skill, "utf8"))?.[1] ?? null) : null;
    const w = where(entry);
    const wc = cli ? where(cli) : null;
    const ok = w.ok && (wc?.ok ?? true);
    add({ name: "OpenCode", executes: entry, ok, detail: `plugin de périmètre : ${w.where}${cli && wc ? ` ; commandes des agents : ${wc.where} (${cli})` : ""}`, ...(ok ? {} : { fix }) });
  }

  // App : l'exécutable de la version active et le service qu'il démarre.
  if (active) {
    const exe = versionExe(active, root);
    const service = join(versionDir(active, root), "service", "src", "main.ts");
    const node = versionNode(active, root);
    const ok = existsSync(exe) && existsSync(service) && existsSync(node);
    add({ name: "app", executes: exe, ok, detail: ok ? `démarre ${service} avec ${node}` : "exécutable, service ou Node embarqué absent de la version active : réinstaller", ...(ok ? {} : { fix: `node "${repoCli}" runtime install` }) });
  } else {
    add({ name: "app", executes: ownRepo ? join(ownRepo, "src-tauri") : "?", ok: false, detail: `aucune app du runtime ; l'app de dev démarre le service du dépôt${ownRepo ? ` (${join(ownRepo, "service", "src", "main.ts")})` : ""}`, fix });
  }

  // Commandes de cet outil : celles qu'il écrit dans spawn next, les ledgers et les messages du pilote.
  const self = CLI_PATH;
  const ws = where(self);
  add({ name: "commandes des agents (cet outil)", executes: self, ok: ws.ok, detail: ws.where, ...(ws.ok ? {} : { fix: active ? `lancer node "${versionCli(active, root)}" …` : fix }) });

  if (active) {
    const launcher = join(launcherDir(root), process.platform === "win32" ? "spawn.cmd" : "spawn");
    const text = existsSync(launcher) ? readFileSync(launcher, "utf8") : "";
    const ok = text.includes(`Lance Spawn ${active}.`);
    add({ name: "commande spawn (consignes des agents)", executes: launcher, ok, detail: ok ? `vers ${active} ; au PATH des agents lancés par Spawn` : "lanceur absent ou vers une autre version : réinstaller", ...(ok ? {} : { fix: `node "${repoCli}" runtime install` }) });
  }

  for (const a of busyAgents()) lines.push(`agent au travail : ${describeActivity(a)}`);
  for (const c of components) {
    lines.push(`${c.ok ? "ok " : "KO "} ${c.name} : ${c.executes}`);
    lines.push(`      ${c.detail}`);
    if (c.fix) lines.push(`      corriger : ${c.fix}`);
  }
  return { lines, components };
}

// Entrée de la CLI : spawn runtime install|status|use.
export function runtimeCommand(positionals: readonly string[], opts: ReadonlyMap<string, string[]>, deps: RuntimeDeps = defaultDeps()): number {
  const [sub, version] = positionals;
  const dryRun = opts.has("dry-run");
  if (sub === "install") return install({ repo: KIT_ROOT, dryRun }, deps);
  if (sub === "use") {
    if (!version) {
      deps.log(`runtime use <version> : version attendue (installées : ${installedVersions().map((i) => i.version).join(", ") || "aucune"})`);
      return 2;
    }
    return use(version, { dryRun }, deps);
  }
  if (sub === "status") {
    const s = status({ claude: deps.claude });
    for (const l of s.lines) deps.log(l);
    return s.components.every((c) => c.ok) ? 0 : 1;
  }
  deps.log("spawn runtime install [--dry-run] | status | use <version> [--dry-run]");
  return 2;
}
