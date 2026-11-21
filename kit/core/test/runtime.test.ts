// Runtime (docs/specs/spawn-sur-spawn.md, story 1) : tout se passe dans des dossiers jetables, avec un faux dépôt
// copié du vrai, des vérifications et une construction de l'app injectées, et un faux Claude Code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { activityDir, busyAgents, recordActivity } from "../src/activity.ts";
import { git, gitOk } from "../src/git.ts";
import { NODE_EXE, binDir, runtimeRoot } from "../src/location.ts";
import { generateOpencode } from "../src/opencode.ts";
import { PLUGIN } from "../src/prerequisites.ts";
import { EXE, exec, install, status, use, versionCli, versionDir, versionOf, type Output, type RuntimeDeps } from "../src/runtime.ts";
import { cleanDirs, commit, configure, tempDir } from "./git-helper.ts";

after(cleanDirs);

const REAL = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const slash = (p: string) => p.split("\\").join("/");

beforeEach(() => {
  process.env.SPAWN_CONFIG = tempDir("spawn-config-test-rt");
  process.env.SPAWN_OPENCODE_CONFIG = tempDir("opencode");
});

// Faux dépôt de Spawn : le kit, les adaptateurs et le service du dossier de travail, sans tests ni dépendances.
function fakeRepo(): string {
  const repo = tempDir("repo");
  const skip = (src: string) => !/[\\/](node_modules|test|trials)([\\/]|$)/.test(src.slice(REAL.length));
  for (const p of ["kit/core", "kit/engines", "service"]) cpSync(join(REAL, p), join(repo, p), { recursive: true, filter: skip });
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(REAL, f), join(repo, f));
  gitOk(repo, ["init", "--quiet", "-b", "main"]);
  configure(repo);
  gitOk(repo, ["add", "."]);
  gitOk(repo, ["commit", "--quiet", "-m", "spawn"]);
  return repo;
}

interface FakeClaude {
  calls: string[];
  market: string | null;
  run: (args: readonly string[]) => Output;
}

// Faux Claude Code : la marketplace désigne le dernier dossier ajouté ; le plugin est lu dans son dossier.
function fakeClaude(): FakeClaude {
  const c: FakeClaude = {
    calls: [],
    market: null,
    run: (args) => {
      c.calls.push(args.join(" "));
      const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
      if (args[1] === "marketplace" && args[2] === "add") {
        c.market = args[3] ?? null;
        return ok();
      }
      if (args[1] === "marketplace" && args[2] === "list") return ok(JSON.stringify(c.market ? [{ name: "spawn-game-studio", source: "directory", path: c.market }] : []));
      if (args[1] === "list") {
        if (!c.market) return ok("[]");
        const folder = join(c.market, "plugin");
        const version = (JSON.parse(readFileSync(join(folder, ".claude-plugin", "plugin.json"), "utf8")) as { version: string }).version;
        return ok(JSON.stringify([{ id: PLUGIN, version, scope: "project", projectPath: "C:/jeu", installPath: "C:/cache/x", readFromFolder: folder }]));
      }
      return ok();
    },
  };
  return c;
}

const junction = (target: string, path: string) => {
  if (!existsSync(path)) symlinkSync(target, path, "junction");
};

function fakeNode(): string {
  const node = join(tempDir("node"), "node.exe");
  writeFileSync(node, "node");
  return node;
}

function deps(o: { failures?: string[]; claude?: FakeClaude; log?: string[] } = {}): RuntimeDeps {
  const log = o.log ?? [];
  return {
    // npm install : les dépendances du vrai dépôt, par jonctions (pas de réseau ni de cache npm dans les tests).
    exec: (program, args, options) => {
      if (program === "npm" && args[0] === "install") {
        junction(join(REAL, "node_modules"), join(options.cwd, "node_modules"));
        junction(join(REAL, "kit", "core", "node_modules"), join(options.cwd, "kit", "core", "node_modules"));
        return { code: 0, stdout: "", stderr: "" };
      }
      return exec(program, args, options);
    },
    checks: () => o.failures ?? [],
    buildApp: () => {
      const exe = join(tempDir("build"), EXE);
      writeFileSync(exe, "app");
      return exe;
    },
    claude: (o.claude ?? fakeClaude()).run,
    log: (l) => log.push(l),
    // Un faux Node de quelques octets : le vrai pèse 90 Mo, copié à chaque installation.
    node: fakeNode(),
  };
}

