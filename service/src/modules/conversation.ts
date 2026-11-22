// Module conversation : parler à l'agent d'une story depuis l'app. Chaque message lance un tour de l'adaptateur d'agent
// (Claude Code ou OpenCode) dans le worktree de la story, avec reprise de session ; sa sortie est lue au fil de l'eau en
// événements normalisés et poussée à l'interface (événement « conversation »).
//
// Les tours en cours vivent hors du montage des modules : éteindre un autre module remonte tout, et un agent au travail
// ne doit pas en mourir. Un tour s'arrête par le bouton Stop, à la fin de son délai, ou à la fermeture du service.
//
// Une coupure (PC éteint, app fermée) ne perd rien : le code est dans le worktree, l'historique et l'identifiant de
// session sont écrits dès qu'ils sont connus. Au démarrage, un tour resté sans fin est marqué interrompu, la story le
// montre, et il est repris tout seul (même session) ; « reprendre » sert si cette reprise échoue.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { claudeAdapter } from "../../../kit/core/src/agent/claude.ts";
import { copilotAdapter } from "../../../kit/core/src/agent/copilot.ts";
import type { AgentEvent } from "../../../kit/core/src/agent/events.ts";
import { opencodeAdapter } from "../../../kit/core/src/agent/opencode.ts";
import type { AgentAdapter } from "../../../kit/core/src/agent/type.ts";
import { readStory, updateStory } from "../../../kit/core/src/stories.ts";
import { git } from "../../../kit/core/src/git.ts";
import { readProjectSettings } from "../../../kit/core/src/settings.ts";
import { readRegistry } from "../../../kit/core/src/registry.ts";
import { nextAction, renderAction, RUNNER_ENV, SPAWN } from "../../../kit/core/src/next.ts";
import { recordActivity } from "../../../kit/core/src/activity.ts";
import { createWorktree } from "../../../kit/core/src/hooks/worktree.ts";
import { tidyMerged } from "../../../kit/core/src/cleanup.ts";
import { contextOf, ledgerPath, type Context } from "../../../kit/core/src/context.ts";
import { renderOutcome, runTasks } from "../../../kit/core/src/runner.ts";
import { findProject, type Project } from "../../../kit/core/src/project.ts";
import type { AgentName, ConversationTurn, ConversationView } from "../contract.ts";
import type { ServiceModule } from "../module.ts";
import { HttpError } from "../router.ts";
import { projectById } from "./projects.ts";

export type AgentFactory = (agent: AgentName, project: Project) => AgentAdapter;

const AGENTS: readonly AgentName[] = ["claude-code", "opencode", "copilot"];
const TURN_TIMEOUT_MS = 2 * 60 * 60_000;
const TURNS_SHOWN = 30;
// Relance automatique d'un agent qui s'arrête sans raison (§0 : sans l'utilisateur). Bornée : au-delà, ou après des tours
// sans aucun progrès, la feature attend l'utilisateur.
const MAX_RESTARTS = 5;
const MAX_WITHOUT_PROGRESS = 2;

// Comment demander : l'agent tourne sans interface, un outil de question (AskUserQuestion, question d'OpenCode) est
// annulé sans réponse et l'agent continue sur une supposition (essai du 19/11 : 5 questions perdues). La question passe
// par l'état du fil et le dernier message, que l'app montre.
export const ASK_USER = `ou quand il te faut une réponse de l'utilisateur : dans ce cas, mets d'abord le fil en attente (${SPAWN} story update --status blocked:decision --task "<ta question>"), écris la question dans ton dernier message, puis arrête-toi. Jamais d'outil de question : personne n'y répond pendant ton tour.`;

export const RESTART_MESSAGE = `Continue : lance « ${SPAWN} next » et fais exactement l'action qu'il donne, puis recommence. Arrête-toi seulement quand il dit que la feature est à juger, ${ASK_USER}`;

export const timeoutNotice = (ms: number) => `Ton tour précédent a été coupé au bout de ${Math.round(ms / 60_000)} min (délai dépassé) : une commande attendait sans doute sans rendre la main (programme lancé au premier plan, invite interactive). Lance les programmes qui durent par les commandes de Spawn, jamais en direct.`;

