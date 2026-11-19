// Où est Godot. Version 9.9.x : aucune installation réelle de la machine ne la porte, les vrais Godot ne gênent pas.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { search, resolveExecutable, versionMatches } from "../src/executable.ts";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "spawn-executable-"));
  dirs.push(d);
  return d;
}
function file(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  return path;
}
function project(version: string): string {
  const p = temp();
  writeFileSync(join(p, "spawn.json"), JSON.stringify({ engine: "godot", version }));
  return p;
}

// Isole l'appel : ni variable, ni PATH, réglage et dossiers de recherche du test.
function isolated<T>(env: Record<string, string>, f: () => T): T {
  const keys = ["SPAWN_GODOT", "PATH", "SPAWN_CONFIG", "SPAWN_GODOT_SEARCH"] as const;
  const before = new Map(keys.map((k) => [k, process.env[k]]));
  process.env.SPAWN_GODOT = "";
  process.env.PATH = "";
  process.env.SPAWN_CONFIG = env.SPAWN_CONFIG ?? "";
  process.env.SPAWN_GODOT_SEARCH = env.SPAWN_GODOT_SEARCH ?? "";
  if (env.SPAWN_GODOT !== undefined) process.env.SPAWN_GODOT = env.SPAWN_GODOT;
  try {
    return f();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
  }
}

test("versions: 9.9.9 matches 9.9.9 and 9.9.9.1, not 9.9.90", () => {
  assert.ok(versionMatches("9.9.9", "9.9.9"));
  assert.ok(versionMatches("9.9.9.1", "9.9.9"));
  assert.ok(!versionMatches("9.9.90", "9.9.9"));
  assert.ok(versionMatches("4.0", null));
});

test("search: the right version, unpacked archive included, non-console variant first", () => {
  const root = temp();
  const consoleExe = file(join(root, "Godot_v9.9.9-stable_win64", "Godot_v9.9.9-stable_win64_console.exe"));
  const windowExe = file(join(root, "Godot_v9.9.9-stable_win64", "Godot_v9.9.9-stable_win64.exe"));
  file(join(root, "Godot_v9.9.90-stable_win64.exe"));
  file(join(root, "other", "Godot_v9.9.9-stable_win64.exe"));
  assert.deepEqual(search("9.9.9", [root]).map((c) => c.path), [windowExe, consoleExe]);
  assert.deepEqual(search("9.9.8", [root]), []);
});

test("order: option, variable, machine setting, search; message that says what to do", () => {
  const searchDir = temp();
  const found = file(join(searchDir, "Godot_v9.9.9-stable_win64.exe"));
  const config = temp();
  const kept = file(join(temp(), "godot-kept.exe"));
  const p = project("9.9.9");
  const env = { SPAWN_CONFIG: config, SPAWN_GODOT_SEARCH: searchDir };

  assert.deepEqual(isolated(env, () => resolveExecutable(undefined, p)), { path: found, source: "search" });

  writeFileSync(join(config, "engines.json"), JSON.stringify({ godot: { "9.9.9": kept } }));
  assert.deepEqual(isolated(env, () => resolveExecutable(undefined, p)), { path: kept, source: "setting" });
  assert.deepEqual(isolated({ ...env, SPAWN_GODOT: found }, () => resolveExecutable(undefined, p)), { path: found, source: "variable" });
  assert.deepEqual(isolated(env, () => resolveExecutable(found, p)), { path: found, source: "option" });

  writeFileSync(join(config, "engines.json"), JSON.stringify({ godot: { "9.9.9": join(config, "missing.exe") } }));
  assert.throws(() => isolated(env, () => resolveExecutable(undefined, p)), /fichier absent/);

  const notFound = project("9.9.8");
  assert.throws(
    () => isolated(env, () => resolveExecutable(undefined, notFound)),
    /Godot 9\.9\.8 introuvable.*Ensuite : spawn engines set godot 9\.9\.8/,
  );
});
