// Hello world web : le gabarit du POC « tests dans un conteneur ».
import { createServer } from "node:http";

export function greeting(name) {
  return `Hello, ${name || "world"}!`;
}

export function createApp() {
  return createServer((req, res) => {
    const name = new URL(req.url ?? "/", "http://localhost").searchParams.get("name");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(greeting(name));
  });
}
