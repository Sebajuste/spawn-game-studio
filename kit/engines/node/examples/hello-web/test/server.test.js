import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp, greeting } from "../server.js";

test("greeting par défaut", () => {
  assert.equal(greeting(), "Hello, world!");
});

test("le serveur répond au nom demandé", async () => {
  const server = createApp().listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/?name=Spawn`);
    assert.equal(await res.text(), "Hello, Spawn!");
  } finally {
    server.close();
  }
});
