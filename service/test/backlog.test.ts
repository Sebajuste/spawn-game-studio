// Module backlog : une phrase crée la feature (titre, nom, premier message à l'agent, agent des réglages) ; groupes
// (bloquée, en recette, en cours, historique) ; avancement ; redemander, accepter (fusion en fond), abandonner ; lancer.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerPath } from "../../kit/core/src/context.ts";
import { updateStory } from "../../kit/core/src/stories.ts";
import { gitOk } from "../../kit/core/src/git.ts";
import { write } from "../../kit/core/src/ledger.ts";
import { commit, configure, cleanDirs, spawnProject } from "../../kit/core/test/git-helper.ts";
import { conversationModule } from "../src/modules/conversation.ts";
import { backlogModule, titleFrom } from "../src/modules/backlog.ts";
import { storiesModule } from "../src/modules/stories.ts";
import { projectsModule } from "../src/modules/projects.ts";
import { startService, type Service } from "../src/server.ts";
import { readClaude } from "../../kit/core/src/agent/claude.ts";
import { fakeAgent, STREAM } from "./fake-agent.ts";

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

test("title from the request: first clause, 7 words at most", () => {
  assert.equal(titleFrom("ajoute un score par joueur. Il survit à Rejouer"), "Ajoute un score par joueur");
  assert.equal(titleFrom("Anime les pions quand on les pose dans la case avec un rebond"), "Anime les pions quand on les pose");
  assert.equal(titleFrom("   "), "Feature");
  assert.equal(titleFrom("Je veux un morpion à deux joueurs sur le même écran, sans IA."), "Un morpion à deux joueurs", "sans formule de demande ni petit mot coupé");
});

