// Exécution dans un conteneur : validation de `node.runner` et commande docker construite.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dockerCommand } from "../src/docker.ts";
import { parseNodeSection } from "../src/project.ts";
import { Failure } from "../src/result.ts";

const runner = { type: "docker", image: "node:24-alpine" } as const;

test("node.runner : image docker acceptée, le reste refusé avec la correction", () => {
  assert.deepEqual(parseNodeSection({ runner }).runner, runner);
  for (const bad of [{ type: "podman", image: "x" }, { type: "docker" }, { type: "docker", image: "x; rm -rf /" }, { type: "docker", image: "x", cpus: 2 }, "docker"]) {
    assert.throws(() => parseNodeSection({ runner: bad }), (e: unknown) => e instanceof Failure && e.code === "spawn-json-invalid");
  }
});

test("commande docker : projet monté, conteneur nommé, install seulement avec des dépendances", () => {
  const plain = dockerCommand("C:\\p", runner, "test", 0);
  assert.equal(plain.program, "docker");
  assert.deepEqual(plain.args.slice(0, 3), ["run", "--rm", "--name"]);
  assert.match(plain.name, /^spawn-[0-9a-f]{8}$/);
  assert.ok(plain.args.includes("C:\\p:/work"));
  assert.equal(plain.args.at(-1), "npm run test");
  assert.ok(!plain.args.includes("/work/node_modules"));

  const withDeps = dockerCommand("/p", runner, "test", 3);
  assert.ok(withDeps.args.includes("/work/node_modules"));
  assert.equal(withDeps.args.at(-1), "npm ci --no-audit --no-fund && npm run test");
});
