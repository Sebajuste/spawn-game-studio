// Ce que l'app ouverte apprend sans recharger : un epic écrit par la conversation (« workspaces »), un projet entré ou
// sorti du registre (« projects »).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readClaude } from "../../kit/core/src/agent/claude.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { createWorkspace, readWorkspaces } from "../../kit/core/src/workspaces.ts";
import { cleanDirs, spawnProject, tempDir } from "../../kit/core/test/git-helper.ts";
import { backlogModule } from "../src/modules/backlog.ts";
import { conversationModule } from "../src/modules/conversation.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { talkModule } from "../src/modules/talk/index.ts";
import type { ServiceModule } from "../src/module.ts";
import { startService, type Service } from "../src/server.ts";
import { fakeAgent } from "./fake-agent.ts";

const FAKE_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
process.env.SPAWN_ENGINES = FAKE_ENGINES;
const services: Service[] = [];
const streams: AbortController[] = [];
after(async () => {
  for (const c of streams) c.abort();
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

async function open(modules: ServiceModule[]) {
  const s = await startService({ modules, log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of modules) if (!m.core) await api("PUT", `/api/modules/${m.id}`, { active: true });

  const controller = new AbortController();
  streams.push(controller);
  const reader = (await fetch(`http://127.0.0.1:${s.port}/api/events?token=${s.token}`, { signal: controller.signal })).body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let text = "";
  let taken = 0;
  // Les événements reçus depuis l'appel précédent, jusqu'à `last` compris. Chaque attente est bornée.
  const eventsUntil = async (last: string): Promise<string[]> => {
    const end = Date.now() + 15_000;
    for (;;) {
      const names = [...text.matchAll(/^event: (.+)\n/gm)].map((m) => m[1] ?? "").slice(taken);
      const at = names.indexOf(last);
      if (at >= 0) {
        taken += at + 1;
        return names.slice(0, at + 1);
      }
      let timer: NodeJS.Timeout | undefined;
      const read = await Promise.race([reader.read(), new Promise<null>((ok) => (timer = setTimeout(() => ok(null), Math.max(0, end - Date.now()))))]);
      clearTimeout(timer);
      if (read === null || read.done) assert.fail(`événement « ${last} » jamais reçu : ${names.join(", ")}`);
      text += decoder.decode(read.value, { stream: true });
    }
  };
  await eventsUntil("modules");
  return { api, eventsUntil };
}

const count = (names: string[], name: string) => names.filter((n) => n === name).length;

function talkAgent(replies: string[]): () => AgentAdapter {
  let n = 0;
  return () => ({
    name: "claude-code",
    async turn({ output }) {
      const text = replies[n++] ?? "Rien.";
      const lines = [
        { type: "system", subtype: "init", session_id: "s", model: "test" },
        { type: "assistant", message: { content: [{ type: "text", text }] } },
        { type: "result", subtype: "success", result: text, session_id: "s" },
      ];
      writeFileSync(output, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return { code: 0, session: "s" };
    },
    read: readClaude,
    maxContext: async () => 120_000,
    check: async () => [],
    measure: async () => null,
  });
}

test("SGS-51: an epic created by the conversation is announced, at creation then at each story", async () => {
  const replies: string[] = [];
  const conversation = conversationModule(fakeAgent().factory, { autoResume: false, autoRestart: false });
  const { api, eventsUntil } = await open([projectsModule, storiesModule, conversation, backlogModule(conversation), talkModule(conversation, talkAgent(replies))]);
  const sound = spawnProject();
  gitOk(sound, ["checkout", "--quiet", "develop"]);
  const broken = spawnProject();
  // Un fichier à la place du dossier des worktrees : toute story de ce projet échoue à sa création.
  writeFileSync(join(broken, ".claude"), "");
  const a = (await api("POST", "/api/projects", { dir: sound })).body.id as string;
  const b = (await api("POST", "/api/projects", { dir: broken })).body.id as string;
  const w = createWorkspace("Boutique", [a, b]);
  const epic = (title: string, projects: string[]) =>
    "```spawn\n" + JSON.stringify({ create: "epic", title, stories: projects.map((project, i) => ({ project, request: `${title} ${i + 1}` })) }) + "\n```";
  replies.push(epic("Dehors", ["inconnu"]), epic("Interrompu", [b]), epic("Livraison", [a, a]));

  const turn = async () => {
    await api("POST", `/api/workspaces/${w.id}/talk`, { message: "Crée l'epic" });
    const names = await eventsUntil("talk-end");
    const { body } = await api("GET", `/api/workspaces/${w.id}/talk`);
    return { announced: count(names, "workspaces"), action: body.turns.at(-1).actions[0] };
  };

  const refused = await turn();
  assert.equal(refused.action.ok, false);
  assert.equal(refused.announced, 0, "contrôle négatif : rien d'écrit, rien d'annoncé");

  const halted = await turn();
  assert.match(halted.action.error, /créé, mais arrêt à la story 1\/1/);
  assert.equal(halted.announced, 1, "annoncé dès sa création, même si ses stories échouent");

  const created = await turn();
  assert.equal(created.action.ok, true, JSON.stringify(created.action));
  assert.equal(created.announced, 3, "la création, puis chacune des deux stories");
  assert.equal(readWorkspaces().find((x) => x.id === w.id)?.epics.length, 2);
});

test("SGS-52: registering, adopting and removing a project are announced, a refusal is not", async () => {
  const { api, eventsUntil } = await open([projectsModule]);
  assert.equal((await api("POST", "/api/projects", { dir: tempDir("not-a-project") })).status, 400);

  const added = await api("POST", "/api/projects", { dir: spawnProject() });
  assert.equal(added.status, 200);
  // Annoncé par le refus, « projects » arriverait avant le remontage de l'inscription réussie.
  assert.deepEqual(await eventsUntil("projects"), ["modules", "projects"], "inscription ; contrôle négatif : rien pour le refus");

  assert.equal((await api("DELETE", `/api/projects/${added.body.id}`)).status, 200);
  assert.ok((await eventsUntil("projects")).includes("modules"), "retrait");

  assert.equal((await api("POST", "/api/projects/adopt", { dir: spawnProject(), engine: "fake", version: "1.0", tag: "BOU" })).status, 200);
  assert.ok((await eventsUntil("projects")).includes("modules"), "adoption");
});

test("SGS-52: creating a project is announced", async () => {
  const path = process.env.PATH;
  // La création installe le plugin si elle trouve Claude Code : ce test ne doit pas toucher à celui de la machine.
  process.env.PATH = (path ?? "").split(delimiter).filter((d) => !["claude", "claude.exe"].some((f) => existsSync(join(d, f)))).join(delimiter);
  try {
    assert.ok(spawnSync("claude", ["--version"]).error, "Claude Code doit être introuvable pendant ce test");
    const { api, eventsUntil } = await open([projectsModule]);
    const r = await api("POST", "/api/projects/new", { name: "Annonce", parent: tempDir("new"), engine: "fake", version: "1.0", remote: "none" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await eventsUntil("projects");
  } finally {
    process.env.PATH = path;
  }
});
