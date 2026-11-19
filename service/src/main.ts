// Point d'entrée du service : `node service/src/main.ts [--port N]`. La première ligne de stdout donne le port et le
// jeton à l'app (Tauri) ; rien d'autre n'y est écrit.
import { startService } from "./server.ts";
import { MODULES } from "./modules/index.ts";

const i = process.argv.indexOf("--port");
const port = i >= 0 ? Number(process.argv[i + 1]) : 0;
const service = await startService({ modules: MODULES, port, ...(process.env.SPAWN_TOKEN ? { token: process.env.SPAWN_TOKEN } : {}) });
process.stdout.write(JSON.stringify({ port: service.port, token: service.token }) + "\n");
console.error(`[service] http://127.0.0.1:${service.port}/ (modules actifs : ${service.states().filter((e) => e.active).map((e) => e.id).join(", ")})`);

const stop = async () => {
  await service.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// L'app ferme stdin en s'arrêtant : le service ne lui survit pas.
process.stdin.on("end", stop);
process.stdin.resume();
