// Tests de Spawn (spawn.json, node.test) : kit, adaptateur Node, service, puis les fonctions pures de l'app
// (src/**/*.test.ts). Les tests de l'adaptateur Godot demandent le moteur et ouvrent des fenêtres : ils restent hors de la
// vérification d'une story (SPAWN_NO_GODOT).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspaces = ["kit/core", "kit/engines/node", "service"].map((w) => `--workspace ${w}`).join(" ");
const run = spawnSync(`npm test ${workspaces}`, { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, SPAWN_NO_GODOT: "1" } });
if (run.status !== 0) process.exit(run.status ?? 1);
const app = spawnSync("npm run test:app", { cwd: root, stdio: "inherit", shell: true });
process.exit(app.status ?? 1);
