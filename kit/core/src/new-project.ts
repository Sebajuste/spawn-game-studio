// Création d'un projet (docs/kit-perimetre.md §4.1), sans LLM : le plugin ne s'active que dans un projet Spawn,
// une skill ne pourrait donc pas créer le premier.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callAdapter, loadAdapter, type Adapter } from "./adapter/call.ts";
import { git, gitOk } from "./git.ts";
import { apply, run, installPlan, type Runner } from "./prerequisites.ts";
import { setEngine } from "./engines.ts";
import { registryPath, register } from "./registry.ts";
import { ENGINES_DIR, DEFAULT_LIMITS } from "./project.ts";

const TEMPLATE = fileURLToPath(new URL("../template/", import.meta.url));
const GIT_HOOKS = fileURLToPath(new URL("../git-hooks/", import.meta.url));

export interface NewProjectRequest {
  name: string;
  parent: string;
  engine: string;
  version: string;
  tag: string;
  // "local" : dépôt nu à côté du projet ; "none" ; sinon l'URL d'un dépôt distant vide.
  remote: string;
  engines?: string;
  run?: Runner;
  log?: (line: string) => void;
}

export interface CreatedProject {
  root: string;
  remote: string | null;
  tests: number;
}

export function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function copyTemplate(root: string, values: Record<string, string>): void {
  cpSync(TEMPLATE, root, { recursive: true });
  const replaceIn = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) replaceIn(path);
      else if (e.name.endsWith(".md")) {
        let text = readFileSync(path, "utf8");
        for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, value);
        writeFileSync(path, text);
      }
    }
  };
  replaceIn(root);
  for (const empty of ["docs/specs", "docs/plans"]) {
    mkdirSync(join(root, empty), { recursive: true });
    writeFileSync(join(root, empty, ".gitkeep"), "");
  }
}

async function requireOk(adapter: Adapter, sub: string, options: Record<string, string | string[]>) {
  const r = await callAdapter(adapter, sub, options);
  if (!r.result || r.defects.length > 0) throw new Error(`adaptateur ${sub} non conforme : ${r.defects.join(" ; ")}`);
  if (!r.result.ok) {
    const errors = r.result.errors.map((e) => `${e.code} : ${e.message}`).join(" ; ");
    throw new Error(`${sub} a échoué : ${errors}${r.result.log ? ` (journal : ${r.result.log})` : ""}`);
  }
  return r.result;
}

