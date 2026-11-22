// Module backlog : la vue utilisateur des stories (docs/ux-parcours.md). Demander une feature d'une phrase, la suivre en
// étapes lisibles, répondre à l'agent, juger (accepter, redemander, abandonner), retrouver l'historique, lancer le jeu.
// Le jargon du kit (fil, worktree, ledger) reste derrière : il sert la vue « Technique ».
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callAdapter } from "../../../kit/core/src/adapter/call.ts";
import { progress } from "../../../kit/core/src/progress.ts";
import { ledgerPath } from "../../../kit/core/src/context.ts";
import { readStory, listStories, updateStory, type Story } from "../../../kit/core/src/stories.ts";
import { createWorktree } from "../../../kit/core/src/hooks/worktree.ts";
import { abandon, accept, acceptanceReport, AcceptanceError, requestChanges, proposedSpec, approveSpec } from "../../../kit/core/src/acceptance.ts";
import { readDecisions } from "../../../kit/core/src/merge.ts";
import { readLedger } from "../../../kit/core/src/ledger.ts";
import { slug } from "../../../kit/core/src/new-project.ts";
import { LOCAL_MODEL, MAX_LOCAL_CONTEXT, MIN_LOCAL_CONTEXT, writeProjectSettings, readProjectSettings } from "../../../kit/core/src/settings.ts";
import { projectAdapter, findProject, type Project } from "../../../kit/core/src/project.ts";
import { SPAWN, nextAction } from "../../../kit/core/src/next.ts";
import type { AgentName, ProjectSettings, StoryDetail, StoryView } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { ASK_USER, lastReply, type ConversationModule } from "./conversation.ts";
import { projectById } from "./projects.ts";

const AGENTS: readonly AgentName[] = ["claude-code", "opencode", "copilot"];

// Fiche d'une story demandée depuis l'app : `.spawn/story-meta/<story>.json`.
interface StoryMeta {
  title: string;
  request: string | null;
  created: string;
}

const metaPath = (root: string, story: string) => join(root, ".spawn", "story-meta", `${story}.json`);

function readJson<T>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// Réglages du projet sur cette machine (kit/core/src/settings.ts) : agent par défaut, contexte du modèle local.
export const readSettings = (root: string): ProjectSettings => readProjectSettings(root);