const versions = () => (existsSync(runtimeRoot()) ? readdirSync(runtimeRoot()).filter((d) => d !== "current.json" && d !== "activity") : []);
const current = () => (JSON.parse(readFileSync(join(runtimeRoot(), "current.json"), "utf8")) as { version: string }).version;

test("install refuses a repository with uncommitted changes", () => {
  const repo = fakeRepo();
  writeFileSync(join(repo, "kit", "core", "brouillon.md"), "pas commité\n");
  const log: string[] = [];
  assert.equal(install({ repo }, deps({ log })), 1);
  assert.match(log.join("\n"), /changements non commités \(\?\? kit\/core\/brouillon\.md\)/);
  assert.deepEqual(versions(), []);
});

test("install refuses when the repository checks fail, and leaves nothing behind", () => {
  const repo = fakeRepo();
  const log: string[] = [];
  assert.equal(install({ repo }, deps({ failures: ["lint (npm run lint, code 1)"], log })), 1);
  assert.match(log.join("\n"), /refusé : vérifications en échec : lint/);
  assert.deepEqual(versions(), []);
  assert.equal(git(repo, ["tag"]).stdout, "");
});

test("install: layout, version name, tag, current.json, thin Claude plugin and OpenCode layer inside the runtime", () => {
  const repo = fakeRepo();
  const claude = fakeClaude();
  const log: string[] = [];
  assert.equal(install({ repo }, deps({ claude, log })), 0, log.join("\n"));
  const { version } = versionOf(repo);
  const short = gitOk(repo, ["rev-parse", "--short=7", "HEAD"]);
  assert.equal(version, `0.1.0+${short}`);
  const dir = versionDir(version);
  for (const p of ["kit/core/src/cli.ts", "kit/engines/godot/adapter.json", "service/src/main.ts", "package-lock.json", `app/${EXE}`, "runtime.json", "claude/.claude-plugin/marketplace.json"]) {
    assert.ok(existsSync(join(dir, p)), p);
  }
  assert.ok(!existsSync(`${dir}.partial`));
  assert.deepEqual((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { workspaces: string[] }).workspaces, ["kit/core", "kit/engines/godot", "kit/engines/node", "service"]);
  assert.equal(gitOk(repo, ["tag"]), `runtime-${version}`);
  assert.equal(current(), version);

  // Claude Code : marketplace re-désignée, puis plugin repris.
  assert.deepEqual(claude.calls, [`plugin marketplace add ${join(dir, "claude")}`, "plugin marketplace update spawn-game-studio", "plugin list --json", `plugin update ${PLUGIN}`]);
  const plugin = join(dir, "claude", "plugin");
  assert.equal((JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")) as { version: string }).version, version);
  const core = slash(join(dir, "kit", "core"));
  const texts = [join(plugin, "hooks", "hooks.json"), ...["story", "task", "review", "finish-story"].map((s) => join(plugin, "skills", s, "SKILL.md")), join(plugin, "agents", "implementer.md")].map((p) => readFileSync(p, "utf8"));
  for (const t of texts) {
    assert.doesNotMatch(t, /CLAUDE_PLUGIN_ROOT/);
    for (const other of [repo, REAL]) assert.ok(!t.includes(slash(other)) && !t.includes(other), `aucun chemin vers ${other}`);
  }
  const hooks = texts[0] ?? "";
  // Node embarqué : copié dans la version, et c'est lui que lancent les hooks (aucun Node installé n'est requis).
  const node = slash(join(dir, "node", NODE_EXE));
  assert.equal(readFileSync(node, "utf8"), "node");
  // Chaque hook est une ligne de commande : `"<node embarqué>" "<script>" [args]`.
  const commands = [...hooks.matchAll(/"command": ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1] ?? '""') as string);
  assert.ok(commands.length >= 5 && commands.every((cmd) => cmd.startsWith(`"${node}" "`)), commands.join(", "));
  const targets = commands.map((cmd) => /"([^"]+\.ts)"/.exec(cmd)?.[1] ?? "");
  assert.ok(targets.length >= 5);
  for (const t of targets) {
    assert.ok(t.startsWith(`${core}/src/hooks/`), t);
    assert.ok(existsSync(t), t);
  }
  // Skills et agents : la commande `spawn` des lanceurs, aucun chemin absolu à recopier.
  assert.match(texts[1] ?? "", /`spawn next`/);
  for (const t of texts.slice(1)) assert.doesNotMatch(t, /(^|[\s"'(`])([A-Za-z]:[\\/]|\/(Users|home|tmp)\/)/m);

  // OpenCode : la couche désigne la version installée.
  const oc = process.env.SPAWN_OPENCODE_CONFIG ?? "";
  const entry = /const ENTRY = "([^"]+)"/.exec(readFileSync(join(oc, "plugins", "spawn-game-studio", "index.ts"), "utf8"))?.[1];
  assert.equal(entry, `${core}/src/hooks/pre-tool-use.ts`);
  assert.equal(/const NODE = "([^"]+)"/.exec(readFileSync(join(oc, "plugins", "spawn-game-studio", "index.ts"), "utf8"))?.[1], node);
  assert.ok(readFileSync(join(oc, "skills", "spawn-story", "SKILL.md"), "utf8").includes("`spawn next`"));

  // État : tout ce que l'outil a mis en place désigne la version active.
  const s = status({ claude: claude.run });
  for (const name of ["Claude Code, marketplace spawn-game-studio", "Claude Code, plugin (project C:/jeu)", "OpenCode", "app"]) {
    const c = s.components.find((x) => x.name === name);
    assert.ok(c?.ok, `${name} : ${JSON.stringify(c)}`);
  }
  assert.match(s.lines.join("\n"), new RegExp(`version active : ${version.replace("+", "\\+")} \\(commit ${short}`));
});

