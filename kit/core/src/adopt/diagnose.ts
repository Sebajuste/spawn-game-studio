// Diagnostic d'un dossier avant adoption (docs/adoption.md §3), en lecture seule : chaque point dit ce qui est
// déjà là, ce qui sera ajouté ou complété, ce qu'il faut savoir, ce qui bloque.
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { callAdapter, loadAdapter, type Adapter } from "../adapter/call.ts";
import type { AdoptData, AdoptGap } from "../adapter/types.ts";
import { enginesDir, loadAdapters } from "../adapters.ts";
import { detectWith, type DetectedEngine } from "./engine.ts";
import { KIT_GITIGNORE, missingGitignore, proposeTag } from "./files.ts";
import { isRepoRoot, readGitState, type GitState } from "./git.ts";
import { hooksStatus } from "./hooks.ts";
import { run, type Runner } from "../prerequisites.ts";

export type PointStatus = "ok" | "add" | "complete" | "warn" | "stop";
export type PointGroup = "git" | "engine" | "files" | "hooks" | "plugin";

export interface Point {
  status: PointStatus;
  group: PointGroup;
  label: string;
  detail?: string;
}

export interface Diagnosis {
  dir: string;
  name: string;
  // Déjà un projet Spawn : l'adoption se réduit à l'inscription.
  spawn: boolean;
  engine: string | null;
  title: string | null;
  version: string | null;
  tag: string;
  points: Point[];
  gaps: AdoptGap[];
  // Lignes de .gitignore qui manquent (kit et moteur).
  gitignore: string[];
  // Aucun point bloquant.
  ready: boolean;
}

export interface DiagnoseOptions {
  engines?: string;
  // Moteur choisi par la personne à la place de celui qui est reconnu.
  engine?: string;
  // Moteurs proposés sur cette machine (Réglages > Application) : seuls ceux-là sont essayés à la reconnaissance.
  only?: readonly string[];
  run?: Runner;
}

export const EXCLUDED = [".spawn", ".claude"];

function gitPoints(state: GitState, dir: string): Point[] {
  if (!state.repo) return [{ status: "stop", group: "git", label: "pas un dépôt git", detail: "git init, puis un premier commit de l'existant" }];
  if (!isRepoRoot(state, dir)) return [{ status: "stop", group: "git", label: "pas la racine du dépôt", detail: `racine : ${state.top}` }];
  if (!state.born) return [{ status: "stop", group: "git", label: "aucun commit", detail: "faire un premier commit de l'existant" }];
  const points: Point[] = [];
  if (state.branch === null) points.push({ status: "stop", group: "git", label: "tête détachée", detail: "extraire une branche" });
  if (state.dirty.length > 0) {
    points.push({ status: "stop", group: "git", label: "modifications non commitées", detail: state.dirty.slice(0, 20).join(", ") + (state.dirty.length > 20 ? "…" : "") });
  } else {
    points.push({ status: "ok", group: "git", label: "arbre de travail propre" });
  }
  if (state.develop) points.push({ status: "ok", group: "git", label: "branche develop" });
  else if (state.branch !== null) points.push({ status: "add", group: "git", label: "branche develop", detail: `créée depuis ${state.branch}` });
  if (state.origin && state.originHead !== "origin/develop") {
    points.push({
      status: "warn",
      group: "git",
      label: "origin/HEAD ne pointe pas sur develop",
      detail: "rien n'est poussé ; ensuite : git push -u origin develop, puis git remote set-head origin develop",
    });
  }
  return points;
}

function hooksPoint(state: GitState): Point {
  switch (hooksStatus(state)) {
    case "kit":
      return { status: "ok", group: "hooks", label: "hooks git du kit" };
    case "other":
      return { status: "stop", group: "hooks", label: "autres hooks git", detail: `core.hooksPath = ${state.hooksPath}` };
    case "husky":
      return { status: "stop", group: "hooks", label: "hooks Husky (.husky/)", detail: "à trancher par une personne" };
    default:
      return { status: "add", group: "hooks", label: "hooks git du kit", detail: "core.hooksPath (configuration locale)" };
  }
}

async function chooseEngine(dir: string, o: DiagnoseOptions): Promise<{ adapter: Adapter; found: DetectedEngine | null } | null> {
  const engines = o.engines ?? enginesDir();
  if (o.engine) {
    const adapter = loadAdapter(join(engines, o.engine));
    return { adapter, found: await detectWith(adapter, dir) };
  }
  for (const adapter of loadAdapters(engines)) {
    if (o.only && !o.only.includes(adapter.descriptor.engine)) continue;
    const found = await detectWith(adapter, dir);
    if (found) return { adapter, found };
  }
  return null;
}

