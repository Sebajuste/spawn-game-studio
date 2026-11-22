// Prérequis de la machine et du projet, et installation sur accord (docs/kit-perimetre.md §3).
// Le plugin ne s'active que par projet (`--scope project`) : actif partout, son hook WorktreeCreate remplacerait
// la création de worktrees dans tous les dépôts de l'utilisateur.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { callAdapter } from "./adapter/call.ts";
import { projectAdapter, findProject } from "./project.ts";
import { KIT_ROOT } from "./location.ts";

export const PLUGIN = "spawnstudio@spawn-game-studio";
export const MARKETPLACE = "spawn-game-studio";
// Source de la marketplace locale : celle que le runtime génère pour sa version (`claude/`), sinon le dépôt.
export const MARKETPLACE_SOURCE = existsSync(join(KIT_ROOT, "claude", ".claude-plugin", "marketplace.json")) ? join(KIT_ROOT, "claude") : KIT_ROOT;
// Seuil de compactage automatique (D3, docs/kit-perimetre.md §8).
export const COMPACTION_WINDOW = "260000";

export interface Output {
  code: number;
  stdout: string;
  stderr: string;
}
export type Runner = (program: string, args: readonly string[], cwd: string) => Output;

export const run: Runner = (program, args, cwd) => {
  const r = spawnSync(program, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (r.error) return { code: -1, stdout: "", stderr: r.error.message };
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
};

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  correction?: string;
}

function versionAtLeast(version: string, minimum: readonly number[]): boolean {
  const v = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < minimum.length; i++) {
    const a = v[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

interface PluginEntry {
  id: string;
  enabled: boolean;
}

function listPlugins(cwd: string, ex: Runner): PluginEntry[] | null {
  const r = ex("claude", ["plugin", "list", "--json"], cwd);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as PluginEntry[];
  } catch {
    return null;
  }
}

function readEngineSettings(path: string): Record<string, unknown> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
}

export function projectSettingsPath(root: string): string {
  return join(root, ".claude", "settings.json");
}

export async function checkPrerequisites(cwd: string, ex: Runner = run): Promise<Check[]> {
  const checks: Check[] = [];
  const tool = (name: string, program: string, args: string[], correction: string) => {
    const r = ex(program, args, cwd);
    const ok = r.code === 0;
    checks.push({ name, ok, detail: ok ? r.stdout.trim().split(/\r?\n/)[0] ?? "" : `absent (${r.stderr.trim() || `code ${r.code}`})`, ...(ok ? {} : { correction }) });
    return ok;
  };

  const nodeOk = versionAtLeast(process.version, [22, 18]);
  checks.push({ name: "node", ok: nodeOk, detail: process.version, ...(nodeOk ? {} : { correction: "installer Node.js 22.18 ou plus récent" }) });
  tool("git", "git", ["--version"], "installer Git (Git for Windows sous Windows)");
  tool("git-lfs", "git", ["lfs", "version"], "installer Git LFS puis `git lfs install`");
  // Claude Code n'est requis que pour Claude Code : Copilot et OpenCode s'en passent, et ses contrôles ne les concernent pas.
  const claudeRun = ex("claude", ["--version"], cwd);
  const claude = claudeRun.code === 0;
  checks.push({ name: "claude", ok: true, detail: claude ? claudeRun.stdout.trim().split(/\r?\n/)[0] ?? "" : "absent (utile seulement pour Claude Code ; Copilot et OpenCode s'en passent)" });

  const project = findProject(cwd);
  if (claude) {
    // Vu du dossier de la session : un worktree ne lit que les réglages versionnés.
    const plugins = listPlugins(cwd, ex);
    const input = plugins?.find((p) => p.id === PLUGIN);
    if (project === null) {
      checks.push({ name: "plugin", ok: true, detail: input ? "installé (activé par projet)" : "non installé : il s'installe par projet" });
    } else {
      const active = input?.enabled === true;
      checks.push({
        name: "plugin",
        ok: active,
        detail: active ? `${PLUGIN} actif dans ce projet` : `${PLUGIN} inactif dans ce projet : ni hook de périmètre, ni worktree préparé`,
        ...(active ? {} : { correction: "spawn prerequisites --install" }),
      });
    }
  }

  // Les réglages de Claude Code comptent quand Claude Code est là, ou que le projet en porte déjà.
  if (project !== null && (claude || existsSync(projectSettingsPath(project.root)))) {
    // Un worktree n'hérite que des fichiers versionnés : des réglages non commités laissent les fils sans plugin.
    // Les réglages qui comptent sont ceux du checkout de la session (worktree ou racine), pas ceux de la racine.
    const toplevel = ex("git", ["rev-parse", "--show-toplevel"], cwd);
    const session = toplevel.code === 0 && toplevel.stdout.trim() ? toplevel.stdout.trim() : project.root;
    const tracked = ex("git", ["ls-files", "--error-unmatch", ".claude/settings.json"], session).code === 0;
    checks.push({
      name: "réglages versionnés",
      ok: tracked,
      detail: tracked ? ".claude/settings.json suivi par git" : ".claude/settings.json non versionné : les worktrees des fils n'auront ni plugin ni hook de périmètre",
      ...(tracked ? {} : { correction: "commiter .claude/settings.json (commit initial de spawn new-project, ou par une fusion)" }),
    });
    const env = (readEngineSettings(projectSettingsPath(session)).env ?? {}) as Record<string, unknown>;
    const window = env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === COMPACTION_WINDOW;
    checks.push({
      name: "compacting",
      ok: window,
      detail: window ? `CLAUDE_CODE_AUTO_COMPACT_WINDOW = ${COMPACTION_WINDOW}` : "seuil de compactage du kit absent des réglages du projet",
      ...(window ? {} : { correction: "spawn prerequisites --install" }),
    });
  }
  if (project !== null) {
    try {
      const r = await callAdapter(projectAdapter(project), "prerequisites", { project: project.root });
      const res = r.result;
      checks.push({
        name: `moteur ${project.config.engine}`,
        ok: res?.ok === true && r.defects.length === 0,
        detail: res
          ? res.ok
            ? `${String(res.data.version ?? "?")} (attendu ${project.config.version}) : ${String(res.data.executable ?? "?")}${res.data.source ? `, trouvé par ${String(res.data.source)}` : ""}`
            : res.errors.map((e) => e.message).join(" ; ")
          : r.defects.join(" ; "),
        // Le message de l'adaptateur dit déjà quoi faire ; la correction générique ne sert qu'en dernier recours.
        ...(res?.ok ? {} : { correction: `spawn engines set ${project.config.engine} ${project.config.version} "<chemin de l'exécutable>"` }),
      });
    } catch (e) {
      checks.push({ name: `moteur ${project.config.engine}`, ok: false, detail: (e as Error).message });
    }
  }
  return checks;
}

