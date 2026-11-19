// Lancement de Spawn pour la recette (spawn.json, node.launch) : le service de ce dossier sur une configuration jetable,
// puis l'interface (Vite) sur un port libre. Protocole de l'adaptateur Node : une ligne « SPAWN-URL <url> » quand tout
// est prêt. Le processus vit jusqu'à son arrêt par l'adaptateur (par son pid, arbre compris).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { startService } from "./service-demo.mjs";

const root = resolve(import.meta.dirname, "..");

const freePort = () =>
  new Promise((ok, ko) => {
    const server = createServer();
    server.on("error", ko);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });

const service = await startService(root);
const uiPort = await freePort();
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(uiPort), "--strictPort", "--host", "127.0.0.1"], {
  cwd: root,
  stdio: ["ignore", "inherit", "inherit"],
});
const stop = () => {
  vite.kill();
  service.child.stdin.end();
};
vite.on("exit", (code) => {
  console.error(`l'interface s'est arrêtée (code ${code})`);
  service.child.stdin.end();
  process.exit(code ?? 1);
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Prête quand Vite répond.
const url = `http://127.0.0.1:${uiPort}/`;
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    // pas encore prête
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`SPAWN-URL ${url}?port=${service.port}&token=${service.token}`);
