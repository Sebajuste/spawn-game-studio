// Module talk (docs/conversation.md) : un tour dans le worktree `_talk` remis à develop, la consigne au premier tour, les
// blocs ```spawn exécutés par le service (story, epic avec son ordre), le compte rendu au tour suivant.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readClaude } from "../../kit/core/src/agent/claude.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { createWorkspace, readWorkspaces } from "../../kit/core/src/workspaces.ts";
import { commit, cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { backlogModule } from "../src/modules/backlog.ts";
import { conversationModule, type AgentFactory } from "../src/modules/conversation.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { talkModule } from "../src/modules/talk/index.ts";
import { startService, type Service } from "../src/server.ts";
import { fakeAgent } from "./fake-agent.ts";

process.env.SPAWN_ENGINES = fileURLToPath(new URL("../../kit/core/test/adapters/", import.meta.url));
const services: Service[] = [];
after(async () => {
  for (const s of services) await s.close();
  cleanDirs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- réponses JSON lues champ par champ dans les assertions
type Body = Record<string, any>;

async function waitUntil(condition: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

const block = (o: unknown) => "```spawn\n" + JSON.stringify(o) + "\n```";

// Agent de conversation scénarisé : chaque tour répond le texte suivant de `replies`, au format de Claude Code.
function talkAgent(replies: string[], during?: (dir: string) => void): { factory: AgentFactory; calls: { dir: string; message: string; session: string | null }[] } {
  const calls: { dir: string; message: string; session: string | null }[] = [];
  const agent: AgentAdapter = {
    name: "claude-code",
    async turn({ dir, message, session, output }) {
      calls.push({ dir, message, session });
      during?.(dir);
      const text = replies[calls.length - 1] ?? "Rien à faire.";
      const lines = [
        { type: "system", subtype: "init", session_id: "talk-session", model: "test" },
        { type: "assistant", message: { content: [{ type: "text", text }] } },
        { type: "result", subtype: "success", result: text, session_id: "talk-session" },
      ];
      writeFileSync(output, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return { code: 0, session: "talk-session" };
    },
    read: readClaude,
    async maxContext() {
      return 120_000;
    },
    async check() {
      return [];
    },
    async measure() {
      return null;
    },
  };
  return { factory: () => agent, calls };
}

test("talk: a scope conversation creates stories and epics through the service", async () => {
  const story = fakeAgent();
  const conversation = conversationModule(story.factory, { autoRestart: false });
  const replies = [
    `C'est un petit correctif, je le crée.\n\n${block({ create: "story", request: "Corrige la date vide de /equipment" })}`,
    "On a juste parlé.",
    block({ create: "epic", title: "x", stories: [{ project: "p", request: "y" }] }),
    `Trois projets, dans l'ordre.\n\n${block({ create: "epic", title: "Emplacement", acceptance: ["filtrer"], stories: [{ project: "__ID__", request: "Ajoute la colonne emplacement" }, { project: "__ID__", request: "Expose l'emplacement dans les routes", after: [0] }] })}`,
  ];
  let stray: string | null = null;
  const talk = talkAgent(replies, (dir) => {
    // Le premier tour laisse un fichier : le tour suivant doit trouver le worktree propre.
    if (stray === null) {
      stray = join(dir, "brouillon.txt");
      writeFileSync(stray, "à effacer");
    } else assert.equal(existsSync(stray), false, "worktree remis à develop avant le tour");
  });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation), talkModule(conversation, talk.factory)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog", "talk"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "fake.project", "jeu\nmain=jeu.fx\n", "projet factice");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  replies[3] = (replies[3] ?? "").replaceAll("__ID__", id);
  const base = `/api/projects/${id}/talk`;
  const idle = async (path: string) => waitUntil(async () => !(await api("GET", path)).body.running);

  assert.deepEqual((await api("GET", base)).body, { agent: null, running: false, turns: [] });
  assert.equal((await api("POST", base, { message: " " })).status, 400);
  assert.equal((await api("POST", `${base}/stop`)).status, 409, "rien à arrêter");

  // Premier tour : la consigne, le message ; la story demandée est créée par le service.
  assert.deepEqual((await api("POST", base, { message: "La date vide fait planter /equipment" })).body, { turn: 1 });
  await idle(base);
  let view = (await api("GET", base)).body;
  const first = view.turns[0];
  assert.equal(first.message, "La date vide fait planter /equipment");
  assert.equal(first.actions.length, 1);
  assert.deepEqual({ ...first.actions[0], story: undefined }, { kind: "story", ok: true, project: id, story: undefined, title: "Corrige la date vide de /equipment" });
  const created = first.actions[0].story as string;
  assert.ok(existsSync(join(root, ".spawn", "story-meta", `${created}.json`)), "fiche de la story");
  assert.ok(existsSync(join(root, ".claude", "worktrees", created)), "worktree de la story");
  assert.equal(basename(talk.calls[0]?.dir ?? ""), "_talk", "l'agent tourne dans le worktree jetable");
  assert.match(talk.calls[0]?.message ?? "", /^Tu es l'agent de la conversation du projet[\s\S]*```spawn[\s\S]*Message de l'utilisateur :\nLa date vide/);
  assert.equal(gitOk(talk.calls[0]?.dir ?? "", ["rev-parse", "HEAD"]), gitOk(root, ["rev-parse", "develop"]), "copie de develop");
  await waitUntil(async () => story.calls.length > 0);
  assert.match(story.calls[0]?.message ?? "", /« Corrige la date vide de \/equipment »/, "l'agent de la story reçoit la demande");

  // Deuxième tour : session reprise, compte rendu de la création d'abord ; rien à créer.
  await api("POST", base, { message: "Et le reste ?" });
  await idle(base);
  assert.equal(talk.calls[1]?.session, "talk-session");
  assert.match(talk.calls[1]?.message ?? "", new RegExp(`^\\[Spawn\\] Suite à ta réponse précédente :\\n- story créée : ${id}/${created}[\\s\\S]*Message de l'utilisateur :\\nEt le reste \\?$`));
  assert.doesNotMatch(talk.calls[1]?.message ?? "", /Tu es l'agent/, "pas de consigne dans une session reprise");
  view = (await api("GET", base)).body;
  assert.deepEqual(view.turns[1].actions, []);

  // Un epic dans un projet : refusé, avec sa raison, rien de créé.
  await api("POST", base, { message: "Fais un epic" });
  await idle(base);
  view = (await api("GET", base)).body;
  assert.equal(view.turns[2].actions[0].ok, false);
  assert.match(view.turns[2].actions[0].error, /workspace/);

  // Workspace : l'epic et ses stories dans l'ordre, dans le worktree propre au workspace.
  const w = createWorkspace("Shop", [id]);
  const wsBase = `/api/workspaces/${w.id}/talk`;
  await api("POST", wsBase, { message: "Il faut l'emplacement des équipements" });
  await idle(wsBase);
  const epicTurn = (await api("GET", wsBase)).body.turns[0];
  assert.equal(epicTurn.actions[0].ok, true, JSON.stringify(epicTurn.actions));
  assert.equal(basename(talk.calls[3]?.dir ?? ""), `_talk-${w.id}`);
  assert.match(talk.calls[3]?.message ?? "", /du workspace « Shop »[\s\S]*"create": "epic"/);
  const epic = readWorkspaces().find((x) => x.id === w.id)?.epics[0];
  assert.equal(epic?.title, "Emplacement");
  assert.deepEqual(epic?.acceptance, ["filtrer"]);
  assert.equal(epic?.stories.length, 2);
  assert.deepEqual(epic?.stories[1]?.blocked_by, [{ project: id, story: epic?.stories[0]?.story }], "la deuxième attend la première");
  assert.ok(!existsSync(join(root, ".spawn", "talk", "state.json")) || (await api("GET", base)).body.turns.length === 3, "conversations séparées");
});
