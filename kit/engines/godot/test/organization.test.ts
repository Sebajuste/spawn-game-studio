import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkOrganization } from "../src/organization.ts";

const root = mkdtempSync(join(tmpdir(), "spawn-organization-"));
after(() => rmSync(root, { recursive: true, force: true }));
function file(rel: string): void {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), "");
}

test("organization by component: well-placed files silent, misplaced ones reported with where to move them", () => {
  for (const ok of [
    "project.godot",
    "icon.svg",
    "default_bus_layout.tres",
    "core/actors/grille/grille.gd",
    "core/actors/grille/grille.tscn",
    "core/actors/grille/grille.gd.uid",
    "core/actors/grille/tests/test_grille.gd",
    "core/actors/grille/croix.png",
    "core/actors/vehicules/voiture/voiture.gd",
    "core/games/main/main.tscn",
    "core/maps/foret/foret.tscn",
    "core/systems/regles/regles.gd",
    "libs/maths/vecteurs/vecteurs.gd",
    "assets/textures/fond.png",
    "assets/materiaux/bois.tres",
    "addons/gut/gut.gd",
    "addons/gut/test/test_interne.gd",
    ".spawn/logs/engine/x.gd",
    "outils/.gdignore",
    "outils/script.gd",
    "docs/specs/s.md",
  ])
    file(ok);
  const expected: [string, RegExp][] = [
    ["scripts/plateau.gd", /hors organisation.*core\/<thème>\/plateau\/plateau\.gd/],
    ["test/test_plateau.gd", /hors organisation.*core\/<thème>\/plateau\/tests\/test_plateau\.gd/],
    ["core/plateau.gd", /directement dans core\/.*core\/<thème>\/plateau\/plateau\.gd/],
    ["core/actors/pion.gd", /directement dans core\/actors\/.*core\/actors\/pion\/pion\.gd/],
    ["core/divers/x/x.gd", /thème inconnu core\/divers/],
    ["core/actors/grille/test_bord.gd", /test hors du dossier tests\/.*core\/actors\/grille\/tests\/test_bord\.gd/],
    ["images/fond.png", /ressource brute hors de assets\//],
  ];
  for (const [rel] of expected) file(rel);

  const warnings = checkOrganization(root);
  assert.deepEqual(warnings.map((a) => a.file).sort(), expected.map(([rel]) => rel).sort(), JSON.stringify(warnings, null, 1));
  for (const [rel, pattern] of expected) {
    const a = warnings.find((x) => x.file === rel);
    assert.equal(a?.code, "organization");
    assert.match(a?.message ?? "", pattern);
    assert.match(a?.message ?? "", /ensuite : le déplacer vers/);
  }
});
