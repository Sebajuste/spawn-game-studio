// Exécution des scripts du projet dans un conteneur (`node.runner` de spawn.json) : le projet est monté en
// volume, le verdict vient toujours de la relecture de la sortie (contrat §3), pas du code de sortie de docker.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { RunnerConfig } from "./project.ts";

export interface DockerCommand {
  program: string;
  args: string[];
  // Nom du conteneur : seul moyen de l'arrêter, tuer le client `docker` laisserait le conteneur tourner.
  name: string;
}

// Le côté conteneur est toujours /work ; un chemin Windows « C:\x » est accepté tel quel par Docker Desktop.
export function dockerCommand(project: string, runner: RunnerConfig, script: string, dependencyCount: number): DockerCommand {
  const name = `spawn-${randomBytes(4).toString("hex")}`;
  const args = ["run", "--rm", "--name", name, "-v", `${project}:/work`, "-w", "/work"];
  // node_modules de l'hôte (binaires Windows) ne doit pas masquer ceux du conteneur : volume anonyme par-dessus.
  if (dependencyCount > 0) args.push("-v", "/work/node_modules");
  args.push(runner.image);
  const install = dependencyCount > 0 ? "npm ci --no-audit --no-fund && " : "";
  args.push("sh", "-c", `${install}npm run ${script}`);
  return { program: "docker", args, name };
}

// Arrêt du conteneur par son nom (jamais par nom d'image).
export function killContainer(name: string): void {
  spawnSync("docker", ["kill", name], { stdio: "ignore", windowsHide: true });
}