interface EngineLines {
  points: Point[];
  gaps: AdoptGap[];
  gitignore: string[];
  // L'adaptateur complète spawn.json (sa section).
  section: boolean;
}

async function enginePoints(dir: string, adapter: Adapter): Promise<EngineLines> {
  const r = await callAdapter(adapter, "adopt", { project: dir, exclude: EXCLUDED, "dry-run": true });
  if (!r.result || r.defects.length > 0) {
    return { points: [{ status: "stop", group: "engine", label: "adaptateur non conforme", detail: r.defects.join(" ; ") }], gaps: [], gitignore: [], section: false };
  }
  if (!r.result.ok) {
    const detail = r.result.errors.map((e) => e.message).join(" ; ");
    return { points: [{ status: "stop", group: "engine", label: "le moteur refuse ce dossier", detail }], gaps: [], gitignore: [], section: false };
  }
  const data = r.result.data as unknown as AdoptData;
  // spawn.json est déjà une ligne du cœur : l'adaptateur ne fait qu'y ajouter sa section.
  const points: Point[] = data.files.filter((f) => f.path !== "spawn.json").map((f) => ({ status: f.change, group: "files" as const, label: f.path }));
  const section = data.files.some((f) => f.path === "spawn.json");
  for (const g of data.gaps) points.push({ status: "warn", group: "engine", label: g.message, detail: g.code });
  const patterns = await callAdapter(adapter, "git-patterns", {});
  const gitignore = patterns.result?.ok ? ((patterns.result.data as { gitignore?: string[] }).gitignore ?? []) : [];
  return { points, gaps: data.gaps, gitignore, section };
}

export async function diagnose(dir: string, o: DiagnoseOptions = {}): Promise<Diagnosis> {
  const root = resolve(dir);
  if (!existsSync(root)) throw new Error(`dossier introuvable : ${root}`);
  const base = { dir: root, name: basename(root), tag: proposeTag(root), gaps: [] as AdoptGap[], gitignore: [] as string[] };
  if (existsSync(join(root, "spawn.json"))) {
    const points: Point[] = [{ status: "ok", group: "files", label: "déjà un projet Spawn (spawn.json)" }];
    return { ...base, spawn: true, engine: null, title: null, version: null, points, ready: true };
  }

  const state = readGitState(root);
  const points = gitPoints(state, root);
  const chosen = await chooseEngine(root, o);
  let engine: Diagnosis["engine"] = null;
  let title: Diagnosis["title"] = null;
  let version: Diagnosis["version"] = null;
  let gaps: AdoptGap[] = [];
  let gitignore: string[] = [];
  if (chosen === null) {
    points.push({ status: "stop", group: "engine", label: "aucun moteur reconnu", detail: "aucun adaptateur ne reconnaît ce dossier" });
  } else {
    engine = chosen.adapter.descriptor.engine;
    title = chosen.adapter.descriptor.title ?? engine;
    version = chosen.found?.version ?? null;
    const evidence = chosen.found?.evidence;
    points.push({ status: "ok", group: "engine", label: `${title}${version ? ` ${version}` : ""}`, ...(evidence ? { detail: evidence } : {}) });
    const e = await enginePoints(root, chosen.adapter);
    const detail = `moteur, version, préfixe, limites${e.section ? `, section ${engine}` : ""}`;
    points.push({ status: "add", group: "files", label: "spawn.json", detail });
    points.push(...e.points);
    gaps = e.gaps;
    gitignore = e.gitignore;
  }
  const missing = missingGitignore(root, [...KIT_GITIGNORE, ...gitignore]);
  const hasGitignore = existsSync(join(root, ".gitignore"));
  if (missing.length > 0) points.push({ status: hasGitignore ? "complete" : "add", group: "files", label: ".gitignore", detail: missing.join(" ") });
  else points.push({ status: "ok", group: "files", label: ".gitignore" });
  if (state.repo) points.push(hooksPoint(state));
  if ((o.run ?? run)("claude", ["--version"], root).code === 0) {
    points.push({ status: "add", group: "plugin", label: "plugin spawnstudio pour ce projet", detail: "seuil de compactage dans .claude/settings.json" });
  } else {
    points.push({ status: "ok", group: "plugin", label: "Claude Code absent : pas de plugin à installer" });
  }

  return { ...base, spawn: false, engine, title, version, points, gaps, gitignore: missing, ready: !points.some((p) => p.status === "stop") };
}
