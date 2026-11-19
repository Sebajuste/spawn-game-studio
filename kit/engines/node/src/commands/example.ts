// Projets d'exemple de la suite de contrat (kit/engine-contract.md §5). Sans dépendance ni réseau : les scripts
// n'appellent que `node` (vérification de syntaxe, node:test, petit serveur http qui écrit SPAWN-URL).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExampleData, Scenario } from "../../../../core/src/adapter/types.ts";
import type { Options } from "../arguments.ts";
import { Failure, UsageError, type Report } from "../result.ts";

// Scénarios propres aux scènes, déclarés non applicables dans adapter.json.
const NOT_APPLICABLE: readonly Scenario[] = ["invalid-scene", "empty-main-scene"];
const SUPPORTED: readonly Scenario[] = ["healthy", "code-error", "runtime-error", "failing-test", "test-not-loaded", "no-tests", "no-main-scene"];
export const ROUTE = "/";

const PACKAGE = `${JSON.stringify(
  {
    name: "spawn-example",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      check: "node tools/check.mjs",
      test: 'node --test "test/**/*.test.mjs"',
      smoke: "node tools/smoke.mjs",
      start: "node src/server.mjs",
    },
  },
  null,
  2,
)}\n`;

function spawnJson(withApp: boolean): string {
  const node = withApp
    ? { compile: ["check"], test: "test", smoke_test: "smoke", launch: "start", capture: { path: ROUTE, wait_ms: 500 }, end_to_end: ["test/**/*.e2e.test.mjs"] }
    : { compile: ["check"], test: "test" };
  return `${JSON.stringify({ engine: "node", version: process.versions.node.split(".")[0], node }, null, 2)}\n`;
}

const CHECK = `// Vérifie la syntaxe de chaque fichier JavaScript (node --check) ; une erreur sort au format de Node, avec fichier et ligne.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path);
    else if (/\\.m?js$/.test(e.name)) files.push(path);
  }
};
for (const dir of ["src", "test", "tools"]) walk(dir);
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    failed++;
    process.stderr.write(r.stderr);
  }
}
console.log(\`\${files.length} fichiers vérifiés, \${failed} en erreur\`);
process.exit(failed > 0 ? 1 : 0);
`;

const APP = `export function greet(name) {
  return \`Bonjour, \${name}\`;
}

export function page() {
  return '<!doctype html><html><body style="margin:0;background:#2b6cb0;color:#fff;font:48px sans-serif"><h1>Exemple Spawn</h1><script>new EventSource("/events")</script></body></html>';
}
`;

const APP_CODE_ERROR = `export function greet(name) {
  return "Bonjour, " + ;
}
`;

const SERVER = `import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { page } from "./app.mjs";

export function start(port = 0) {
  // /events reste ouvert, comme le flux d'une vraie app : la page n'est jamais « au repos » (capture de l'essai du 18/11).
  const server = createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ouvert\\n\\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await start();
  console.log(\`SPAWN-URL http://127.0.0.1:\${server.address().port}\`);
}
`;

const SERVER_RUNTIME_ERROR = SERVER.replace(
  "export function start",
  'throw new Error("configuration absente : le serveur ne peut pas démarrer");\n\nexport function start',
);

const SMOKE = `import { start } from "../src/server.mjs";

const server = await start();
const response = await fetch(\`http://127.0.0.1:\${server.address().port}/\`);
server.close();
if (response.status !== 200) throw new Error(\`réponse \${response.status}\`);
console.log("l'app répond");
`;

const UNIT_TEST = (expected: string) => `import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../src/app.mjs";

test("greet salue par le nom", () => {
  assert.equal(greet("Ada"), "${expected}");
});
`;

const E2E_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import { start } from "../src/server.mjs";

test("l'app sert sa page d'accueil", async () => {
  const server = await start();
  try {
    const response = await fetch(\`http://127.0.0.1:\${server.address().port}/\`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Exemple Spawn/);
  } finally {
    server.close();
  }
});
`;

function scenarioFiles(scenario: Scenario): Record<string, string> {
  const base: Record<string, string> = {
    "package.json": PACKAGE,
    "spawn.json": spawnJson(scenario !== "no-main-scene"),
    "tools/check.mjs": CHECK,
    "tools/smoke.mjs": SMOKE,
    "src/app.mjs": APP,
    "src/server.mjs": SERVER,
    "test/app.test.mjs": UNIT_TEST("Bonjour, Ada"),
    "test/server.e2e.test.mjs": E2E_TEST,
  };
  switch (scenario) {
    case "code-error":
      return { ...base, "src/app.mjs": APP_CODE_ERROR };
    case "runtime-error":
      return { ...base, "src/server.mjs": SERVER_RUNTIME_ERROR };
    case "failing-test":
      return { ...base, "test/app.test.mjs": UNIT_TEST("Au revoir, Ada") };
    case "test-not-loaded":
      return { ...base, "test/broken.test.mjs": 'import { absent } from "./absent.mjs";\n\nabsent();\n' };
    case "no-tests":
      return without(base, "test/app.test.mjs", "test/server.e2e.test.mjs");
    case "no-main-scene":
      return without(base, "test/server.e2e.test.mjs", "tools/smoke.mjs");
    default:
      return base;
  }
}

function without(files: Record<string, string>, ...removed: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([k]) => !removed.includes(k)));
}

function isScenario(s: string): s is Scenario {
  return (SUPPORTED as readonly string[]).includes(s) || (NOT_APPLICABLE as readonly string[]).includes(s);
}

export function example(o: Options, r: Report): Promise<void> {
  const project = o.required("project");
  const scenario = o.required("scenario");
  if (!isScenario(scenario)) throw new UsageError(`scénario inconnu : ${scenario} (attendus : ${SUPPORTED.join(", ")})`);
  if (NOT_APPLICABLE.includes(scenario)) throw new UsageError(`scénario non applicable à l'adaptateur Node (pas de scènes) : ${scenario}`);
  if (existsSync(project) && readdirSync(project).length > 0) throw new Failure("project-exists", `dossier non vide : ${project}`);
  for (const [rel, content] of Object.entries(scenarioFiles(scenario))) {
    const path = join(project, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  r.data = { scene: ROUTE } satisfies ExampleData;
  return Promise.resolve();
}
