// Relais du lancement détaché sous Windows (`startDetached`). Un processus détaché n'a pas de console : chaque
// programme console qu'il lance (le cmd.exe de `npm run`) en reçoit une neuve, que Windows Terminal affiche. Des
// fenêtres clignotaient à chaque lancement (relevé du 18/11). Le relais, lui détaché, lance npm caché et par des
// tubes : npm reçoit une console sans fenêtre, que cmd et l'app héritent. Il recopie leur sortie dans le journal et
// sort avec le code du script ; l'arrêter par son PID (arbre compris) arrête l'app.
// Usage : node relay.ts <journal> <dossier> <JSON { program, args, shell }>
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const [log, cwd, spec] = process.argv.slice(2);
if (!log || !cwd || !spec) process.exit(2);
const { program, args, shell } = JSON.parse(spec) as { program: string; args: string[]; shell: boolean };
const out = createWriteStream(log, { flags: "a" });
const child = spawn(program, args, { cwd, shell, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
child.stdout.pipe(out, { end: false });
child.stderr.pipe(out, { end: false });
child.on("error", (e) => {
  out.end(`\n# spawn: lancement impossible : ${e.message}\n`, () => process.exit(1));
});
child.on("close", (code) => {
  out.end(() => process.exit(code ?? 1));
});
