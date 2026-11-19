// Démarre le service de ce dossier sur une configuration jetable (jamais le ~/.spawn de l'utilisateur) et rend
// { port, token, child } dès sa première ligne. Partagé par le smoke test et le lancement (spawn.json, section node).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function startService(root, timeoutMs = 30_000) {
  const config = mkdtempSync(join(tmpdir(), "spawn-config-"));
  const child = spawn(process.execPath, [join(root, "service", "src", "main.ts")], {
    cwd: root,
    env: { ...process.env, SPAWN_CONFIG: config },
    stdio: ["pipe", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`le service n'a pas répondu en ${timeoutMs / 1000} s`)), timeoutMs);
    child.on("exit", (code) => reject(new Error(`le service s'est arrêté avant d'être prêt (code ${code})`)));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      child.stdout.removeAllListeners("data");
      child.stdout.resume();
      try {
        const { port, token } = JSON.parse(buffer.slice(0, end));
        resolve({ port, token, child, config });
      } catch (e) {
        reject(new Error(`première ligne du service illisible : ${buffer.slice(0, end)} (${e.message})`));
      }
    });
  });
}