// Constat montré à l'utilisateur quand les relances s'arrêtent : ce qui s'est passé, où en est le fil, ce qu'il peut faire.
function haltNotice(dir: string | null, restarted: number, idle: boolean, reply: string | null): string {
  let step = "inconnue";
  try {
    const ctx = dir && existsSync(dir) ? contextOf(dir) : null;
    if (ctx) step = nextAction(ctx).step;
  } catch {
    // État illisible : l'étape reste « inconnue », le constat vaut quand même.
  }
  const why = idle
    ? `L'agent s'est arrêté ${MAX_WITHOUT_PROGRESS} fois de suite sans rien faire avancer (ni ledger, ni commit, ni état du fil)`
    : `L'agent a été relancé ${restarted} fois sans arriver au bout`;
  const said = reply ? `\n\nSon dernier message (à vérifier, l'outil ne l'a pas confirmé) :\n${reply.length > 1200 ? `${reply.slice(0, 1200)}…` : reply}` : "";
  return `${why} : Spawn a cessé de le relancer. Étape où en est le fil : ${step}.${said}\n\nRéponds avec une consigne pour le relancer, ou regarde l'onglet Conversation.`;
}

// Empreinte de l'avancement d'une story : un tour qui ne change ni l'état, ni le ledger, ni la branche n'a rien fait.
function fingerprint(root: string, story: string): string {
  const state = readStory(root, story);
  const ledger = ledgerPath(root, story);
  const size = existsSync(ledger) ? statSync(ledger).size : 0;
  const head = state?.worktree && existsSync(join(root, state.worktree)) ? git(join(root, state.worktree), ["rev-parse", "HEAD"]).stdout : "";
  return `${state?.status}|${state?.updated}|${size}|${head}`;
}

// La story attend-elle du travail de l'agent ? Ni question posée, ni recette, ni fusion, ni story fermée.
const needsRestart = (root: string, story: string) => ["active", "compacting", "handoff-pending"].includes(readStory(root, story)?.status ?? "");

// OpenCode : l'app charge le modèle local réglé pour le projet s'il ne l'est pas, avec le contexte réglé (selon la VRAM).
export const defaultAgentFactory: AgentFactory = (agent, project) => {
  if (agent === "copilot") return copilotAdapter();
  if (agent !== "opencode") return claudeAdapter();
  const settings = readProjectSettings(project.root);
  return opencodeAdapter({ model: settings.localModel, load: true, context: settings.localContext });
};

interface StoredTurn {
  n: number;
  agent: AgentName;
  message: string;
  start: string;
  end: string | null;
  code: number | null;
  stopped: boolean;
  // Coupé par un arrêt du PC ou de l'app : à reprendre.
  interrupted: boolean;
  // Constats de l'adaptateur qui ont empêché le tour (périmètre inactif, modèle non chargé…).
  refused: string[];
  // Coupé par le délai du tour (TURN_TIMEOUT_MS) : l'agent attendait sans doute une commande qui ne rend pas la main.
  timedOut?: boolean;
  // Relances arrêtées après ce tour : le constat de l'outil, montré à l'utilisateur à la place du dernier message de
  // l'agent (essai du 19/11 : fil resté « actif » sur un « tout est fait » de l'agent, preuve refusée).
  halted?: string;
}

interface ConversationState {
  agent: AgentName;
  session: string | null;
  turns: StoredTurn[];
}

const conversationDir = (root: string, story: string) => join(root, ".spawn", "conversations", story);
const statePath = (root: string, story: string) => join(conversationDir(root, story), "state.json");
const queuePath = (root: string, story: string) => join(conversationDir(root, story), "queue.json");
const turnPath = (root: string, story: string, n: number) => join(conversationDir(root, story), `turn-${n}.jsonl`);

function readState(root: string, story: string): ConversationState | null {
  const path = statePath(root, story);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConversationState;
  } catch {
    return null;
  }
}

function writeState(root: string, story: string, state: ConversationState): void {
  mkdirSync(conversationDir(root, story), { recursive: true });
  writeFileSync(statePath(root, story), JSON.stringify(state, null, 2) + "\n");
}

// File des messages envoyés pendant un tour ou une fusion. Dans son propre fichier : le tour en cours réécrit state.json
// depuis son état en mémoire, il écraserait un message mis en file entre-temps.
interface Queued {
  id: string;
  message: string;
  date: string;
}

function readQueue(root: string, story: string): Queued[] {
  const path = queuePath(root, story);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Queued[];
  } catch {
    return [];
  }
}

