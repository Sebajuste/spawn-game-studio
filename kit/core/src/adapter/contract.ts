// Suite de contrat des adaptateurs (kit/engine-contract.md). Elle ne sait rien du moteur :
// elle juge le verdict de l'adaptateur sur les projets d'exemple dont l'issue est connue (§5).
import { mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { callAdapter, type Adapter, type CallOptions, type Response, type OptionValue } from "./call.ts";
import { FILE_CATEGORIES, OPEN_WITH, type NotApplicable, type Scenario } from "./types.ts";

export interface Finding {
  rule: string;
  detail: string;
}

export interface ContractOptions extends CallOptions {
  // Dossier vide où la suite crée ses projets d'exemple.
  workDir: string;
  // Raison de sauter les captures (outil de capture absent de la machine) ; la suite le dit par `onSkip`.
  skipCapture?: string;
  // Chaque vérification sautée (déclarée non applicable par l'adaptateur, ou capture), avec sa raison.
  onSkip?: (check: string, reason: string) => void;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(path: string): boolean {
  const buffer = Buffer.alloc(8);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, 8, 0);
  } finally {
    closeSync(fd);
  }
  return buffer.equals(PNG_SIGNATURE);
}

function numberOf(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  return typeof v === "number" ? v : null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export async function checkContract(adapter: Adapter, options: ContractOptions): Promise<Finding[]> {
  const findings: Finding[] = [];
  const report = (rule: string, detail: string) => findings.push({ rule, detail });
  // §1 : vérifications déclarées sans objet par l'adaptateur (un moteur sans scènes). Sautées, et dit.
  const declared = new Set<string>(adapter.descriptor.not_applicable ?? []);
  const applies = (check: NotApplicable): boolean => {
    if (!declared.has(check)) return true;
    options.onSkip?.(check, `déclaré non applicable par l'adaptateur ${adapter.descriptor.engine} (adapter.json, not_applicable)`);
    return false;
  };
  const captures = (check: string): boolean => {
    if (options.skipCapture === undefined) return true;
    options.onSkip?.(check, options.skipCapture);
    return false;
  };

  // Appelle, consigne les défauts de forme et rend la réponse pour les attentes de fond.
  const run = async (rule: string, subcommand: string, opts: Record<string, OptionValue> = {}): Promise<Response> => {
    const response = await callAdapter(adapter, subcommand, opts, options);
    for (const d of response.defects) report(rule, `${subcommand} : ${d}`);
    return response;
  };
  const expect = (rule: string, response: Response, ok: boolean, why: string): boolean => {
    if (response.result === null) return false;
    if (response.result.ok !== ok) {
      const errors = response.result.errors.map((e) => e.code).join(", ") || "aucune";
      report(rule, `${response.subcommand} : ok: ${response.result.ok}, attendu ${ok} : ${why} (erreurs : ${errors})`);
      return false;
    }
    return true;
  };

  // §3 : appel invalide.
  const unknown = await callAdapter(adapter, "no-such-subcommand", {}, options);
  if (unknown.result === null || unknown.exitCode !== 2 || !unknown.result.errors.some((e) => e.code === "usage")) {
    report("usage", `une sous-commande inconnue doit sortir en 2 avec l'erreur usage (code ${String(unknown.exitCode)}, ${unknown.defects.join(" ; ") || "réponse conforme"})`);
  }

  // §4 : sous-commandes sans projet.
  const prerequisites = await run("prerequisites", "prerequisites");
  expect("prerequisites", prerequisites, true, "le moteur doit être présent pour la suite de contrat");

  const types = await run("file-types", "file-types");
  if (types.result) {
    const list = types.result.data.types;
    if (!Array.isArray(list) || list.length === 0) report("file-types", "data.types vide ou absent");
    else {
      for (const t of list as Record<string, unknown>[]) {
        if (typeof t.extension !== "string" || !/^\.[a-z0-9]+$/.test(t.extension)) report("file-types", `extension invalide : ${String(t.extension)}`);
        if (!(FILE_CATEGORIES as readonly unknown[]).includes(t.category)) report("file-types", `catégorie inconnue pour ${String(t.extension)} : ${String(t.category)}`);
        if (!(OPEN_WITH as readonly unknown[]).includes(t.open)) report("file-types", `ouverture inconnue pour ${String(t.extension)} : ${String(t.open)}`);
      }
    }
  }

  const patterns = await run("git-patterns", "git-patterns");
  if (patterns.result) {
    const d = patterns.result.data;
    for (const key of ["gitignore", "gitattributes", "lfs", "lockable"]) {
      if (!isStringArray(d[key])) report("git-patterns", `data.${key} doit être un tableau de chaînes`);
    }
    if (isStringArray(d.gitignore) && d.gitignore.length === 0) report("git-patterns", "data.gitignore vide");
  }

  // `launch` n'est jugé que sur un dossier qui n'est pas un projet : un vrai lancement ouvrirait le jeu
  // et lui survivrait. Le cas réussi est couvert par les tests de chaque adaptateur.
  const notAProject = join(options.workDir, "not-a-project");
  mkdirSync(notAProject, { recursive: true });
  expect("launch", await run("launch", "launch", { project: notAProject }), false, "le dossier n'est pas un projet");

  // Nouveau projet : création, puis refus d'un second passage.
  if (applies("new-project")) {
    const newDir = join(options.workDir, "new-project");
    mkdirSync(newDir, { recursive: true });
    const created = await run("new-project", "new-project", { project: newDir, name: "contract-check", exclude: [".spawn"] });
    expect("new-project", created, true, "le dossier est vide");
    const again = await run("new-project", "new-project", { project: newDir, name: "contract-check" });
    if (expect("new-project", again, false, "le projet existe déjà") && !again.result?.errors.some((e) => e.code === "project-exists")) {
      report("new-project", "un second passage doit porter l'erreur project-exists");
    }
  }

  // §5 : scénarios.
  const example = async (scenario: Scenario) => {
    if (scenario !== "healthy" && !applies(scenario)) return null;
    const dir = join(options.workDir, scenario);
    mkdirSync(dir, { recursive: true });
    const r = await run(`example ${scenario}`, "example", { project: dir, scenario });
    if (!expect(`example ${scenario}`, r, true, "la création d'un exemple doit réussir") || !r.result) return null;
    const scene = r.result.data.scene;
    if (typeof scene !== "string" || scene.length === 0) {
      report(`example ${scenario}`, "data.scene absent");
      return null;
    }
    return { dir, scene };
  };

  const healthy = await example("healthy");
  if (healthy) {
    const rule = "scenario healthy";
    const prep = await run(rule, "prepare-worktree", { project: healthy.dir });
    expect(rule, prep, true, "le projet est sain");
    const prep2 = await run(rule, "prepare-worktree", { project: healthy.dir });
    expect(rule, prep2, true, "prepare-worktree doit être idempotent");
    const compiled = await run(rule, "compile", { project: healthy.dir });
    // Un moteur sans scènes (`invalid-scene` sans objet) n'en vérifie aucune.
    if (expect(rule, compiled, true, "le code est sain") && compiled.result && !declared.has("invalid-scene")) {
      const scenes = numberOf(compiled.result.data, "scenes_checked");
      if (scenes === null || scenes < 1) report(rule, `compile : data.scenes_checked doit être au moins 1 (${String(scenes)})`);
    }
    const tests = await run(rule, "test", { project: healthy.dir });
    if (expect(rule, tests, true, "les tests sont verts") && tests.result) {
      const passed = numberOf(tests.result.data, "passed");
      if (passed === null || passed < 1) report(rule, `test : data.passed doit être au moins 1 (${String(passed)})`);
      const endToEnd = tests.result.data.end_to_end;
      if (!isStringArray(endToEnd) || endToEnd.length === 0) {
        report(rule, `test : data.end_to_end doit citer le test qui charge la scène principale (${JSON.stringify(endToEnd)})`);
      }
    }
    const smokeTest = await run(rule, "smoke-test", { project: healthy.dir });
    if (expect(rule, smokeTest, true, "la scène principale tourne sans erreur") && smokeTest.result) {
      if (typeof smokeTest.result.data.scene !== "string") report(rule, "smoke-test : data.scene absent");
    }
    if (captures("scenario healthy : capture")) {
      const output = join(options.workDir, "capture-healthy.png");
      const capture = await run(rule, "capture", { project: healthy.dir, scene: healthy.scene, output });
      if (expect(rule, capture, true, "la scène est saine") && capture.result) {
        const image = capture.result.artifacts.find((a) => a.role === "capture");
        if (!image) report(rule, "capture : aucun artefact de rôle capture");
        else if (capture.defects.length === 0 && !isPng(image.path)) report(rule, `capture : ${image.path} n'est pas un PNG`);
      }
    }
    if (compiled.result?.log) {
      const reread = await run(rule, "read-log", { file: compiled.result.log });
      expect(rule, reread, true, "le journal d'une compilation saine ne contient pas d'erreur");
    }
  }

  const codeError = await example("code-error");
  if (codeError) {
    const rule = "scenario code-error";
    const compiled = await run(rule, "compile", { project: codeError.dir });
    if (expect(rule, compiled, false, "un script ne compile pas") && compiled.result) {
      if (!compiled.result.errors.some((e) => e.file !== undefined && e.line !== undefined)) {
        report(rule, "compile : aucune erreur ne porte file et line");
      }
    }
  }

  const runtimeError = await example("runtime-error");
  if (runtimeError) {
    const rule = "scenario runtime-error";
    const compiled = await run(rule, "compile", { project: runtimeError.dir });
    expect(rule, compiled, true, "le code compile");
    expect(rule, await run(rule, "smoke-test", { project: runtimeError.dir }), false, "la scène principale lève une erreur de script");
    if (captures("scenario runtime-error : capture")) {
      const output = join(options.workDir, "capture-runtime-error.png");
      const capture = await run(rule, "capture", { project: runtimeError.dir, scene: runtimeError.scene, output });
      expect(rule, capture, false, "la scène lève une erreur de script à l'exécution");
      if (capture.result?.log) {
        const reread = await run(rule, "read-log", { file: capture.result.log });
        expect(rule, reread, false, "le journal contient l'erreur d'exécution");
      }
    }
  }

  const failingTest = await example("failing-test");
  if (failingTest) {
    const rule = "scenario failing-test";
    const tests = await run(rule, "test", { project: failingTest.dir });
    if (expect(rule, tests, false, "un test est rouge") && tests.result) {
      const failed = numberOf(tests.result.data, "failed");
      if (failed === null || failed < 1) report(rule, `test : data.failed doit être au moins 1 (${String(failed)})`);
    }
  }

  const notLoaded = await example("test-not-loaded");
  if (notLoaded) {
    const tests = await run("scenario test-not-loaded", "test", { project: notLoaded.dir });
    expect("scenario test-not-loaded", tests, false, "un fichier de test ne se charge pas");
  }

  const noTests = await example("no-tests");
  if (noTests) {
    const rule = "scenario no-tests";
    const tests = await run(rule, "test", { project: noTests.dir });
    if (expect(rule, tests, false, "aucun test n'existe") && !tests.result?.errors.some((e) => e.code === "no-tests")) {
      report(rule, "test : l'erreur no-tests est attendue");
    }
  }

  const invalidScene = await example("invalid-scene");
  if (invalidScene) {
    const rule = "scenario invalid-scene";
    const compiled = await run(rule, "compile", { project: invalidScene.dir });
    if (expect(rule, compiled, false, "une scène ne se charge pas, même si tout le code compile") && compiled.result) {
      if (!compiled.result.errors.some((e) => e.code === "invalid-scene" && e.file !== undefined)) {
        report(rule, "compile : l'erreur invalid-scene, avec file, est attendue");
      }
    }
  }

  const noMainScene = await example("no-main-scene");
  if (noMainScene) {
    const rule = "scenario no-main-scene";
    const smokeTest = await run(rule, "smoke-test", { project: noMainScene.dir });
    if (expect(rule, smokeTest, false, "le projet ne déclare pas de scène principale") && !smokeTest.result?.errors.some((e) => e.code === "main-scene-missing")) {
      report(rule, "smoke-test : l'erreur main-scene-missing est attendue");
    }
    const tests = await run(rule, "test", { project: noMainScene.dir });
    if (expect(rule, tests, true, "les tests sont verts") && tests.result) {
      const endToEnd = tests.result.data.end_to_end;
      if (!isStringArray(endToEnd) || endToEnd.length > 0) {
        report(rule, `test : sans scène principale, data.end_to_end doit être vide (${JSON.stringify(endToEnd)})`);
      }
    }
  }

  const emptyMainScene = await example("empty-main-scene");
  if (emptyMainScene) {
    const rule = "scenario empty-main-scene";
    const smokeTest = await run(rule, "smoke-test", { project: emptyMainScene.dir });
    if (expect(rule, smokeTest, false, "la scène principale ne contient aucun code") && !smokeTest.result?.errors.some((e) => e.code === "main-scene-empty")) {
      report(rule, "smoke-test : l'erreur main-scene-empty est attendue");
    }
  }

  return findings;
}