test("backlog: request, follow, request changes, accept, abandon, settings, launch", async () => {
  const agent = fakeAgent();
  const conversation = conversationModule(agent.factory, { autoRestart: false });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  commit(root, "fake.project", "jeu\nmain=jeu.fx\n", "projet factice");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  const base = `/api/projects/${id}/backlog`;

  assert.deepEqual((await api("GET", `/api/projects/${id}/settings`)).body, { agent: "claude-code", localModel: "lmstudio/qwen/qwen3.5-9b", localContext: 100_000 });
  assert.equal((await api("PUT", `/api/projects/${id}/settings`, { localContext: 500 })).status, 400, "contexte hors bornes");
  assert.deepEqual((await api("PUT", `/api/projects/${id}/settings`, { localContext: 120_000 })).body, { agent: "claude-code", localModel: "lmstudio/qwen/qwen3.5-9b", localContext: 120_000 });
  assert.deepEqual((await api("GET", `/api/projects/${id}/settings`)).body.localContext, 120_000, "retenu pour ce projet");
  assert.equal((await api("PUT", `/api/projects/${id}/settings`, { localModel: "qwen3:8b" })).status, 400, "serveur du modèle absent");
  assert.equal((await api("PUT", `/api/projects/${id}/settings`, { localModel: "ollama/qwen3:8b" })).body.localModel, "ollama/qwen3:8b");
  assert.equal((await api("GET", `/api/projects/${id}/settings`)).body.localContext, 120_000, "le contexte reste");
  assert.equal((await api("PUT", `/api/projects/${id}/settings`, { agent: "gpt" })).status, 400);
  assert.equal((await api("POST", base, { request: " " })).status, 400);

  // Une phrase : titre, nom, premier message qui dit d'avancer par spawn next jusqu'au jugement.
  const created = (await api("POST", base, { request: "Affiche le score de chaque joueur. Il survit à Rejouer." })).body;
  assert.deepEqual(created, { story: "affiche-le-score-de-chaque", title: "Affiche le score de chaque joueur" });
  assert.ok(existsSync(join(root, ".spawn", "story-meta", `${created.story}.json`)), "fiche de la story");
  await waitUntil(async () => !(await api("GET", `${base}/${created.story}`)).body.running);
  assert.match(agent.calls[0]?.message ?? JSON.stringify((await api("GET", `/api/projects/${id}/stories/${created.story}/conversation`)).body), /« Affiche le score[\s\S]*next[\s\S]*à juger/);
  const second = (await api("POST", base, { request: "Affiche le score de chaque joueur" })).body;
  assert.equal(second.story, "affiche-le-score-de-chaque-2", "nom déjà pris : suffixe");
  await waitUntil(async () => !(await api("GET", `${base}/${second.story}`)).body.running);

  // L'agent s'est arrêté de lui-même sans dire pourquoi : « arrêtée », avec son dernier texte, hors de ce qui attend l'utilisateur.
  const story = created.story as string;
  let v = (await api("GET", `${base}/${story}`)).body;
  assert.equal(v.group, "active");
  assert.equal(v.waiting.reason, "stopped");
  assert.equal(v.title, "Affiche le score de chaque joueur");
  assert.equal(v.request, "Affiche le score de chaque joueur. Il survit à Rejouer.");
  assert.equal(v.progress[0].state, "current");
  assert.equal((await api("PATCH", `${base}/${story}`, { title: "Score des joueurs" })).body.title, "Score des joueurs");

  // Une question de l'agent (story bloquée) ; répondre relance l'agent avec la réponse.
  updateStory(root, story, { status: "blocked:decision", task: "validation de la spec" });
  assert.equal((await api("GET", `${base}/${story}`)).body.waiting.reason, "question");
  // Bloquée par le service après des relances sans progrès : son constat est montré, pas le dernier texte de l'agent.
  const statePath = join(root, ".spawn", "conversations", story, "state.json");
  const original = readFileSync(statePath, "utf8");
  const halted = JSON.parse(original) as { turns: { halted?: string }[] };
  const lastTurn = halted.turns.at(-1);
  assert.ok(lastTurn);
  lastTurn.halted = "L'agent s'est arrêté 2 fois de suite sans rien faire avancer";
  writeFileSync(statePath, JSON.stringify(halted));
  assert.equal((await api("GET", `${base}/${story}`)).body.waiting.text, "L'agent s'est arrêté 2 fois de suite sans rien faire avancer");
  writeFileSync(statePath, original);
  await api("POST", `${base}/${story}/answer`, { message: "oui, valide" });
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  assert.match(agent.calls.at(-1)?.message ?? "", /Réponse de l'utilisateur : oui, valide/);
  assert.equal((await api("GET", `${base}/${story}`)).body.status, "active", "répondre débloque la story");

  // Spec proposée : l'app la montre à valider ; valider écrit la validation (pas l'agent) et relance l'agent.
  write(ledgerPath(root, story), { date: new Date().toISOString(), type: "spec-proposed", path: "docs/specs/score.md" });
  updateStory(root, story, { status: "blocked:spec-approval", task: "valider la spec" });
  const toApprove = (await api("GET", `${base}/${story}`)).body;
  assert.equal(toApprove.waiting.reason, "spec-approval");
  assert.equal(toApprove.waiting.spec, `.claude/worktrees/${story}/docs/specs/score.md`);
  await api("POST", `${base}/${story}/approve-spec`);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  assert.match(agent.calls.at(-1)?.message ?? "", /Spec validée par l'utilisateur/);
  assert.equal((await api("GET", `${base}/${story}`)).body.progress[0].state, "done");
  assert.equal((await api("POST", `${base}/${story}/approve-spec`)).status, 409, "plus rien à valider");

  // En recette : compte rendu ; redemander relance l'agent ; accepter fusionne en fond puis nettoie.
  const wt = join(root, ".claude", "worktrees", story);
  configure(wt);
  commit(wt, "score.fx", "SCORE\n", "score");
  const toAcceptance = () => {
    write(ledgerPath(root, story), { date: new Date().toISOString(), type: "acceptance-report", summary: "un score par joueur", how_to_check: "gagner deux parties" });
    updateStory(root, story, { status: "in-acceptance" });
  };
  toAcceptance();
  v = (await api("GET", `${base}/${story}`)).body;
  assert.equal(v.group, "acceptance");
  assert.deepEqual([v.acceptanceReport.summary, v.acceptanceReport.how_to_check], ["un score par joueur", "gagner deux parties"]);
  assert.equal((await api("POST", `${base}/${story}/request-changes`, { message: "plus gros" })).status, 200);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  assert.match(agent.calls.at(-1)?.message ?? "", /redemande : « plus gros »/);
  const notJudged = await api("POST", `${base}/${story}/accept`);
  assert.equal(notJudged.status, 409, "pas en recette");
  assert.match(notJudged.body.error ?? JSON.stringify(notJudged.body), /n'est pas à juger/, "refusé avec sa raison");
  assert.equal((await api("GET", `${base}/${story}`)).body.operation, null, "au repos : aucune action longue");
  assert.equal((await api("GET", `${base}/${story}`)).body.lastMerge, null, "aucune fusion encore");

  toAcceptance();
  const launched = (await api("POST", `/api/projects/${id}/launch`, { story })).body;
  assert.equal(launched.launched, true, JSON.stringify(launched));
  assert.deepEqual((await api("POST", `${base}/${story}/accept`)).body, { merge: "started" });
  // Second « Valider » pendant la fusion : pas une erreur, la fusion est déjà en cours, avec sa date de début.
  const again = await api("POST", `${base}/${story}/accept`);
  assert.equal(again.status, 200);
  assert.equal(again.body.merge, "running");
  const during = (await api("GET", `${base}/${story}`)).body;
  assert.deepEqual(during.operation, { kind: "merge", since: again.body.since });
  await waitUntil(async () => (await api("GET", `${base}/${story}`)).body.group === "history");
  v = (await api("GET", `${base}/${story}`)).body;
  assert.equal(v.operation, null, "fusion finie : plus d'action longue");
  assert.equal(v.lastMerge.verdict, "merged");
  assert.match(v.lastMerge.commit, /^[0-9a-f]{7,}$/);
  assert.equal(v.result, "accepted");
  assert.ok(v.progress.every((e: Body) => e.state === "done"));
  assert.match(gitOk(root, ["log", "-1", "--format=%s", "develop"]), /^affiche-le-score-de-chaque : Score des joueurs/);
  assert.ok(!existsSync(wt));
  assert.equal((await api("POST", `/api/projects/${id}/launch`, { story })).status, 409, "plus de version à lancer");

  // Abandonner : branche jetée, historique « abandonnée ».
  const closed = (await api("POST", `${base}/${second.story}/abandon`, { reason: "doublon" })).body;
  assert.equal(closed.group, "history");
  assert.equal(closed.result, "abandoned");

  // Issues refusée et en erreur, lues dans les décisions (survivent au redémarrage) : la plus récente l'emporte.
  const decide = (d: Body) => {
    const dir = join(root, ".git", "spawn", "merge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), JSON.stringify({ story: second.story, branch: `feature/${second.story}`, head: "abc1234", ...d }) + "\n");
  };
  decide({ date: "2099-01-01T00:00:00.000Z", verdict: "refused", cause: "tests", detail: "test : 1 échec" });
  let refused = (await api("GET", `${base}/${second.story}`)).body.lastMerge;
  assert.equal(refused.verdict, "refused");
  assert.equal(refused.cause, "tests : test : 1 échec");
  decide({ date: "2099-01-02T00:00:00.000Z", verdict: "error", detail: "verrou de fusion introuvable" });
  refused = (await api("GET", `${base}/${second.story}`)).body.lastMerge;
  assert.equal(refused.verdict, "error");
  assert.equal(refused.cause, "verrou de fusion introuvable", "la cause d'une erreur vient du détail");
  const list = (await api("GET", base)).body as Body[];
  assert.deepEqual(list.map((f) => f.group).sort(), ["history", "history"]);

  // Fusionnée par l'orchestrateur mais pas encore rangée (worktree présent) : livrée, pas « en cours ».
  const third = (await api("POST", base, { request: "Anime les pions" })).body.story as string;
  await waitUntil(async () => !(await api("GET", `${base}/${third}`)).body.running);
  updateStory(root, third, { status: "done" });
  assert.equal((await api("GET", `${base}/${third}`)).body.group, "active", "terminée sans fusion : pas livrée");
  write(ledgerPath(root, third), { date: new Date().toISOString(), type: "merged", commit: "abc1234def" });
  v = (await api("GET", `${base}/${third}`)).body;
  assert.deepEqual([v.group, v.result], ["history", "accepted"]);
});

test("backlog: l'action longue dit le tour d'agent en cours, et la fusion prime sur lui", async () => {
  const agent = fakeAgent({ blocking: true });
  const conversation = conversationModule(agent.factory, { autoRestart: false });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  commit(root, "fake.project", "jeu\nmain=jeu.fx\n", "projet factice");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  const base = `/api/projects/${id}/backlog`;

  // Le faux agent retient son tour : l'action longue est le tour, avec sa date de début.
  const story = (await api("POST", base, { request: "Affiche le score" })).body.story as string;
  await waitUntil(async () => (await api("GET", `${base}/${story}`)).body.running);
  const turn = (await api("GET", `${base}/${story}`)).body;
  assert.equal(turn.operation.kind, "turn");
  const conv = (await api("GET", `/api/projects/${id}/stories/${story}/conversation`)).body;
  assert.ok(!Number.isNaN(Date.parse(turn.operation.since)), "date de début du tour");
  assert.equal(turn.operation.since, conv.turns?.at(-1)?.start ?? turn.operation.since, "début du dernier tour");
  assert.equal((await api("GET", base)).body[0].operation.kind, "turn", "aussi dans la liste");

  // Fusion pendant ce tour : la fusion prime.
  const wt = join(root, ".claude", "worktrees", story);
  configure(wt);
  commit(wt, "score.fx", "SCORE\n", "score");
  write(ledgerPath(root, story), { date: new Date().toISOString(), type: "acceptance-report", summary: "un score", how_to_check: "jouer" });
  updateStory(root, story, { status: "in-acceptance" });
  assert.equal((await api("POST", `/api/projects/${id}/launch`, { story })).body.launched, true);
  const since = (await api("POST", `${base}/${story}/accept`)).body;
  assert.equal(since.merge, "started");
  const during = (await api("GET", `${base}/${story}`)).body;
  assert.equal(during.operation.kind, "merge", "la fusion prime sur le tour");

  // Tour arrêté et fusion finie : plus aucune action longue.
  await api("POST", `/api/projects/${id}/stories/${story}/conversation/stop`);
  await waitUntil(async () => (await api("GET", `${base}/${story}`)).body.group === "history");
  const done = (await api("GET", `${base}/${story}`)).body;
  assert.equal(done.operation, null, "ni fusion ni tour : aucune action longue");
});

test("backlog: un message envoyé pendant la fusion attend sa fin ; refusée, le rappel de l'agent part en tête avec lui", async () => {
  const agent = fakeAgent();
  const conversation = conversationModule(agent.factory, { autoRestart: false });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "test/test_projet.fx", "PASS\n", "premier test");
  commit(root, "fake.project", "jeu\nmain=jeu.fx\n", "projet factice");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  const base = `/api/projects/${id}/backlog`;

  // Met la story en recette avec un fichier de son worktree, lance sa version, puis la valide et y écrit un message.
  // Le second « Valider » dit si la fusion tournait encore : le message, envoyé avant lui, l'a été pendant la fusion.
  const acceptWithMessage = async (story: string, file: string, content: string, message: string) => {
    await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
    const wt = join(root, ".claude", "worktrees", story);
    configure(wt);
    commit(wt, file, content, file);
    write(ledgerPath(root, story), { date: new Date().toISOString(), type: "acceptance-report", summary: "un score", how_to_check: "jouer" });
    updateStory(root, story, { status: "in-acceptance" });
    assert.equal((await api("POST", `/api/projects/${id}/launch`, { story })).body.launched, true);
    const calls = agent.calls.length;
    assert.deepEqual((await api("POST", `${base}/${story}/accept`)).body, { merge: "started" });
    const sent = await api("POST", `/api/projects/${id}/stories/${story}/conversation`, { message });
    assert.equal((await api("POST", `${base}/${story}/accept`)).body.merge, "running", "le message est parti pendant la fusion");
    assert.equal(typeof sent.body.queued, "string", `en file, pas un tour lancé pendant la fusion : ${JSON.stringify(sent.body)}`);
    assert.equal(agent.calls.length, calls, "aucun tour pendant la fusion");
    return calls;
  };

  // Fusion acceptée : le message part seul, après la fusion.
  const merged = (await api("POST", base, { request: "Affiche le score" })).body.story as string;
  const before = await acceptWithMessage(merged, "score.fx", "SCORE\n", "et la couleur ?");
  await waitUntil(async () => (await api("GET", `${base}/${merged}`)).body.group === "history");
  await waitUntil(async () => agent.calls.length === before + 1);
  assert.equal(agent.calls.at(-1)?.message, "et la couleur ?");
  await waitUntil(async () => !(await api("GET", `${base}/${merged}`)).body.running);

  // Fusion refusée (un test rouge) : un seul tour, le rappel de l'agent d'abord, le message de l'utilisateur ensuite.
  const refused = (await api("POST", base, { request: "Anime les pions" })).body.story as string;
  const calls = await acceptWithMessage(refused, "test/test_rouge.fx", "FAIL\n", "pense aux pions");
  await waitUntil(async () => agent.calls.length > calls);
  await waitUntil(async () => !(await api("GET", `${base}/${refused}`)).body.running);
  assert.equal(agent.calls.length, calls + 1, "un seul tour");
  assert.match(agent.calls.at(-1)?.message ?? "", /^La fusion a été refusée[\s\S]*\n\npense aux pions$/);
  assert.equal((await api("GET", `${base}/${refused}`)).body.lastMerge.verdict, "refused");
});

test("conversation: à toi, en pause après Stop, arrêtée avec la dernière phrase, Reprendre relance un tour", async () => {
  const blocking = fakeAgent({ blocking: true });
  const free = fakeAgent();
  let current = blocking;
  // Le faux agent change en cours de test : d'abord il retient son tour (Stop), puis il finit de lui-même.
  const conversation = conversationModule((a, p) => current.factory(a, p), { autoRestart: false });
  const s = await startService({ modules: [projectsModule, storiesModule, conversation, backlogModule(conversation)], log: () => {} });
  services.push(s);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Body };
  };
  for (const m of ["stories", "conversation", "backlog"]) await api("PUT", `/api/modules/${m}`, { active: true });
  const root = spawnProject();
  writeFileSync(join(root, ".gitignore"), ".spawn/\n.claude/worktrees/\n.fake-cache/\n");
  gitOk(root, ["checkout", "--quiet", "develop"]);
  gitOk(root, ["add", ".gitignore"]);
  gitOk(root, ["commit", "--quiet", "-m", "ignore"]);
  commit(root, "fake.project", "jeu\nmain=jeu.fx\n", "projet factice");
  gitOk(root, ["checkout", "--quiet", "main"]);
  const id = (await api("POST", "/api/projects", { dir: root })).body.id as string;
  const base = `/api/projects/${id}/backlog`;
  const conv = `/api/projects/${id}/stories`;

  const story = (await api("POST", base, { request: "Affiche le score" })).body.story as string;
  const path = `${conv}/${story}/conversation`;
  await waitUntil(async () => (await api("GET", `${base}/${story}`)).body.running);
  // Contrôle négatif : pendant un tour, rien à reprendre.
  assert.equal((await api("POST", `${path}/resume`)).status, 409, "Reprendre pendant un tour est refusé");

  // Stop : en pause, pas dans ce qui attend l'utilisateur, aucun tour.
  await api("POST", `${path}/stop`);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  let v = (await api("GET", `${base}/${story}`)).body;
  assert.equal(v.waiting.reason, "paused");
  assert.equal(v.group, "active");
  assert.equal(v.running, false);

  // Reprendre : un tour démarre, avec la consigne de continuer par spawn next.
  assert.equal((await api("POST", `${path}/resume`)).status, 200);
  await waitUntil(async () => blocking.calls.length === 2);
  assert.match(blocking.calls[1]?.message ?? "", /Continue[\s\S]*next/);
  assert.equal((await api("GET", `${base}/${story}`)).body.running, true);
  assert.equal((await api("POST", `${path}/resume`)).status, 409, "pas pendant le tour repris");

  // Tour fini de lui-même sans point d'arrêt : arrêtée, avec la dernière phrase de l'agent ; pas à l'utilisateur.
  await api("POST", `${path}/stop`);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  current = free;
  assert.equal((await api("POST", `${path}/resume`)).status, 200);
  await waitUntil(async () => free.calls.length === 1);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
  v = (await api("GET", `${base}/${story}`)).body;
  assert.equal(v.waiting.reason, "stopped");
  const events = STREAM.flatMap((l) => readClaude(l));
  const end = events.findLast((e) => e.type === "end");
  const expected = end?.type === "end" && end.text ? end.text : (events.findLast((e) => e.type === "text") as { text: string }).text;
  assert.equal(v.waiting.text, expected, "dernière phrase du flux rejoué");
  assert.equal(v.group, "active", "arrêtée n'attend pas l'utilisateur");
  assert.equal(v.running, false);
  // Et Reprendre relance encore un tour.
  assert.equal((await api("POST", `${path}/resume`)).status, 200);
  await waitUntil(async () => free.calls.length === 2);
  await waitUntil(async () => !(await api("GET", `${base}/${story}`)).body.running);
});

// Lancé par l'app, l'agent n'a pas d'interface : un outil de question est annulé sans réponse (essai du 19/11).
test("first and restart messages: a question goes through the story state and the last message, never a question tool", async () => {
  const { firstMessage } = await import("../src/modules/backlog.ts");
  const { RESTART_MESSAGE } = await import("../src/modules/conversation.ts");
  for (const m of [firstMessage("un morpion"), RESTART_MESSAGE]) {
    assert.match(m, /story update --status blocked:decision --task "<ta question>"\), écris la question dans ton dernier message, puis arrête-toi\. Jamais d'outil de question/);
  }
});