test("commands given to agents are the spawn command, whose launchers run the active version, from the runtime and from an incomplete copy (SGS-06)", () => {
  const repo = fakeRepo();
  assert.equal(install({ repo }, deps()), 0);
  const { version } = versionOf(repo);
  const cli = versionCli(version);
  const run = (file: string) => spawnSync("node", [file, "commande-inventee"], { encoding: "utf8", env: { ...process.env } });
  assert.ok(run(cli).stderr.includes("lance spawn next"), run(cli).stderr);
  // Les lanceurs : sans chemin absolu, et ils exécutent bien la version active.
  for (const f of ["spawn.cmd", "spawn"]) {
    const text = readFileSync(join(binDir(), f), "utf8");
    assert.match(text, new RegExp(`Lance Spawn ${version.replace("+", "\\+")}\\.`));
    assert.doesNotMatch(text, /(^|[\s"'(`])([A-Za-z]:[\\/]|\/(Users|home|tmp)\/)/m, text);
  }
  // Le Node de la version de test est un faux : le vrai prend sa place pour que le lanceur exécute pour de bon.
  copyFileSync(process.execPath, join(versionDir(version), "node", NODE_EXE));
  const launcher = process.platform === "win32" ? spawnSync("cmd.exe", ["/d", "/c", join(binDir(), "spawn.cmd"), "commande-inventee"], { encoding: "utf8" }) : spawnSync("sh", [join(binDir(), "spawn"), "commande-inventee"], { encoding: "utf8" });
  assert.equal(launcher.status, 2, launcher.stderr);
  assert.match(launcher.stderr, /commande inconnue : commande-inventee/);

  // Copie du kit seul, comme le cache du plugin de Claude Code : elle désigne le runtime actif, pas elle-même.
  const copy = join(tempDir("cache"), "spawnstudio", "0.1.0");
  cpSync(join(versionDir(version), "kit", "core"), copy, { recursive: true, filter: (s) => !s.includes("node_modules") });
  junction(join(REAL, "kit", "core", "node_modules"), join(copy, "node_modules"));
  const r = run(join(copy, "src", "cli.ts"));
  assert.ok(r.stderr.includes("lance spawn next"), r.stderr);
  assert.ok(!r.stderr.includes(copy));
});

test("status flags what points to the repository, to another version or to a stale copy", () => {
  // Aucun runtime : la couche OpenCode générée depuis le dépôt est signalée, avec la commande d'installation.
  const oc = process.env.SPAWN_OPENCODE_CONFIG ?? "";
  for (const f of generateOpencode(oc)) {
    mkdirSync(join(f.path, ".."), { recursive: true });
    writeFileSync(f.path, f.content);
  }
  const stale: FakeClaude = {
    calls: [],
    market: null,
    run: (args) => ({
      code: 0,
      stderr: "",
      stdout: args[1] === "list" ? JSON.stringify([{ id: PLUGIN, version: "0.1.0", scope: "project", projectPath: "C:/jeu", installPath: join(tempDir("cache"), "0.1.0") }]) : JSON.stringify([{ name: "spawn-game-studio", path: REAL }]),
    }),
  };
  const s = status({ claude: stale.run });
  const by = (n: string) => s.components.find((c) => c.name.startsWith(n));
  assert.match(s.lines.join("\n"), /version active : aucune/);
  assert.equal(by("OpenCode")?.ok, false);
  assert.match(by("OpenCode")?.detail ?? "", /le dépôt/);
  assert.match(by("OpenCode")?.fix ?? "", /runtime install$/);
  assert.match(by("Claude Code, marketplace")?.detail ?? "", /désigne le dépôt/);
  assert.match(by("Claude Code, plugin")?.detail ?? "", /périmé \(version 0\.1\.0, active aucune\)/);
  assert.match(by("Claude Code, plugin")?.detail ?? "", /copie incomplète/);
  assert.equal(by("app")?.ok, false);
});

test("Claude Code absent: install succeeds and status says there is nothing to update", () => {
  const repo = fakeRepo();
  const calls: string[] = [];
  const absent: FakeClaude = { calls, market: null, run: (args) => (calls.push(args.join(" ")), { code: -1, stdout: "", stderr: "spawnSync claude ENOENT" }) };
  const log: string[] = [];
  assert.equal(install({ repo }, deps({ claude: absent, log })), 0, log.join("\n"));
  assert.ok(log.some((l) => l.includes("Claude Code absent")), log.join("\n"));
  const c = status({ claude: absent.run }).components.find((x) => x.name === "Claude Code");
  assert.ok(c?.ok, c?.detail);
  assert.match(c?.detail ?? "", /absent/);
});

test("three versions kept; use switches back with the same updates; unknown version refused", () => {
  const repo = fakeRepo();
  const claude = fakeClaude();
  const installed: string[] = [];
  for (let i = 1; i <= 4; i++) {
    if (i > 1) commit(repo, "kit/core/notes.md", `version ${i}\n`);
    assert.equal(install({ repo }, deps({ claude })), 0);
    installed.push(versionOf(repo).version);
  }
  assert.deepEqual(versions().sort(), installed.slice(1).sort());
  assert.equal(current(), installed[3]);

  const back = installed[1] ?? "";
  claude.calls.length = 0;
  assert.equal(use(back, {}, deps({ claude })), 0);
  assert.equal(current(), back);
  assert.equal(claude.calls[0], `plugin marketplace add ${join(versionDir(back), "claude")}`);
  const entry = /const ENTRY = "([^"]+)"/.exec(readFileSync(join(process.env.SPAWN_OPENCODE_CONFIG ?? "", "plugins", "spawn-game-studio", "index.ts"), "utf8"))?.[1];
  assert.equal(entry, `${slash(versionDir(back))}/kit/core/src/hooks/pre-tool-use.ts`);
  const s = status({ claude: claude.run });
  assert.ok(s.components.filter((c) => c.name !== "commandes des agents (cet outil)").every((c) => c.ok), s.lines.join("\n"));

  // Une autre version que l'active est signalée.
  claude.market = join(versionDir(installed[3] ?? ""), "claude");
  const other = status({ claude: claude.run }).components.find((c) => c.name.startsWith("Claude Code, plugin"));
  assert.match(other?.detail ?? "", /autre version du runtime/);

  const log: string[] = [];
  assert.equal(use("0.0.0+inconnu", {}, deps({ log })), 1);
  assert.match(log.join("\n"), /n'est pas installée/);
});

test("Claude Code not updatable from the command line: exact commands given, status flags the plugin (SGS-04)", () => {
  const repo = fakeRepo();
  const claude = fakeClaude();
  const real = claude.run;
  claude.run = (args) => (args[2] === "add" ? { code: 1, stdout: "", stderr: "refus simulé" } : real(args));
  const log: string[] = [];
  assert.equal(install({ repo }, deps({ claude, log })), 1);
  const { version } = versionOf(repo);
  assert.ok(log.join("\n").includes(`taper : claude plugin marketplace add ${join(versionDir(version), "claude")} ; claude plugin marketplace update spawn-game-studio ; claude plugin update ${PLUGIN}`), log.join("\n"));
  assert.equal(current(), version);
  const market = status({ claude: claude.run }).components.find((c) => c.name.startsWith("Claude Code, marketplace"));
  assert.equal(market?.ok, false);
  assert.match(market?.fix ?? "", new RegExp(`runtime use ${version.replace("+", "\\+")}$`));
});

test("dry run lists every action and changes nothing", () => {
  const repo = fakeRepo();
  const claude = fakeClaude();
  const log: string[] = [];
  assert.equal(install({ repo, dryRun: true }, deps({ claude, log })), 0);
  assert.match(log.join("\n"), /rien n'est fait \(--dry-run\)/);
  assert.match(log.join("\n"), /tag runtime-/);
  assert.match(log.join("\n"), /claude plugin marketplace add/);
  assert.deepEqual(versions(), []);
  assert.ok(!existsSync(join(runtimeRoot(), "current.json")));
  assert.equal(git(repo, ["tag"]).stdout, "");
  assert.deepEqual(claude.calls, []);
});

test("install and use refuse while an agent works, and say which one (SGS-09)", () => {
  const repo = fakeRepo();
  assert.equal(install({ repo }, deps()), 0);
  const { version } = versionOf(repo);

  // Un processus mort ne bloque pas.
  const dead = spawnSync("node", ["-e", ""]).pid;
  mkdirSync(activityDir(), { recursive: true });
  writeFileSync(join(activityDir(), `pilot-${dead}.json`), JSON.stringify({ kind: "pilot", pid: dead, kit: "x", since: "t", work: ["vieux"] }));
  assert.deepEqual(busyAgents(), []);

  recordActivity("service", ["projet/menu-projet"]);
  const log: string[] = [];
  assert.equal(use(version, {}, deps({ log })), 1);
  assert.match(log.join("\n"), new RegExp(`refusé : un agent du runtime travaille : service de l'app \\(conversation projet/menu-projet\\), pid ${process.pid}`));
  commit(repo, "kit/core/notes.md", "suite\n");
  assert.equal(install({ repo }, deps({ log })), 1);
  assert.equal(versions().length, 1);

  recordActivity("service", []);
  recordActivity("pilot", ["menu-projet"]);
  log.length = 0;
  assert.equal(use(version, {}, deps({ log })), 1);
  assert.match(log.join("\n"), /pilote \(fil menu-projet\)/);
  recordActivity("pilot", []);
  assert.equal(use(version, {}, deps()), 0);
});
