// Stop doit tuer tout l'arbre : sous Windows, Git Bash coupe le lien de parenté que suit `taskkill /T` (constat du 22/11 :
// suites de tests encore vivantes après la fermeture de l'app, Stop qui ne rendait jamais la main).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { runProcess } from "../src/agent/process.ts";
import { alive } from "../src/activity.ts";
import { cleanDirs, tempDir } from "./git-helper.ts";

after(cleanDirs);

const BASH = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const skip = process.platform !== "win32" || !existsSync(BASH) ? "demande Git Bash sous Windows" : false;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const slash = (p: string) => p.replaceAll("\\", "/");

// Lance un programme Windows qui lance Git Bash qui lance une feuille, comme le fait un agent.
async function tree(dir: string, name: string, command: (leaf: string) => string) {
  const pidFile = join(dir, `${name}.pid`);
  const leaf = join(dir, `${name}-leaf.mjs`);
  writeFileSync(leaf, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(() => {}, 25000);\n`);
  const parent = join(dir, `${name}.mjs`);
  const line = command(`"${slash(process.execPath)}" "${slash(leaf)}"`);
  writeFileSync(parent, `import { spawnSync } from "node:child_process";\nspawnSync(${JSON.stringify(BASH)}, ["-c", ${JSON.stringify(line)}], { stdio: "inherit", windowsHide: true });\n`);
  const controller = new AbortController();
  const done = runProcess(process.execPath, [parent], { cwd: dir, output: join(dir, `${name}.out`), timeoutMs: 60_000, signal: controller.signal });
  for (let i = 0; i < 150 && !(existsSync(pidFile) && readFileSync(pidFile, "utf8")); i++) await sleep(100);
  const pid = Number(readFileSync(pidFile, "utf8"));
  return { controller, done, pid };
}

// taskkill cite le parent de ce qu'il tue, donc l'appelant : sous Git Bash, il est lui-même dans la table de `ps`.
test("kill: Stop never kills the program that asked for it, even started from Git Bash", { skip }, () => {
  const dir = tempDir("kill-caller");
  const caller = join(dir, "caller.mjs");
  writeFileSync(
    caller,
    `import { runProcess } from ${JSON.stringify(new URL("../src/agent/process.ts", import.meta.url).href)};
const controller = new AbortController();
const done = runProcess(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { cwd: ${JSON.stringify(dir)}, output: ${JSON.stringify(join(dir, "caller.out"))}, timeoutMs: 30000, signal: controller.signal });
setTimeout(() => controller.abort(), 1000);
await done;
await new Promise((ok) => setTimeout(ok, 1500));
console.log("appelant vivant");
`,
  );
  const r = spawnSync(BASH, ["-c", `"${slash(process.execPath)}" "${slash(caller)}"; echo fin`], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.match(r.stdout, /appelant vivant/);
});

test("kill: Stop kills the descendants of a nested Git Bash and returns, without touching another tree", { skip }, async () => {
  const dir = tempDir("kill-tree");
  const nested = (leaf: string) => `sh -c '${leaf}; echo fin'; echo fin`;
  const target = await tree(dir, "cible", nested);
  const other = await tree(dir, "temoin", nested);
  try {
    target.controller.abort();
    assert.equal(await Promise.race([target.done.then(() => true), sleep(12_000).then(() => false)]), true, "Stop rend la main");
    await sleep(500);
    assert.equal(alive(target.pid), false, "la feuille est morte");
    assert.equal(alive(other.pid), true, "l'arbre d'un autre agent est intact");
  } finally {
    other.controller.abort();
    for (const pid of [target.pid, other.pid]) if (alive(pid)) process.kill(pid);
    await Promise.all([target.done, other.done]);
  }
});
