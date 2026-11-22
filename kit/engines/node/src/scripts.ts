// Section `node` de spawn.json déduite des scripts d'un package.json existant (adoption d'un projet).
import type { AdoptGap } from "../../../core/src/adapter/types.ts";
import type { NodeConfig } from "./project.ts";

// Script de test que pose `npm init` : il échoue toujours, ce n'est pas une suite de tests.
const NPM_INIT_TEST = /no test specified/;
// Lanceurs dont l'adaptateur sait lire le résumé ; un script qui délègue aux espaces de travail est cru sur parole.
const KNOWN_RUNNER = /\bnode\b[^&|;]*--test\b|\bvitest\b|\bjest\b|--workspaces?\b/;

export const FIRST_TEST = "test/spawn.test.mjs";
export const FIRST_TEST_SCRIPT = 'node --test "test/**/*.test.mjs"';

export function hasTestScript(scripts: Readonly<Record<string, string>>): boolean {
  const t = scripts.test;
  return t !== undefined && !NPM_INIT_TEST.test(t);
}

// compile ← typecheck, lint, build (dans cet ordre) ; test ← test ; launch ← dev, sinon start ; smoke_test ← smoke.
export function declareFromScripts(scripts: Readonly<Record<string, string>>): NodeConfig {
  const has = (name: string) => Object.hasOwn(scripts, name);
  const config: NodeConfig = {};
  const compile = ["typecheck", "lint", "build"].filter(has);
  if (compile.length > 0) config.compile = compile;
  if (hasTestScript(scripts)) config.test = "test";
  const launch = ["dev", "start"].find(has);
  if (launch !== undefined) config.launch = launch;
  if (has("smoke")) config.smoke_test = "smoke";
  return config;
}

// Ce que l'adoption laisse à faire : dit, jamais deviné.
export function scriptGaps(config: NodeConfig, scripts: Readonly<Record<string, string>>, announcesUrl: boolean): AdoptGap[] {
  const gaps: AdoptGap[] = [];
  if (config.compile === undefined) {
    gaps.push({ code: "compile-missing", message: "aucun script typecheck, lint ou build : compile ne vérifiera rien" });
  }
  if (config.launch === undefined) {
    gaps.push({ code: "launch-missing", message: "aucun script dev ou start : ▶ Lancer et les captures sont indisponibles" });
  } else if (!announcesUrl) {
    gaps.push({
      code: "launch-protocol",
      message: `le script « ${config.launch} » doit écrire « SPAWN-URL <url> » quand l'app est prête ; aucun fichier du projet ne l'écrit`,
    });
  }
  const test = config.test === undefined ? undefined : scripts[config.test];
  if (test !== undefined && !KNOWN_RUNNER.test(test)) {
    gaps.push({ code: "test-runner-unknown", message: `le script de test « ${test} » ne lance ni le lanceur de Node, ni Vitest, ni Jest : son résumé ne sera pas lu` });
  }
  return gaps;
}