function writeQueue(root: string, story: string, queue: Queued[]): void {
  mkdirSync(conversationDir(root, story), { recursive: true });
  writeFileSync(queuePath(root, story), JSON.stringify(queue, null, 2) + "\n");
}

// Lecture incrémentale d'une sortie en cours d'écriture : seules les lignes complètes sont rendues (jamais un caractère
// UTF-8 coupé en deux).
export class Tail {
  private position = 0;
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  lines(): string[] {
    if (!existsSync(this.path)) return [];
    const size = statSync(this.path).size;
    if (size <= this.position) return [];
    const buffer = Buffer.alloc(size - this.position);
    const fd = openSync(this.path, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, this.position);
    } finally {
      closeSync(fd);
    }
    const end = buffer.lastIndexOf(0x0a);
    if (end < 0) return [];
    this.position += end + 1;
    return buffer.subarray(0, end).toString("utf8").split(/\r?\n/).filter(Boolean);
  }
}

// Tours restés sans fin alors qu'aucun ne tourne : la machine ou l'app s'est arrêtée pendant. Marqués une fois pour
// toutes, pour que la story le montre.
function markInterrupted(root: string, story: string): void {
  const state = readState(root, story);
  if (!state?.turns.some((t) => t.end === null)) return;
  for (const t of state.turns) {
    if (t.end !== null) continue;
    t.end = new Date().toISOString();
    t.interrupted = true;
  }
  writeState(root, story, state);
}

// Le dernier tour de la story a-t-il été coupé ? (lu par le module stories pour la barre latérale)
export function conversationInterrupted(root: string, story: string): boolean {
  return readState(root, story)?.turns.at(-1)?.interrupted === true;
}

