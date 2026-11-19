// Lanceur des agents : la sortie d'erreur d'un agent qui refuse de démarrer est gardée (essai réel du 18/11 : un
// `--agent` introuvable n'apparaissait que comme un code 1 et une sortie vide).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { runProcess, withOwnNode } from "../src/agent/process.ts";
import { binDir } from "../src/location.ts";
import { cleanDirs, tempDir } from "./git-helper.ts";

after(cleanDirs);

test("process: stderr kept next to the output when the agent writes some, absent otherwise", async () => {
  const dir = tempDir("process");
  const failed = join(dir, "echec.jsonl");
  const code = await runProcess(process.execPath, ["-e", "process.stderr.write('agent introuvable'); process.exit(1)"], { cwd: dir, output: failed, timeoutMs: 30_000 });
  assert.equal(code, 1);
  assert.equal(readFileSync(`${failed}.stderr`, "utf8"), "agent introuvable");
  const ok = join(dir, "ok.jsonl");
  assert.equal(await runProcess(process.execPath, ["-e", "console.log('{}')"], { cwd: dir, output: ok, timeoutMs: 30_000 }), 0);
  assert.ok(!existsSync(`${ok}.stderr`));
});

test("process: the spawn launchers then the Node running Spawn come first in the agent PATH, without duplicate", () => {
  const sep = process.platform === "win32" ? ";" : ":";
  const node = join(tempDir("node"), "node.exe");
  const own = join(node, "..");
  const env = withOwnNode({ Path: ["/autre", own, "/encore"].join(sep), X: "1" }, node);
  assert.deepEqual(env.Path?.split(sep), [binDir(), own, "/autre", "/encore"]);
  assert.equal(env.X, "1");
  assert.equal(env.PATH, undefined);
});
