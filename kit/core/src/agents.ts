// Sous-agents en cours dans un projet : limite `parallel_agents` (spawn.json), limite `agents` de la machine (tous les
// projets du registre, docs/reglages.md §3.2) et `subagents` des fils pour l'app.
// SubagentStart/Stop tiennent le registre ; PreToolUse sur l'outil Agent réserve une place ou refuse.
// Une réservation couvre le délai entre l'accord et le démarrage, pour que deux lancements simultanés ne passent pas tous deux.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readRegistry } from "./registry.ts";
import { readStory, updateStory } from "./stories.ts";

export const RESERVATION_DURATION_MS = 60_000;
// Un agent sans SubagentStop (session tuée) cesse de compter au bout de ce délai.
export const AGENT_DURATION_MS = 6 * 3600_000;

export interface RunningAgent {
  agent_id: string;
  agent_type: string;
  story: string | null;
  since: string;
  // Session qui l'a lancé ; absente des entrées écrites avant le 22/11.
  session?: string;
}

const dir = (root: string) => join(root, ".spawn", "agents");
const safeName = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

function read<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function running(root: string, now = Date.now()): { agents: RunningAgent[]; reservations: number } {
  const d = dir(root);
  if (!existsSync(d)) return { agents: [], reservations: 0 };
  const agents: RunningAgent[] = [];
  let reservations = 0;
  for (const f of readdirSync(d)) {
    const path = join(d, f);
    if (f.startsWith("reservation-")) {
      const r = read<{ since: string }>(path);
      if (r && now - Date.parse(r.since) < RESERVATION_DURATION_MS) reservations++;
      else rmSync(path, { force: true });
    } else if (f.startsWith("agent-")) {
      const a = read<RunningAgent>(path);
      if (a && now - Date.parse(a.since) < AGENT_DURATION_MS) agents.push(a);
      else rmSync(path, { force: true });
    }
  }
  return { agents, reservations };
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

const sameRoot = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

// Sous-agents et réservations de tous les projets inscrits, et de `root` s'il ne l'est pas (un terminal hors de l'app).
export function machineBusy(root: string, now = Date.now()): number {
  const roots = new Map<string, string>([[sameRoot(root), root]]);
  try {
    for (const p of readRegistry()) roots.set(sameRoot(p.root), p.root);
  } catch {
    // Registre illisible : seul ce projet compte, la limite du projet tient toujours.
  }
  let busy = 0;
  for (const r of roots.values()) {
    const { agents, reservations } = running(r, now);
    busy += agents.length + reservations;
  }
  return busy;
}

// `machineLimit` absent : seule la limite du projet (les tests du registre, qui n'ont pas de machine).
export function reserve(root: string, limit: number, callId: string, now = new Date(), machineLimit?: number): Decision {
  const { agents, reservations } = running(root, now.getTime());
  const busy = agents.length + reservations;
  if (machineLimit !== undefined && busy < limit) {
    const all = machineBusy(root, now.getTime());
    if (all >= machineLimit) {
      return {
        allowed: false,
        reason:
          `${all} sous-agent(s) déjà en cours sur la machine, tous projets confondus ; limite Agents = ${machineLimit} (Réglages > Application > Charge de la machine). ` +
          "Ensuite : attendre la fin de l'un d'eux, puis relancer ; ne pas contourner la limite en faisant le travail toi-même.",
      };
    }
  }
  if (busy >= limit) {
    const list = agents.map((a) => `${a.agent_type}${a.story ? ` (fil ${a.story})` : ""}`).join(", ");
    return {
      allowed: false,
      reason:
        `${busy} sous-agent(s) déjà en cours dans ce projet${list ? ` : ${list}` : ""} ; limite parallel_agents = ${limit} (spawn.json, « spawn limits »). ` +
        "Ensuite : attendre la fin de l'un d'eux, puis relancer ; ne pas contourner la limite en faisant le travail toi-même.",
    };
  }
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(dir(root), `reservation-${safeName(callId)}.json`), JSON.stringify({ since: now.toISOString() }));
  return { allowed: true };
}

// Attend une place (projet et machine) pour un sous-agent lancé par l'outil lui-même (enchaîneur) ; faux si arrêté avant.
export async function acquire(root: string, limit: number, machineLimit: number, callId: string, signal?: AbortSignal, onWait?: (reason: string) => void, pollMs = 5000): Promise<boolean> {
  let told = false;
  for (;;) {
    if (signal?.aborted) return false;
    const d = reserve(root, limit, callId, new Date(), machineLimit);
    if (d.allowed) return true;
    if (!told) onWait?.(d.reason);
    told = true;
    await new Promise<void>((ok) => {
      const t = setTimeout(ok, pollMs);
      signal?.addEventListener("abort", () => (clearTimeout(t), ok()), { once: true });
    });
  }
}

export function start(root: string, agent: Omit<RunningAgent, "since">, now = new Date()): void {
  mkdirSync(dir(root), { recursive: true });
  const path = join(dir(root), `agent-${safeName(agent.agent_id)}.json`);
  const already = existsSync(path);
  writeFileSync(path, JSON.stringify({ ...agent, since: now.toISOString() }));
  // La réservation la plus ancienne devient cet agent ; une reprise (même agent) n'en consomme pas.
  if (!already) {
    const oldest = readdirSync(dir(root)).filter((f) => f.startsWith("reservation-")).sort((a, b) => {
      const da = read<{ since: string }>(join(dir(root), a))?.since ?? "";
      const db = read<{ since: string }>(join(dir(root), b))?.since ?? "";
      return da.localeCompare(db);
    })[0];
    if (oldest) rmSync(join(dir(root), oldest), { force: true });
  }
  if (agent.story) touchStory(root, agent.story, (ids) => [...new Set([...ids, agent.agent_id])]);
}

export function stop(root: string, agentId: string): void {
  const path = join(dir(root), `agent-${safeName(agentId)}.json`);
  const a = read<RunningAgent>(path);
  rmSync(path, { force: true });
  if (a?.story) touchStory(root, a.story, (ids) => ids.filter((id) => id !== agentId));
}

// Un tour fini ou coupé n'a plus de sous-agent vivant : ses places reviennent (constat du 22/11 : un sous-agent tué avec
// l'app gardait la sienne six heures). Ceux d'une autre session (un terminal sur le même fil) restent ; une entrée sans
// session se reconnaît au fil et aux heures du tour.
export function releaseTurn(root: string, story: string, turn: { session: string | null; start: string; end: string }): void {
  const d = dir(root);
  if (!existsSync(d)) return;
  for (const f of readdirSync(d).filter((x) => x.startsWith("agent-"))) {
    const a = read<RunningAgent>(join(d, f));
    if (a === null) continue;
    const since = Date.parse(a.since);
    if (since < Date.parse(turn.start) || since > Date.parse(turn.end)) continue;
    if (a.session === undefined ? a.story === story : a.session === turn.session) stop(root, a.agent_id);
  }
}

function touchStory(root: string, name: string, transform: (ids: string[]) => string[]): void {
  const story = readStory(root, name);
  if (story === null || story.status === "cleaned") return;
  updateStory(root, name, { subagents: transform(story.subagents) });
}