export function resumeMessage(cut: string, sessionKept: boolean): string {
  return [
    "La session a été coupée (arrêt du PC ou de l'app) pendant le tour précédent.",
    sessionKept ? null : `Le message coupé était : « ${cut} ».`,
    `Reprends : regarde l'état du worktree (git status, fichiers à moitié écrits), puis lance « ${SPAWN} next » et fais exactement l'action qu'il donne.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const validName = (story: string) => /^[a-z0-9][a-z0-9-]*$/.test(story);

// Dernier texte de l'agent dans la story : sa question quand il attend une réponse.
export function lastReply(root: string, story: string, factory: AgentFactory = defaultAgentFactory, project?: Project): string | null {
  const state = readState(root, story);
  const turn = state?.turns.at(-1);
  if (!state || !turn) return null;
  const path = turnPath(root, story, turn.n);
  if (!existsSync(path)) return null;
  const p = project ?? findProject(root);
  if (!p) return null;
  const reader = factory(turn.agent, p);
  const evs = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((l) => reader.read(l));
  const end = evs.findLast((e) => e.type === "end");
  if (end?.type === "end" && end.text) return end.text;
  const text = evs.findLast((e) => e.type === "text" && !e.subagent);
  return text?.type === "text" ? text.text : null;
}

export interface ConversationSummary {
  agent: AgentName | null;
  running: boolean;
  turns: number;
  start: string | null;
  // Début du tour en cours, null au repos.
  turnStart: string | null;
  // Dernier tour fini normalement (ni coupé, ni arrêté, ni refusé) : l'agent s'est arrêté de lui-même.
  stoppedOnItsOwn: boolean;
  // Dernier tour arrêté par Stop (pas par la fermeture de l'app) : la story est en pause.
  paused: boolean;
  interrupted: boolean;
  // Constat de l'outil quand il a cessé de relancer l'agent après le dernier tour, sinon null.
  halted: string | null;
}

export interface ConversationModule extends ServiceModule {
  // Numéro du tour lancé, ou { queued } si un tour ou une fusion est en cours : le message part à leur fin. `head` : en tête de file.
  send(projectId: string, story: string, message: string, agent?: AgentName, options?: { head?: boolean }): Promise<number | { queued: string }>;
  // Une fusion est en cours sur ce fil : les messages attendent la fin de `work`, puis la file part.
  hold(projectId: string, story: string, work: Promise<unknown>): void;
  stop(projectId: string, story: string): Promise<void>;
  summary(projectId: string, root: string, story: string): ConversationSummary;
}

export function conversationModule(factory: AgentFactory = defaultAgentFactory, options: { autoResume?: boolean; autoRestart?: boolean; runner?: boolean; turnTimeoutMs?: number } = {}): ConversationModule {
  const useRunner = options.runner ?? true;
  const autoResume = options.autoResume ?? true;
  const autoRestart = options.autoRestart ?? true;
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  // Relances automatiques consécutives, par « projet/story » ; remises à zéro par un message de l'utilisateur.
  const restarts = new Map<string, { n: number; withoutProgress: number }>();
  // Tours en cours, par « projet/story » ; survivent aux remontages.
  const running = new Map<string, AbortController>();
  const finished = new Map<string, Promise<void>>();
  // Fusions en cours, par « projet/story » (nombre de `hold` actifs).
  const held = new Map<string, number>();
  let closing = false;
  let repaired = false;
  let emit: (type: string, data: unknown) => void = () => {};

  const projectOf = (id: string): Project => {
    const project = findProject(projectById(id).root);
    if (project === null) throw new HttpError(409, `le projet ${id} n'est plus un projet Spawn`);
    return project;
  };

  const view = (project: Project, story: string, key: string): ConversationView => {
    const state = readState(project.root, story);
    const turns: ConversationTurn[] = (state?.turns ?? []).slice(-TURNS_SHOWN).map((t) => {
      const path = turnPath(project.root, story, t.n);
      const raw = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
      const reader = factory(t.agent, project);
      return { ...t, events: raw.flatMap((l) => reader.read(l)) };
    });
    return { agent: state?.agent ?? null, session: state?.session ?? null, running: running.has(key), queued: readQueue(project.root, story), turns };
  };

  // Le worktree de la story : celui qu'elle déclare, sinon celui de son nom, créé au premier message.
  const storyDir = async (project: Project, story: string): Promise<string> => {
    const declared = readStory(project.root, story)?.worktree;
    if (declared && existsSync(join(project.root, declared))) return join(project.root, declared);
    const expected = join(project.root, ".claude", "worktrees", story);
    if (existsSync(expected)) return expected;
    return createWorktree({ cwd: project.root, name: story }, { log: () => {} });
  };

  // `manual` : tour sans l'enchaîneur (après un échec de celui-ci), l'orchestrateur fait lui-même l'étape qui a échoué.
  const launch = async (projectId: string, project: Project, story: string, message: string, agent: AgentName, auto = false, manual = false): Promise<number> => {
    const key = `${projectId}/${story}`;
    if (!auto) restarts.delete(key);
    // La file part avec ce tour (après le message donné), dans l'ordre : un seul tour, jamais deux files en concurrence.
    const queued = readQueue(project.root, story);
    if (queued.length > 0) writeQueue(project.root, story, []);
    message = [message, ...queued.map((q) => q.message)].filter(Boolean).join("\n\n");
    const before = fingerprint(project.root, story);
    const previous = readState(project.root, story);
    const state: ConversationState = previous && previous.agent === agent ? previous : { agent, session: null, turns: previous?.turns ?? [] };
    const n = (state.turns.at(-1)?.n ?? 0) + 1;
    const turn: StoredTurn = { n, agent, message, start: new Date().toISOString(), end: null, code: null, stopped: false, interrupted: false, refused: [] };
    state.turns.push(turn);
    writeState(project.root, story, state);
    const controller = new AbortController();
    running.set(key, controller);
    // Un agent travaille : le runtime refuse d'être réinstallé ou changé pendant ce temps (SGS-09).
    recordActivity("service", [...running.keys()]);
    emit("conversation", { project: projectId, story, turn: n, events: [] });

    const work = (async () => {
      const adapter = factory(agent, project);
      const chaining = useRunner && adapter.delegate !== undefined;
      let dir: string | null = null;
      const output = turnPath(project.root, story, n);
      const tail = new Tail(output);
      const push = () => {
        const events: AgentEvent[] = tail.lines().flatMap((l) => adapter.read(l));
        // La session est écrite dès qu'elle est connue : une coupure en plein premier tour reste reprenable.
        const start = events.find((e) => e.type === "start");
        if (start?.type === "start" && start.session && start.session !== state.session) {
          state.session = start.session;
          writeState(project.root, story, state);
        }
        if (events.length > 0) emit("conversation", { project: projectId, story, turn: n, events });
      };
      const timer = setInterval(push, 250);
      try {
        // Premier tour d'une session : ce qui ferait échouer l'agent (périmètre inactif compris) arrête tout ici.
        if (state.session === null) turn.refused = await adapter.check(project.root);
        if (turn.refused.length === 0) {
          dir = await storyDir(project, story);
          const env = chaining && !manual ? { [RUNNER_ENV]: "service" } : undefined;
          const r = await adapter.turn({ dir, message, session: state.session, output, timeoutMs: turnTimeoutMs, signal: controller.signal, ...(env ? { env } : {}) });
          turn.code = r.code;
          state.session = r.session;
        }
      } catch (e) {
        turn.refused = [`tour impossible : ${(e as Error).message}`];
      } finally {
        clearInterval(timer);
        push();
        turn.end = new Date().toISOString();
        // Fermer l'app coupe le tour comme un arrêt du PC : il est à reprendre, ce n'est pas un Stop voulu.
        turn.interrupted = closing;
        turn.stopped = controller.signal.aborted && !closing;
        if (!controller.signal.aborted && Date.parse(turn.end) - Date.parse(turn.start) >= turnTimeoutMs) turn.timedOut = true;
        writeState(project.root, story, state);
        running.delete(key);
        recordActivity("service", [...running.keys()]);
        // Fusionné pendant le tour : le worktree se range maintenant que l'agent n'y est plus.
        if (!closing) {
          try {
            tidyMerged(project.root, story);
          } catch {
            // Rangement impossible (dossier encore ouvert) : `spawn cleanup` le fera ; la livraison est faite.
          }
        }
        // L'agent s'est arrêté de lui-même alors que la story attend son travail : relancé, sans l'utilisateur.
        let restarted = false;
        // Étapes que l'outil fait seul (implémenteur, relecteur, ledger) : l'enchaîneur passe avant toute relance.
        // Un tour sans enchaîneur (après son échec) qui n'a rien fait avancer ne le relance pas : sinon échec, tour, échec…
        let chained = false;
        if (chaining && dir !== null && !(manual && fingerprint(project.root, story) === before) && !closing && !turn.stopped && turn.refused.length === 0 && readQueue(project.root, story).length === 0 && !held.has(key)) {
          const ctx = existsSync(dir) ? contextOf(dir) : null;
          if (ctx?.story && nextAction(ctx).run) {
            chained = true;
            chain(projectId, project, story, agent, ctx);
          }
        }
        if (autoRestart && !chained && !closing && !turn.stopped && turn.refused.length === 0 && needsRestart(project.root, story)) {
          const count = restarts.get(key) ?? { n: 0, withoutProgress: 0 };
          const withoutProgress = fingerprint(project.root, story) === before ? count.withoutProgress + 1 : 0;
          if (count.n < MAX_RESTARTS && withoutProgress < MAX_WITHOUT_PROGRESS) {
            restarts.set(key, { n: count.n + 1, withoutProgress });
            restarted = true;
          } else {
            restarts.set(key, { ...count, withoutProgress });
            // Plus de relance : le fil attend l'utilisateur, et le dit (jamais un fil « actif » que plus rien ne fait avancer).
            turn.halted = haltNotice(dir, count.n, withoutProgress >= MAX_WITHOUT_PROGRESS, lastReply(project.root, story, factory, project));
            writeState(project.root, story, state);
            updateStory(project.root, story, { status: "blocked:decision", task: "relances arrêtées : ta décision" });
          }
        }
        // Les messages en file passent avant la relance automatique ; après un Stop ou une fermeture, ils attendent.
        if (!closing && !turn.stopped && readQueue(project.root, story).length > 0 && !held.has(key)) {
          restarted = false;
          void launch(projectId, project, story, "", agent, true).catch(() => {});
        } else if (restarted) void launch(projectId, project, story, turn.timedOut ? `${timeoutNotice(turnTimeoutMs)}\n\n${RESTART_MESSAGE}` : RESTART_MESSAGE, agent, true);
        emit("conversation-end", { project: projectId, story, turn: n, code: turn.code, stopped: turn.stopped, refused: turn.refused, restarted });
      }
    })();
    finished.set(key, work);
    void work.finally(() => {
      if (finished.get(key) === work) finished.delete(key);
    });
    return n;
  };

  // L'enchaîneur occupe le fil comme un tour (Stop l'arrête, les messages attendent), puis rend la main à l'orchestrateur
  // avec ce qu'il a fait et l'action suivante ; après un échec, ce tour-là se fait sans lui.
  const chain = (projectId: string, project: Project, story: string, agent: AgentName, ctx: Context): void => {
    const key = `${projectId}/${story}`;
    const controller = new AbortController();
    running.set(key, controller);
    recordActivity("service", [...running.keys()]);
    emit("conversation", { project: projectId, story, turn: readState(project.root, story)?.turns.at(-1)?.n ?? 0, events: [] });
    const work = (async () => {
      let text: string;
      let failed = true;
      try {
        const outcome = await runTasks({ ctx, agent: factory(agent, project), signal: controller.signal });
        failed = outcome.reason !== "handed-back";
        text = renderOutcome(outcome, renderAction);
      } catch (e) {
        text = `enchaîneur en échec : ${(e as Error).message}\n\n${RESTART_MESSAGE}`;
      } finally {
        running.delete(key);
        recordActivity("service", [...running.keys()]);
      }
      if (closing || controller.signal.aborted) {
        emit("conversation-end", { project: projectId, story, turn: readState(project.root, story)?.turns.at(-1)?.n ?? 0, code: null, stopped: true, refused: [], restarted: false });
        return;
      }
      await launch(projectId, project, story, text, agent, true, failed);
    })();
    finished.set(key, work);
    void work.catch(() => {}).finally(() => {
      if (finished.get(key) === work) finished.delete(key);
    });
  };

  const send = async (projectId: string, story: string, message: string, agent?: AgentName, options: { head?: boolean } = {}): Promise<number | { queued: string }> => {
    if (!validName(story)) throw new HttpError(400, `nom de fil invalide : « ${story} » (minuscules, chiffres, tirets)`);
    const project = projectOf(projectId);
    const chosen = agent ?? readState(project.root, story)?.agent ?? "claude-code";
    if (!AGENTS.includes(chosen)) throw new HttpError(400, `agent inconnu : ${String(chosen)} (${AGENTS.join(", ")})`);
    const key = `${projectId}/${story}`;
    const text = message.trim();
    const waiting = readQueue(project.root, story);
    if (running.has(key) || held.has(key) || options.head === true) {
      const entry: Queued = { id: randomUUID(), message: text, date: new Date().toISOString() };
      writeQueue(project.root, story, options.head ? [entry, ...waiting] : [...waiting, entry]);
      // Un fil encore sans conversation garde l'agent choisi pour le tour qui sortira de la file.
      if (!readState(project.root, story)) writeState(project.root, story, { agent: chosen, session: null, turns: [] });
      if (!running.has(key) && !held.has(key)) return launch(projectId, project, story, "", chosen);
      return { queued: entry.id };
    }
    // Au repos avec une file restée là (après un Stop) : elle part avec ce message, qui s'ajoute à sa suite.
    if (waiting.length > 0) {
      writeQueue(project.root, story, [...waiting, { id: randomUUID(), message: text, date: new Date().toISOString() }]);
      return launch(projectId, project, story, "", chosen);
    }
    return launch(projectId, project, story, text, chosen);
  };

  // Fin d'une fusion : la file part, sauf si un tour tourne déjà ou qu'une autre fusion tient encore le fil.
  const hold = (projectId: string, story: string, work: Promise<unknown>): void => {
    const key = `${projectId}/${story}`;
    held.set(key, (held.get(key) ?? 0) + 1);
    void work.catch(() => {}).finally(() => {
      const left = (held.get(key) ?? 1) - 1;
      if (left > 0) return held.set(key, left);
      held.delete(key);
      if (closing || running.has(key)) return;
      try {
        const project = projectOf(projectId);
        const state = readState(project.root, story);
        if (state && readQueue(project.root, story).length > 0) void launch(projectId, project, story, "", state.agent).catch(() => {});
      } catch {
        // projet disparu : la file reste écrite
      }
    });
  };

  const resume = async (projectId: string, story: string): Promise<number> => {
    const project = projectOf(projectId);
    const state = readState(project.root, story);
    const last = state?.turns.at(-1);
    if (running.has(`${projectId}/${story}`)) throw new HttpError(409, "un tour est déjà en cours sur ce fil");
    // Reprenable : coupé (app fermée), arrêté par Stop, ou fini sans point d'arrêt. Un tour refusé par l'adaptateur ou
    // sans fin n'a rien à reprendre : le message suffit.
    if (!state || !last || last.end === null || (last.refused.length > 0 && !last.interrupted)) throw new HttpError(409, "rien à reprendre : aucun tour de ce fil n'a été coupé, arrêté ou fini sans point d'arrêt");
    return launch(projectId, project, story, last.interrupted ? resumeMessage(last.message, state.session !== null) : RESTART_MESSAGE, state.agent);
  };

  return {
    send,
    hold,
    async stop(projectId, story) {
      const key = `${projectId}/${story}`;
      running.get(key)?.abort();
      await finished.get(key);
    },
    summary(projectId, root, story) {
      const state = readState(root, story);
      const last = state?.turns.at(-1);
      const busy = running.has(`${projectId}/${story}`);
      return {
        agent: state?.agent ?? null,
        running: busy,
        turns: state?.turns.length ?? 0,
        start: state?.turns[0]?.start ?? null,
        turnStart: busy && last ? last.start : null,
        stoppedOnItsOwn: !busy && last !== undefined && last.end !== null && !last.interrupted && !last.stopped && last.refused.length === 0,
        paused: !busy && last?.stopped === true,
        halted: !busy ? (last?.halted ?? null) : null,
        interrupted: !busy && last?.interrupted === true,
      };
    },
    id: "conversation",
    title: "Conversation",
    description: "Parler à l'agent du fil (Claude Code ou OpenCode) : message, réponse au fil de l'eau, Stop, reprise de session.",
    defaultOn: true,
    dependencies: ["stories"],
    start(ctx) {
      emit = ctx.emit;
      // Une fois par démarrage du service : aucun tour ne tourne encore, ceux restés sans fin ont été coupés.
      if (!repaired) {
        repaired = true;
        for (const p of readRegistry()) {
          const dir = join(p.root, ".spawn", "conversations");
          if (!existsSync(dir)) continue;
          for (const story of readdirSync(dir)) {
            markInterrupted(p.root, story);
            // Reprise sans l'utilisateur ; si elle échoue, la story reste coupée et l'app propose « Reprendre ».
            if (autoResume && conversationInterrupted(p.root, story)) setTimeout(() => void resume(p.id, story).catch(() => {}), 0);
          }
        }
      }
      const path = "/api/projects/:id/stories/:story/conversation";
      ctx.routes.add("GET", path, ({ params }) => {
        const story = params.story ?? "";
        return view(projectOf(params.id ?? ""), story, `${params.id}/${story}`);
      });
      ctx.routes.add("POST", path, async ({ params, body }) => {
        const c = (body ?? {}) as { message?: unknown; agent?: unknown };
        if (typeof c.message !== "string" || !c.message.trim()) throw new HttpError(400, 'corps attendu : { "message": "…", "agent"?: "claude-code"|"opencode" }');
        const r = await send(params.id ?? "", params.story ?? "", c.message, c.agent as AgentName | undefined);
        return typeof r === "number" ? { turn: r } : r;
      });
      ctx.routes.add("DELETE", `${path}/queue/:qid`, ({ params }) => {
        const project = projectOf(params.id ?? "");
        const story = params.story ?? "";
        const queue = readQueue(project.root, story);
        if (!queue.some((q) => q.id === params.qid)) throw new HttpError(409, "ce message est déjà parti (ou n'existe pas) : il n'est plus en file");
        writeQueue(project.root, story, queue.filter((q) => q.id !== params.qid));
        return { removed: params.qid };
      });
      ctx.routes.add("POST", `${path}/resume`, async ({ params }) => ({ turn: await resume(params.id ?? "", params.story ?? "") }));
      ctx.routes.add("POST", `${path}/stop`, ({ params }) => {
        const controller = running.get(`${params.id}/${params.story}`);
        if (!controller) throw new HttpError(409, "aucun tour en cours sur ce fil");
        controller.abort();
        return { stopped: true };
      });
      return undefined;
    },
    // L'état des tours coupés est écrit avant que le service ne s'arrête (borné : l'arrêt ne doit pas pendre).
    async close() {
      closing = true;
      for (const c of running.values()) c.abort();
      await Promise.race([Promise.all(finished.values()), new Promise((ok) => setTimeout(ok, 5000))]);
    },
  };
}