export interface Action {
  description: string;
  // Commande à lancer, ou fichier à réécrire.
  command?: { program: string; args: string[]; cwd: string };
  file?: { path: string; before: string; after: string };
}

export function installPlan(cwd: string, ex: Runner = run): Action[] {
  const actions: Action[] = [];
  // Sans Claude Code, ni plugin ni réglages Claude : Copilot et OpenCode s'en passent, et l'adoption ne doit pas échouer.
  if (ex("claude", ["--version"], cwd).code !== 0) return actions;
  const r = ex("claude", ["plugin", "marketplace", "list", "--json"], cwd);
  const known = r.code === 0 ? (JSON.parse(r.stdout || "[]") as { name: string }[]) : [];
  if (!known.some((m) => m.name === MARKETPLACE)) {
    actions.push({
      description: `déclarer la marketplace locale ${MARKETPLACE} (${MARKETPLACE_SOURCE})`,
      command: { program: "claude", args: ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], cwd },
    });
  }
  const project = findProject(cwd);
  if (project === null) return actions;

  const plugins = listPlugins(project.root, ex);
  const input = plugins?.find((p) => p.id === PLUGIN);
  if (!input) {
    actions.push({
      description: `installer ${PLUGIN} pour ce projet`,
      command: { program: "claude", args: ["plugin", "install", PLUGIN, "--scope", "project"], cwd: project.root },
    });
  }
  // L'installation respecte `defaultEnabled: false` : il faut activer explicitement, dans ce projet seulement.
  if (!input?.enabled) {
    actions.push({
      description: `activer ${PLUGIN} dans ce projet seulement`,
      command: { program: "claude", args: ["plugin", "enable", PLUGIN, "--scope", "project"], cwd: project.root },
    });
  }
  const path = projectSettingsPath(project.root);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const settings = readEngineSettings(path);
  const env = { ...((settings.env ?? {}) as Record<string, unknown>) };
  if (env.CLAUDE_CODE_AUTO_COMPACT_WINDOW !== COMPACTION_WINDOW) {
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = COMPACTION_WINDOW;
    const after = JSON.stringify({ ...settings, env }, null, 2) + "\n";
    actions.push({ description: `seuil de compactage dans ${path}`, file: { path, before, after } });
  }
  return actions;
}

export function apply(actions: readonly Action[], ex: Runner = run): string[] {
  const failures: string[] = [];
  for (const a of actions) {
    if (a.command) {
      const r = ex(a.command.program, a.command.args, a.command.cwd);
      if (r.code !== 0) failures.push(`${a.description} : ${r.stderr.trim() || `code ${r.code}`}`);
    } else if (a.file) {
      // Relu juste avant d'écrire : la commande précédente (install --scope project) écrit le même fichier.
      const current = existsSync(a.file.path) ? (JSON.parse(readFileSync(a.file.path, "utf8")) as Record<string, unknown>) : {};
      const wanted = JSON.parse(a.file.after) as Record<string, unknown>;
      const merge = { ...current, env: { ...((current.env ?? {}) as object), ...((wanted.env ?? {}) as object) } };
      mkdirSync(dirname(a.file.path), { recursive: true });
      writeFileSync(a.file.path, JSON.stringify(merge, null, 2) + "\n");
    }
  }
  return failures;
}
