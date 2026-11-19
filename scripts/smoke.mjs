// Smoke test de Spawn (spawn.json, node.smoke_test) : le service démarre et répond, puis l'app se construit.
// Configuration jetable et sortie de construction dans le dossier temporaire : rien n'est écrit dans le projet.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startService } from "./service-demo.mjs";

const root = resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`smoke test : ${message}`);
  process.exit(1);
}

const { port, token, child, config } = await startService(root).catch((e) => fail(e.message));
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/modules`, { headers: { authorization: `Bearer ${token}` } });
  const modules = await response.json();
  if (response.status !== 200 || !Array.isArray(modules) || modules.length === 0) fail(`/api/modules a répondu ${response.status} : ${JSON.stringify(modules).slice(0, 200)}`);
  console.log(`service : ${modules.length} modules, réponse ${response.status}`);
} finally {
  child.stdin.end();
  rmSync(config, { recursive: true, force: true });
}

const out = mkdtempSync(join(tmpdir(), "spawn-build-"));
const build = spawnSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", out, "--emptyOutDir"], { cwd: root, stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
if (build.status !== 0) fail(`la construction de l'app a échoué (code ${build.status})`);
console.log("app : construite");