// Titre tiré de la phrase par simple découpe : la première proposition, sans « je veux » ni formule de demande, au plus
// 7 mots (essai de nuit du 18/11 : « Je veux un morpion à… » donnait le fil « je-veux-un-morpion-a »).
export function titleFrom(request: string): string {
  const first = (request.trim().split(/[.!?\n:;,]/)[0] ?? "")
    .trim()
    .replace(/^(je (veux|voudrais|souhaite|aimerais)|j'(aimerais|ai besoin d[e'])|il (faut|faudrait)|on (veut|voudrait)|peux-tu|pourrais-tu|merci d[e'])\s*/i, "")
    .replace(/^(qu'on|que l'on|que tu|que)\s+/i, "");
  const words = first.trim().split(/\s+/).filter(Boolean).slice(0, 7);
  // Un titre ne finit pas sur un petit mot coupé (« … joueurs sur le »).
  while (words.length > 1 && /^(le|la|les|l'|de|du|des|d'|à|au|aux|sur|en|et|ou|un|une|pour|avec|dans|par|même)$/i.test(words.at(-1) ?? "")) words.pop();
  const title = words.join(" ").replace(/[,]+$/, "");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Feature";
}

// Nom de story libre tiré du titre (au plus 5 mots), suffixé s'il est déjà pris par une story vivante ou une fiche.
export function freeName(root: string, title: string): string {
  const base = slug(title).split("-").filter(Boolean).slice(0, 5).join("-") || "feature";
  // Noms réservés de Windows : ni branche ni dossier ne s'y créent.
  const safe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(-|$)/.test(base) ? `feature-${base}` : base;
  for (let i = 1; ; i++) {
    const name = i === 1 ? safe : `${safe}-${i}`;
    const story = readStory(root, name);
    if ((!story || story.status === "cleaned") && !existsSync(metaPath(root, name)) && !existsSync(join(root, ".claude", "worktrees", name))) return name;
  }
}

const defaultTitle = (story: string) => {
  const t = story.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function firstMessage(request: string): string {
  return [
    `Feature demandée par l'utilisateur : « ${request.trim()} »`,
    "",
    `Pour avancer, lance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence. Arrête-toi quand il dit que la feature est à juger, ${ASK_USER}`,
  ].join("\n");
}

// Une phrase suffit : titre et nom tirés d'elle, agent des réglages du projet sauf choix contraire. Le seul chemin de
// création d'une feature (Backlog d'hier, conversation de portée aujourd'hui).
export async function requestFeature(conversation: ConversationModule, projectId: string, project: Project, request: string, agent?: AgentName): Promise<{ story: string; title: string }> {
  const title = titleFrom(request);
  const name = freeName(project.root, title);
  writeJson(metaPath(project.root, name), { title, request, created: new Date().toISOString() } satisfies StoryMeta);
  // La story existe dès la réponse : l'app la montre tout de suite, avant même le premier mot de l'agent.
  await createWorktree({ cwd: project.root, name }, { log: () => {} });
  await conversation.send(projectId, name, firstMessage(request), agent ?? readSettings(project.root).agent);
  return { story: name, title };
}

export function backlogModule(conversation: ConversationModule): ServiceModule {
  // Acceptations en cours (fusion), par « projet/story » : la fusion rejoue la suite complète, elle peut durer.
  const merges = new Map<string, { work: Promise<void>; since: string }>();
  // Dernière fusion en erreur (le verrou ou la suite a planté) : aucune décision n'est écrite, seul le module la connaît.
  const mergeErrors = new Map<string, { cause: string; date: string }>();

  const projectOf = (id: string): Project => {
    const project = findProject(projectById(id).root);
    if (project === null) throw new HttpError(409, `le projet ${id} n'est plus un projet Spawn`);
    return project;
  };

  // Dernière issue de fusion connue : la plus récente entre le ledger (livrée), les décisions de fusion et l'erreur gardée.
  const lastMerge = (id: string, project: Project, story: string, evs: ReturnType<typeof readLedger>): StoryDetail["lastMerge"] => {
    const found: NonNullable<StoryDetail["lastMerge"]>[] = [];
    for (const e of evs) if (e.type === "merged") found.push({ verdict: "merged", cause: null, commit: e.commit, date: e.date });
    for (const d of readDecisions(project.root)) {
      if (d.story !== story || d.verdict === "queued") continue;
      // Une fusion en erreur n'écrit que `detail` (merge.ts) : sans ce repli la cause serait perdue au redémarrage du service.
      // Un refus a une cause courte et un détail qui dit pourquoi : les deux s'affichent.
      const cause = d.verdict === "merged" ? null : [d.cause, d.detail].filter(Boolean).join(" : ") || null;
      found.push({ verdict: d.verdict === "merged" ? "merged" : d.verdict === "refused" ? "refused" : "error", cause, commit: d.commit ?? null, date: d.date });
    }
    const err = mergeErrors.get(`${id}/${story}`);
    if (err) found.push({ verdict: "error", cause: err.cause, commit: null, date: err.date });
    return found.sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  };

  const build = (id: string, project: Project, story: Story): { view: StoryView; step: string | null } => {
    const meta = readJson<StoryMeta>(metaPath(project.root, story.story));
    const conv = conversation.summary(id, project.root, story.story);
    const evs = readLedger(ledgerPath(project.root, story.story));
    // Fusionné, le fil est livré pour l'utilisateur même avant le rangement de son worktree (`spawn cleanup`), que
    // l'orchestrateur peut oublier : sans ça, un fil livré restait dans « En cours » (essai du 18/11).
    const closed = story.status === "cleaned" || (story.status === "done" && evs.some((e) => e.type === "merged"));
    const result = !closed ? null : evs.some((e) => e.type === "merged") ? "accepted" : evs.some((e) => e.type === "abandoned") ? "abandoned" : null;
    let step: string | null = null;
    if (story.status !== "cleaned") {
      const dir = story.worktree ? join(project.root, story.worktree) : project.root;
      try {
        step = nextAction({ project, story: story.story, dir: existsSync(dir) ? dir : project.root }).step;
      } catch {
        step = null;
      }
    }
    const mergeRun = merges.get(`${id}/${story.story}`);
    const merging = mergeRun !== undefined;
    let waiting: StoryView["waiting"] = null;
    const spec = proposedSpec(project.root, story.story);
    if (spec !== null && story.worktree) waiting = { reason: "spec-approval", text: lastReply(project.root, story.story), spec: `${story.worktree}/${spec}` };
    else if (story.status.startsWith("blocked:")) waiting = { reason: "question", text: conv.halted ?? lastReply(project.root, story.story) ?? story.task };
    else if (conv.interrupted) waiting = { reason: "interrupted", text: null };
    else if (conv.paused && !merging && ["active", "compacting", "handoff-pending"].includes(story.status)) waiting = { reason: "paused", text: null };
    else if (conv.stoppedOnItsOwn && !merging && ["active", "compacting", "handoff-pending"].includes(story.status)) waiting = { reason: "stopped", text: lastReply(project.root, story.story) };
    const group = closed ? "history" : story.status === "in-acceptance" ? "acceptance" : waiting && waiting.reason !== "paused" && waiting.reason !== "stopped" ? "blocked" : "active";
    // Une fusion prime sur un tour : c'est elle que l'utilisateur attend.
    const operation: StoryView["operation"] = mergeRun ? { kind: "merge", since: mergeRun.since } : conv.turnStart ? { kind: "turn", since: conv.turnStart } : null;
    const view: StoryView = {
      story: story.story,
      title: meta?.title ?? defaultTitle(story.story),
      request: meta?.request ?? null,
      group,
      status: story.status,
      step: merging ? "fusion en cours" : step,
      waiting,
      agent: conv.agent,
      running: conv.running || merging,
      start: meta?.created ?? conv.start ?? evs[0]?.date ?? null,
      updated: story.updated,
      result,
      operation,
    };
    return { view, step };
  };
  const view = (id: string, project: Project, story: Story): StoryView => build(id, project, story).view;

  const existingStory = (project: Project, name: string): Story => {
    const story = readStory(project.root, name);
    if (!story) throw new HttpError(404, `feature inconnue : ${name}`);
    return story;
  };

  const text = (body: unknown, field: string): string => {
    const v = (body as Record<string, unknown> | null)?.[field];
    if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `corps attendu : { "${field}": "…" }`);
    return v.trim();
  };

  const judged = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof AcceptanceError) throw new HttpError(409, e.message);
      throw e;
    }
  };

  return {
    id: "backlog",
    title: "Features",
    description: "Demander une feature d'une phrase, la suivre en étapes, répondre, juger, retrouver l'historique.",
    defaultOn: true,
    dependencies: ["stories", "conversation"],
    start({ routes, emit }) {
      const base = "/api/projects/:id/backlog";
      routes.add("GET", base, ({ params }) => {
        const id = params.id ?? "";
        const project = projectOf(id);
        return listStories(project.root)
          .map((f) => view(id, project, f))
          .sort((a, b) => b.updated.localeCompare(a.updated));
      });

      routes.add("GET", `${base}/:story`, ({ params }): StoryDetail => {
        const id = params.id ?? "";
        const project = projectOf(id);
        const story = existingStory(project, params.story ?? "");
        const evs = readLedger(ledgerPath(project.root, story.story));
        const lastTask = evs.findLast((e) => e.type === "task-done" || e.type === "task-parked")?.date ?? "";
        const p = evs.findLast((e) => e.type === "proof");
        const r = evs.findLast((e) => e.type === "final-review");
        const { view: v, step } = build(id, project, story);
        const prog = progress(project.root, story, step);
        return {
          ...v,
          progress: prog.steps,
          unknownStep: prog.unknownStep,
          lastMerge: lastMerge(id, project, story.story, evs),
          acceptanceReport: acceptanceReport(project.root, story.story),
          proof: p?.type === "proof" && p.date >= lastTask ? { date: p.date, compilation: p.compilation, tests: p.tests, launch: p.launch, end_to_end: p.end_to_end } : null,
          reviewed: r?.type === "final-review" && r.verdict === "clean" && r.date >= lastTask,
          branch: story.branch,
          worktree: story.worktree,
        };
      });

      routes.add("POST", base, async ({ params, body }) => {
        const id = params.id ?? "";
        const project = projectOf(id);
        const request = text(body, "request");
        const chosen = (body as { agent?: unknown }).agent;
        if (chosen !== undefined && !AGENTS.includes(chosen as AgentName)) throw new HttpError(400, `agent inconnu : ${String(chosen)}`);
        return requestFeature(conversation, id, project, request, chosen as AgentName | undefined);
      });

      routes.add("PATCH", `${base}/:story`, ({ params, body }) => {
        const project = projectOf(params.id ?? "");
        const name = params.story ?? "";
        const meta = readJson<StoryMeta>(metaPath(project.root, name));
        if (!meta && !readStory(project.root, name)) throw new HttpError(404, `feature inconnue : ${name}`);
        const title = text(body, "title");
        writeJson(metaPath(project.root, name), { title, request: meta?.request ?? null, created: meta?.created ?? new Date().toISOString() } satisfies StoryMeta);
        emit("stories", { project: params.id });
        return { story: name, title };
      });

      // Valider la spec proposée : la seule question de la feature ; l'agent repart aussitôt.
      routes.add("POST", `${base}/:story/approve-spec`, async ({ params }) => {
        const id = params.id ?? "";
        const name = params.story ?? "";
        judged(() => approveSpec(projectOf(id).root, name));
        return { turn: await conversation.send(id, name, `Spec validée par l'utilisateur. Continue : lance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence.`) };
      });

      // Répondre débloque la story : l'agent lit la réponse, et `spawn next` repart de là (une spec non validée est à revoir).
      routes.add("POST", `${base}/:story/answer`, async ({ params, body }) => {
        const message = text(body, "message");
        const project = projectOf(params.id ?? "");
        const story = readStory(project.root, params.story ?? "");
        if (story?.status.startsWith("blocked:")) updateStory(project.root, story.story, { status: "active" });
        return { turn: await conversation.send(params.id ?? "", params.story ?? "", `Réponse de l'utilisateur : ${message}\n\nPuis lance « ${SPAWN} next » et continue.`) };
      });

      routes.add("POST", `${base}/:story/request-changes`, async ({ params, body }) => {
        const id = params.id ?? "";
        const project = projectOf(id);
        const name = params.story ?? "";
        const message = text(body, "message");
        judged(() => requestChanges(project.root, name, message));
        return {
          turn: await conversation.send(id, name, `L'utilisateur a jugé la feature et redemande : « ${message} »\n\nLance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence jusqu'au prochain jugement.`),
        };
      });

      // La fusion rejoue la suite complète : elle tourne en fond, l'app suit par les événements « stories » et « backlog ».
      routes.add("POST", `${base}/:story/accept`, ({ params }) => {
        const id = params.id ?? "";
        const project = projectOf(id);
        const name = params.story ?? "";
        const key = `${id}/${name}`;
        // Un second « Valider » pendant la fusion n'est pas une erreur : elle est déjà en route.
        const running = merges.get(key);
        if (running) return { merge: "running", since: running.since };
        if (existingStory(project, name).status !== "in-acceptance") throw new HttpError(409, `la feature ${name} n'est pas à juger`);
        const title = readJson<StoryMeta>(metaPath(project.root, name))?.title ?? defaultTitle(name);
        const since = new Date().toISOString();
        mergeErrors.delete(key);
        const work = (async () => {
          try {
            const r = await accept(project, name, title);
            emit("backlog", { project: id, story: name, merge: r.decision.verdict, cause: r.decision.cause ?? null });
            // Refusée : sans l'utilisateur, l'agent est rappelé avec la cause (next.ts la lui donne).
            if (r.decision.verdict === "refused") {
              await conversation.send(id, name, `La fusion a été refusée (${r.decision.cause ?? "?"}) : ${r.decision.detail ?? ""}\n\nLance « ${SPAWN} next » et corrige ; l'utilisateur a déjà accepté, réinscris la branche quand la preuve est verte.`, undefined, { head: true });
            }
          } catch (e) {
            mergeErrors.set(key, { cause: (e as Error).message, date: new Date().toISOString() });
            emit("backlog", { project: id, story: name, merge: "error", cause: (e as Error).message });
          } finally {
            merges.delete(key);
            emit("stories", { project: id });
          }
        })();
        merges.set(key, { work, since });
        // Les messages de l'utilisateur attendent la fin de la fusion ; refusée, ils partent avec le rappel de l'agent.
        conversation.hold(id, name, work);
        emit("stories", { project: id });
        return { merge: "started" };
      });

      routes.add("POST", `${base}/:story/abandon`, async ({ params, body }) => {
        const id = params.id ?? "";
        const project = projectOf(id);
        const name = params.story ?? "";
        const reason = (body as { reason?: unknown } | null)?.reason;
        await conversation.stop(id, name);
        const story = judged(() => abandon(project.root, name, typeof reason === "string" ? reason : undefined));
        return view(id, project, story);
      });

      routes.add("GET", "/api/projects/:id/settings", ({ params }) => readSettings(projectOf(params.id ?? "").root));
      routes.add("PUT", "/api/projects/:id/settings", ({ params, body }) => {
        const project = projectOf(params.id ?? "");
        const c = (body ?? {}) as { agent?: unknown; localModel?: unknown; localContext?: unknown };
        const current = readProjectSettings(project.root);
        if (c.agent !== undefined && !AGENTS.includes(c.agent as AgentName)) throw new HttpError(400, `agent attendu : ${AGENTS.join(" ou ")}`);
        const context = c.localContext === undefined ? current.localContext : Number(c.localContext);
        if (!Number.isInteger(context) || context < MIN_LOCAL_CONTEXT || context > MAX_LOCAL_CONTEXT) {
          throw new HttpError(400, `contexte du modèle local : entier de ${MIN_LOCAL_CONTEXT} à ${MAX_LOCAL_CONTEXT} tokens attendu`);
        }
        const model = c.localModel === undefined ? current.localModel : String(c.localModel).trim();
        if (!LOCAL_MODEL.test(model)) throw new HttpError(400, "modèle local : « lmstudio/<modèle> » ou « ollama/<modèle> » attendu");
        return writeProjectSettings(project.root, { agent: (c.agent as AgentName | undefined) ?? current.agent, localModel: model, localContext: context });
      });

      // Lancer le jeu : develop (racine) ou la version d'une story (son worktree).
      routes.add("POST", "/api/projects/:id/launch", async ({ params, body }) => {
        const project = projectOf(params.id ?? "");
        const name = (body as { story?: unknown } | null)?.story;
        let dir = project.root;
        if (typeof name === "string" && name) {
          const story = existingStory(project, name);
          if (!story.worktree || !existsSync(join(project.root, story.worktree))) throw new HttpError(409, `la feature ${name} n'a plus de version à lancer`);
          dir = join(project.root, story.worktree);
        }
        const r = await callAdapter(projectAdapter(project), "launch", { project: dir }, { timeoutMs: 60_000 });
        if (!r.result?.ok) throw new HttpError(502, r.result?.errors.map((e) => e.message).join(" ; ") || r.defects.join(" ; ") || r.stderr.trim() || "lancement impossible");
        return { launched: true, dir };
      });
      return undefined;
    },
    async close() {
      await Promise.race([Promise.all([...merges.values()].map((m) => m.work)), new Promise((ok) => setTimeout(ok, 5000))]);
    },
  };
}