export async function newProject(d: NewProjectRequest): Promise<CreatedProject> {
  const log = d.log ?? ((l: string) => console.log(l));
  const ex = d.run ?? run;
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(d.tag)) throw new Error(`préfixe d'exigences invalide : « ${d.tag} » (2 à 6 majuscules, ex. MRP)`);
  if (!/^\d+(\.\d+)*$/.test(d.version)) throw new Error(`version du moteur invalide : « ${d.version} »`);
  const dir = slug(d.name);
  if (!dir) throw new Error(`nom inutilisable : « ${d.name} »`);
  const root = join(d.parent, dir);
  if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`${root} existe déjà et n'est pas vide`);
  const adapter = loadAdapter(join(d.engines ?? ENGINES_DIR, d.engine));

  // Jusqu'au premier commit, un échec ne laisse rien derrière lui.
  mkdirSync(root, { recursive: true });
  let total: number;
  try {
    writeFileSync(join(root, "spawn.json"), JSON.stringify({ engine: d.engine, version: d.version, tag: d.tag, limits: DEFAULT_LIMITS }, null, 2) + "\n");
    copyTemplate(root, { GAME_NAME: d.name, TAG: d.tag, ENGINE: d.engine, VERSION: d.version });
    log(`modèle commun copié dans ${root}`);

    // Le moteur d'abord : introuvable, rien d'autre n'a de sens. Trouvé autrement que par le réglage machine,
    // son chemin y est retenu, sinon les sessions suivantes ne le retrouveraient pas (essai du morpion).
    const pre = (await requireOk(adapter, "prerequisites", { project: root })).data as { executable?: unknown; source?: unknown };
    if (typeof pre.executable === "string" && ["search", "path", "variable"].includes(String(pre.source))) {
      log(`${d.engine} ${d.version} retenu pour cette machine : ${setEngine(d.engine, d.version, pre.executable)}`);
    }

    await requireOk(adapter, "new-project", { project: root, name: d.name, exclude: [".spawn", ".claude"] });
    const patterns = (await requireOk(adapter, "git-patterns", {})).data as { gitignore: string[]; gitattributes: string[]; lfs: string[] };
    const lfs = patterns.lfs.length > 0 && ex("git", ["lfs", "version"], root).code === 0;
    if (patterns.lfs.length > 0 && !lfs) log("Git LFS absent : les binaires ne passeront pas par LFS (spawn prerequisites le signale)");
    writeFileSync(join(root, ".gitignore"), [".spawn/", ".claude/worktrees/", ".claude/settings.local.json", ...patterns.gitignore, ""].join("\n"));
    writeFileSync(
      join(root, ".gitattributes"),
      ["* text=auto eol=lf", ...patterns.gitattributes, ...(lfs ? patterns.lfs.map((m) => `${m} filter=lfs diff=lfs merge=lfs -text`) : []), ""].join("\n"),
    );
    log(`fichiers du moteur ${d.engine} créés`);

    gitOk(root, ["init", "--quiet", "-b", "main"]);
    gitOk(root, ["config", "core.hooksPath", GIT_HOOKS]);
    // Le plugin s'installe et s'active pour ce projet seulement ; ses réglages entrent dans le commit initial,
    // sinon les worktrees des fils ne l'auraient pas.
    const plan = installPlan(root, ex);
    const failures = apply(plan, ex);
    if (failures.length > 0) throw new Error(`installation du plugin : ${failures.join(" ; ")}`);
    log(plan.length > 0 ? "plugin spawnstudio activé pour ce projet" : "Claude Code absent : pas de plugin à installer");

    // Import et premier test avant le commit initial : l'import écrit des fichiers à versionner (`.uid` sous Godot).
    await requireOk(adapter, "prepare-worktree", { project: root });
    const tests = await requireOk(adapter, "test", { project: root });
    total = Number(tests.data.total ?? 0);
    log(`premier import fait, ${total} test(s) vert(s)`);

    gitOk(root, ["add", "-A"]);
    gitOk(root, ["commit", "--quiet", "-m", `initial : ${d.name}`]);
  } catch (e) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    throw e;
  }
  gitOk(root, ["branch", "develop"]);
  gitOk(root, ["checkout", "--quiet", "develop"]);
  log("commit initial sur main, branche develop extraite");

  let remote: string | null = null;
  if (d.remote !== "none") {
    remote = d.remote === "local" ? join(d.parent, `${dir}.git`) : d.remote;
    if (d.remote === "local") {
      if (existsSync(remote)) throw new Error(`${remote} existe déjà`);
      gitOk(d.parent, ["init", "--quiet", "--bare", remote]);
      // Un clone part de develop, et `origin/HEAD` aussi : c'est la base des worktrees (D1).
      gitOk(remote, ["symbolic-ref", "HEAD", "refs/heads/develop"]);
    }
    gitOk(root, ["remote", "add", "origin", remote]);
    gitOk(root, ["push", "--quiet", "-u", "origin", "main", "develop"]);
    gitOk(root, ["remote", "set-head", "origin", "develop"]);
    log(`dépôt distant : ${remote} (origin/HEAD → develop)`);
  }

  const dirty = git(root, ["status", "--porcelain"]).stdout;
  if (dirty) throw new Error(`le projet n'est pas propre après sa création, à examiner :\n${dirty}`);
  // Étape 7 de §4.1 : le projet apparaît dans l'app.
  register(root, d.name);
  log(`inscrit dans l'app (${registryPath()})`);
  return { root, remote, tests: total };
}
