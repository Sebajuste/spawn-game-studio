// Serveur du modèle local d'OpenCode : choix par le préfixe du modèle, et vérifications d'Ollama contre un faux serveur
// (même API : /api/tags, /api/ps, /api/generate). Le vrai Ollama n'est pas exigé pour la suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { localServer, opencodeAdapter } from "../src/agent/opencode.ts";

interface Fake {
  url: string;
  loaded: { name: string; context_length?: number }[];
  generated: string[];
  close(): Promise<void>;
}

async function fakeOllama(models: string[]): Promise<Fake> {
  const fake = { loaded: [], generated: [] } as unknown as Fake;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      if (req.url === "/api/ps") return res.end(JSON.stringify({ models: fake.loaded }));
      if (req.url === "/api/generate") {
        const { model } = JSON.parse(body) as { model: string };
        fake.generated.push(model);
        fake.loaded.push({ name: model, context_length: 4096 });
        return res.end(JSON.stringify({ done: true }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  fake.url = `http://127.0.0.1:${port}`;
  fake.close = () => new Promise<void>((ok) => server.close(() => ok()));
  return fake;
}

async function withOllama<T>(fake: Fake | string, f: () => Promise<T>): Promise<T> {
  const before = process.env.SPAWN_OLLAMA_URL;
  process.env.SPAWN_OLLAMA_URL = typeof fake === "string" ? fake : fake.url;
  try {
    return await f();
  } finally {
    if (before === undefined) delete process.env.SPAWN_OLLAMA_URL;
    else process.env.SPAWN_OLLAMA_URL = before;
  }
}

test("localServer : serveur choisi par le préfixe, le reste est l'id du modèle", () => {
  assert.equal(localServer("lmstudio/qwen/qwen3.5-9b")?.server.name, "LM Studio");
  assert.equal(localServer("lmstudio/qwen/qwen3.5-9b")?.id, "qwen/qwen3.5-9b");
  assert.equal(localServer("ollama/qwen3:8b")?.server.name, "Ollama");
  assert.equal(localServer("ollama/qwen3:8b")?.id, "qwen3:8b");
  assert.equal(localServer("qwen3:8b"), null);
  assert.equal(localServer("openai/gpt"), null);
});

test("check : modèle sans serveur connu, refusé avec le nom attendu", async () => {
  const problems = await opencodeAdapter({ model: "qwen3:8b" }).check("");
  assert.match(problems.join("\n"), /lmstudio\/<modèle>.*ollama\/<modèle>/);
});

test("check Ollama : serveur arrêté, modèle absent", async () => {
  await withOllama("http://127.0.0.1:9", async () => {
    assert.match((await opencodeAdapter({ model: "ollama/qwen3:8b" }).check("")).join("\n"), /Ollama ne répond pas/);
  });
  const fake = await fakeOllama(["llama3:latest"]);
  try {
    await withOllama(fake, async () => {
      assert.match((await opencodeAdapter({ model: "ollama/qwen3:8b" }).check("")).join("\n"), /ollama pull qwen3:8b/);
    });
  } finally {
    await fake.close();
  }
});

test("check Ollama : non chargé, chargé à la demande ; contexte plus petit que le réglage, refusé et dit comment le régler", async () => {
  const fake = await fakeOllama(["qwen3:8b"]);
  try {
    await withOllama(fake, async () => {
      assert.match((await opencodeAdapter({ model: "ollama/qwen3:8b" }).check("")).join("\n"), /non chargé dans Ollama/);
      assert.deepEqual(fake.generated, [], "sans --load, rien n'est chargé");
      const problems = (await opencodeAdapter({ model: "ollama/qwen3:8b", load: true, context: 32_000 }).check("")).join("\n");
      assert.deepEqual(fake.generated, ["qwen3:8b"]);
      assert.match(problems, /4096 tokens chargés, 32000 demandés/);
      assert.match(problems, /OLLAMA_CONTEXT_LENGTH=32000/);
    });
  } finally {
    await fake.close();
  }
});

test("maxContext Ollama : contexte du modèle chargé (« :latest » implicite), null s'il ne l'est pas", async () => {
  const fake = await fakeOllama(["llama3:latest"]);
  try {
    await withOllama(fake, async () => {
      const agent = opencodeAdapter({ model: "ollama/llama3" });
      assert.equal(await agent.maxContext(""), null);
      fake.loaded.push({ name: "llama3:latest", context_length: 65_536 });
      assert.equal(await agent.maxContext(""), 65_536);
    });
  } finally {
    await fake.close();
  }
});
