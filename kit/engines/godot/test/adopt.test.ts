// detect et adopt, sans Godot ni réseau : GUT est simulé par un `addons/gut/plugin.cfg` déjà posé,
// et le cas sans GUT n'est essayé qu'en `--dry-run`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { AdoptData, DetectData } from "../../../core/src/adapter/types.ts";
import { enablePlugin, readVersion } from "../src/project-godot.ts";
import { invoke } from "./invoke.ts";

const temp = mkdtempSync(join(tmpdir(), "spawn-godot-adopt-"));
after(() => rmSync(temp, { recursive: true, force: true }));

let count = 0;
function project(files: Record<string, string>): string {
  const dir = join(temp, `p${String(count++)}`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

const BARE = '[application]\n\nconfig/name="Bare"\nconfig/features=PackedStringArray("4.7", "Forward Plus")\n';
const FAKE_GUT = { "addons/gut/plugin.cfg": '[plugin]\nversion="9.6.0"\n' };

function adopt(dir: string, ...extra: string[]): AdoptData {
  const { result } = invoke(["adopt", "--project", dir, ...extra]);
  assert.ok(result.ok, JSON.stringify(result));
  return result.data as unknown as AdoptData;
}

test("readVersion: first numeric feature, null without features", () => {
  assert.equal(readVersion(BARE), "4.7");
  assert.equal(readVersion('[application]\nconfig/features=PackedStringArray("Forward Plus", "4.3")\n'), "4.3");
  assert.equal(readVersion('[application]\nconfig/name="x"\n'), null);
  assert.equal(readVersion('[other]\nconfig/features=PackedStringArray("4.7")\n'), null);
});

test("enablePlugin: adds the section, completes the list, keeps the text when already enabled", () => {
  const gut = "res://addons/gut/plugin.cfg";
  const added = enablePlugin(BARE, gut);
  assert.ok(added.startsWith(BARE));
  assert.match(added, /\n\[editor_plugins\]\n\nenabled=PackedStringArray\("res:\/\/addons\/gut\/plugin\.cfg"\)\n$/);
  assert.equal(enablePlugin(added, gut), added);

  const other = '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n\n[rendering]\n\nx=1\n';
  assert.equal(
    enablePlugin(other, gut),
    '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg", "res://addons/gut/plugin.cfg")\n\n[rendering]\n\nx=1\n',
  );
  assert.equal(enablePlugin("[editor_plugins]\r\n\r\n[x]\r\n", gut).split("\r\n")[2], `enabled=PackedStringArray("${gut}")`);
});

test("detect: missing folder fails, other folder does not match, project.godot matches with its version", () => {
  const missing = invoke(["detect", "--project", join(temp, "missing")]);
  assert.equal(missing.result.ok, false);

  const empty = invoke(["detect", "--project", project({})]);
  assert.deepEqual(empty.result.data as unknown as DetectData, { match: false, version: null, evidence: null });

  const godot = invoke(["detect", "--project", project({ "project.godot": BARE })]);
  assert.deepEqual(godot.result.data as unknown as DetectData, { match: true, version: "4.7", evidence: "project.godot" });
});

test("adopt: empty folder is not-a-project; --dry-run takes no value", () => {
  const dir = project({});
  const { code, result } = invoke(["adopt", "--project", dir]);
  assert.equal(code, 1);
  assert.equal(result.errors[0]?.code, "not-a-project");
  assert.equal(invoke(["adopt", "--project", dir, "--dry-run=yes"]).code, 2);
});

test("adopt without GUT: --dry-run lists addons/gut and downloads nothing", () => {
  const dir = project({ "project.godot": BARE });
  const data = adopt(dir, "--dry-run");
  assert.ok(data.files.some((f) => f.path === "addons/gut" && f.change === "add"), JSON.stringify(data.files));
  assert.equal(existsSync(join(dir, "addons")), false);
});

test("adopt: dry-run writes nothing, adopt writes the same files, a second adopt does nothing", () => {
  const dir = project({ "project.godot": BARE, ...FAKE_GUT });
  const expected = [
    { path: ".gutconfig.json", change: "add" },
    { path: "project.godot", change: "complete" },
    { path: "test/test_project.gd", change: "add" },
  ];
  const dry = adopt(dir, "--dry-run");
  assert.deepEqual(dry.files, expected);
  assert.equal(dry.declared, null);
  assert.deepEqual(dry.gaps.map((g) => g.code), ["main-scene-missing"]);
  assert.equal(readFileSync(join(dir, "project.godot"), "utf8"), BARE);
  assert.equal(existsSync(join(dir, ".gutconfig.json")), false);
  assert.equal(existsSync(join(dir, "test")), false);

  assert.deepEqual(adopt(dir).files, expected);
  assert.match(readFileSync(join(dir, "project.godot"), "utf8"), /enabled=PackedStringArray\("res:\/\/addons\/gut\/plugin\.cfg"\)/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".gutconfig.json"), "utf8")).dirs, ["res://test"]);
  assert.match(readFileSync(join(dir, "test/test_project.gd"), "utf8"), /"Bare"/);

  assert.deepEqual(adopt(dir).files, []);
});

test("adopt: existing tests give the gutconfig dirs and no first test; other plugins and --exclude", () => {
  const settings = `${BARE}\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n`;
  const dir = project({
    "project.godot": settings,
    ...FAKE_GUT,
    "test/foo/test_x.gd": "extends GutTest\n",
    "addons/other/test_ignored.gd": "",
    "assets/raw/a.txt": "",
  });
  const data = adopt(dir, "--exclude", "assets/raw", "--exclude", "absent");
  assert.deepEqual(data.files, [
    { path: ".gutconfig.json", change: "add" },
    { path: "assets/raw/.gdignore", change: "add" },
    { path: "project.godot", change: "complete" },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".gutconfig.json"), "utf8")).dirs, ["res://test/foo"]);
  assert.match(
    readFileSync(join(dir, "project.godot"), "utf8"),
    /enabled=PackedStringArray\("res:\/\/addons\/other\/plugin\.cfg", "res:\/\/addons\/gut\/plugin\.cfg"\)/,
  );
  assert.ok(existsSync(join(dir, "assets/raw/.gdignore")));
  assert.equal(existsSync(join(dir, "test/test_project.gd")), false);
  assert.deepEqual(adopt(dir, "--exclude", "assets/raw").files, []);
});
