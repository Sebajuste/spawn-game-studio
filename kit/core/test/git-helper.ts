// Dépôts git jetables pour les tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOk } from "../src/git.ts";

const folders: string[] = [];

// Les tests n'écrivent jamais dans le vrai ~/.spawn (registre des projets, moteurs, config de l'app).
if (!process.env.SPAWN_CONFIG?.includes("spawn-config-test-")) {
  const config = mkdtempSync(join(tmpdir(), "spawn-config-test-"));
  folders.push(config);
  process.env.SPAWN_CONFIG = config;
}

export function cleanDirs(): void {
  for (const d of folders.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
}

export function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `spawn-${prefix}-`));
  folders.push(d);
  return d;
}

export function configure(repo: string): void {
  gitOk(repo, ["config", "user.name", "Essai"]);
  gitOk(repo, ["config", "user.email", "essai@exemple.invalid"]);
  gitOk(repo, ["config", "commit.gpgsign", "false"]);
}

export function commit(repo: string, file: string, content: string, message = `modifie ${file}`): string {
  mkdirSync(join(repo, file, ".."), { recursive: true });
  writeFileSync(join(repo, file), content);
  gitOk(repo, ["add", "--", file]);
  gitOk(repo, ["commit", "--quiet", "-m", message]);
  return gitOk(repo, ["rev-parse", "HEAD"]);
}

// Projet Spawn minimal : main, develop (en avance d'un commit), spawn.json du moteur donné.
export function spawnProject(engine = "fake"): string {
  const repo = tempDir("project");
  gitOk(repo, ["init", "--quiet", "-b", "main"]);
  configure(repo);
  writeFileSync(join(repo, ".gitignore"), ".spawn/\n.claude/worktrees/\n");
  commit(repo, "spawn.json", JSON.stringify({ engine: engine, version: "1.0" }) + "\n", "initial");
  gitOk(repo, ["add", ".gitignore"]);
  gitOk(repo, ["commit", "--quiet", "-m", "gitignore"]);
  gitOk(repo, ["branch", "develop"]);
  gitOk(repo, ["checkout", "--quiet", "develop"]);
  commit(repo, "jeu.fx", "BONJOUR\n", "premier contenu de develop");
  // Un jeu factice jouable : sa scène principale est jeu.fx (smoke test de la file de fusion).
  if (engine === "fake") commit(repo, "fake.project", "projet\nmain=jeu.fx\n", "projet factice");
  gitOk(repo, ["checkout", "--quiet", "main"]);
  return repo;
}
