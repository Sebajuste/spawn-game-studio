// Adaptateur d'agent OpenCode v2 (modèle local servi par LM Studio ou Ollama). Les sessions des sous-agents sont
// exportées à part.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../git.ts";
import { measureOpencode } from "../metrics-opencode.ts";
import { opencodeConfigDir, generateOpencode } from "../opencode.ts";
import { readRefusals } from "../guard/log.ts";
import { excerpt, summarizeTool, type AgentEvent } from "./events.ts";
import type { AgentAdapter } from "./type.ts";
import { runProcess, read, firstField, type Launcher } from "./process.ts";
import { DEFAULT_LOCAL_CONTEXT } from "../settings.ts";

const ENV = { ...process.env, SPAWN_AGENT: "opencode" };

// Sessions enfants : la part du sous-agent (`tool` ou `name` = subagent) porte leur id, dans `state.metadata.sessionID`
// ou dans le texte rendu `<subagent sessionID="…">` selon la version.
export function childSessions(exportJson: unknown): string[] {
  const ids = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.tool === "subagent" || o.name === "subagent") {
        const id = ((o.state as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined)?.sessionID;
        if (typeof id === "string") ids.add(id);
        for (const m of JSON.stringify(o).matchAll(/<subagent sessionID=\\"(ses_[A-Za-z0-9]+)\\"/g)) if (m[1]) ids.add(m[1]);
      }
      Object.values(o).forEach(visit);
    }
  };
  visit(exportJson);
  return [...ids];
}

// Serveur du modèle local, d'après le préfixe du modèle tel qu'OpenCode le nomme (`lmstudio/…`, `ollama/…`).
// OpenCode découvre lui-même les modèles des deux serveurs ; l'outil vérifie avant le premier tour que le modèle est là,
// chargé, et (Ollama) avec assez de contexte.
interface ModelState {
  state: "loaded" | "not-loaded" | "absent";
  // Contexte réellement chargé ; null : non chargé, ou le serveur ne le dit pas.
  context: number | null;
}

interface LocalServer {
  name: string;
  // null : le serveur ne répond pas.
  state(id: string): Promise<ModelState | null>;
  load(id: string, context: string): Promise<void>;
  down: string;
  absent(id: string): string;
  notLoaded(id: string, context: string): string;
}

const getJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.json();
};

const lmstudioUrl = () => process.env.SPAWN_LMSTUDIO_URL ?? "http://127.0.0.1:1234";
const ollamaUrl = () => process.env.SPAWN_OLLAMA_URL ?? "http://127.0.0.1:11434";

const LMSTUDIO: LocalServer = {
  name: "LM Studio",
  async state(id) {
    try {
      const list = ((await getJson(`${lmstudioUrl()}/api/v0/models`)) as { data?: { id: string; state?: string; loaded_context_length?: number }[] }).data ?? [];
      const m = list.find((x) => x.id === id);
      if (!m) return { state: "absent", context: null };
      return { state: m.state === "loaded" ? "loaded" : "not-loaded", context: m.loaded_context_length ?? null };
    } catch {
      return null;
    }
  },
  async load(id, context) {
    await new Promise<void>((ok) => spawn("lms", ["load", id, "-c", context, "-y"], { stdio: "ignore", windowsHide: true }).on("close", () => ok()).on("error", () => ok()));
  },
  down: "LM Studio ne répond pas sur 127.0.0.1:1234 : lancer LM Studio et son serveur (lms server start)",
  absent: (id) => `modèle ${id} inconnu de LM Studio`,
  notLoaded: (id, context) => `modèle ${id} non chargé : le charger dans LM Studio (« lms load ${id} -c ${context} -y », contexte réglé dans les réglages du projet)`,
};

// Ollama : le contexte d'un modèle se fixe côté serveur (OLLAMA_CONTEXT_LENGTH), pas à la requête : les requêtes
// d'OpenCode (API compatible OpenAI) le prennent tel quel. Trop petit, Ollama coupe le début des messages sans rien
// dire et l'agent perd ses consignes : on le mesure sur le modèle chargé et on refuse en dessous du réglage du projet.
const OLLAMA: LocalServer = {
  name: "Ollama",
  async state(id) {
    try {
      const same = (name: string) => name === id || name === `${id}:latest`;
      const tags = ((await getJson(`${ollamaUrl()}/api/tags`)) as { models?: { name: string }[] }).models ?? [];
      if (!tags.some((m) => same(m.name))) return { state: "absent", context: null };
      const ps = ((await getJson(`${ollamaUrl()}/api/ps`)) as { models?: { name: string; context_length?: number }[] }).models ?? [];
      const loaded = ps.find((m) => same(m.name));
      return loaded ? { state: "loaded", context: loaded.context_length ?? null } : { state: "not-loaded", context: null };
    } catch {
      return null;
    }
  },
  async load(id) {
    // Une génération sans prompt charge le modèle, avec le contexte par défaut du serveur : celui qu'OpenCode aura.
    try {
      await fetch(`${ollamaUrl()}/api/generate`, { method: "POST", body: JSON.stringify({ model: id, keep_alive: "30m" }), signal: AbortSignal.timeout(300_000) });
    } catch {
      // L'état relu ensuite dit ce qui manque.
    }
  },
  down: "Ollama ne répond pas sur 127.0.0.1:11434 : lancer Ollama (l'app, ou « ollama serve »)",
  absent: (id) => `modèle ${id} inconnu d'Ollama : « ollama pull ${id} »`,
  notLoaded: (id) => `modèle ${id} non chargé dans Ollama : « ollama run ${id} », ou laisser l'app le charger`,
};

const SERVERS: Record<string, LocalServer> = { lmstudio: LMSTUDIO, ollama: OLLAMA };

export function localServer(model: string): { server: LocalServer; id: string } | null {
  const slash = model.indexOf("/");
  const server = slash > 0 ? SERVERS[model.slice(0, slash)] : undefined;
  return server ? { server, id: model.slice(slash + 1) } : null;
}

interface OpencodePart {
  type?: string;
  id?: string;
  callID?: string;
  text?: string;
  tool?: string;
  name?: string;
  state?: { status?: string; input?: Record<string, unknown>; output?: unknown; error?: unknown };
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
}

// Événements de `opencode run --format json` : step_start, text, parts d'outil (avec leur état), step_finish (tokens).
export function readOpencode(line: string): AgentEvent[] {
  let e: { type?: string; sessionID?: string; part?: OpencodePart; error?: unknown };
  try {
    e = JSON.parse(line) as typeof e;
  } catch {
    return [];
  }
  const p = e.part ?? {};
  if (e.type === "error") return [{ type: "end", text: null, error: typeof e.error === "string" ? e.error : JSON.stringify(e.error).slice(0, 300) }];
  if (e.type === "step_start" || p.type === "step-start") return [{ type: "start", session: e.sessionID ?? null, model: null }];
  if (p.type === "text" && p.text) return [{ type: "text", text: p.text, subagent: false }];
  if (p.type === "step-finish" && p.tokens) return [{ type: "usage", context: (p.tokens.input ?? 0) + (p.tokens.cache?.read ?? 0), output: p.tokens.output ?? 0 }];
  const name = p.tool ?? p.name;
  if (p.type === "tool" && name) {
    const id = p.callID ?? p.id ?? "";
    const { summary, files } = summarizeTool(name, p.state?.input ?? {});
    const evs: AgentEvent[] = [];
    if (name === "subagent") evs.push({ type: "subagent", id, agent: String(p.state?.input?.agent ?? "general"), description: String(p.state?.input?.description ?? summary) });
    evs.push({ type: "tool", id, name, summary, files, subagent: false });
    if (p.state?.status === "completed" || p.state?.status === "error") {
      evs.push({ type: "tool-result", id, error: p.state.status === "error", excerpt: excerpt(p.state.output ?? p.state.error) });
    }
    return evs;
  }
  return [];
}

// Le plugin de périmètre est-il vraiment actif ? S'il ne se chargeait pas, OpenCode tournerait sans garde-fou :
// sur un projet Spawn jetable, une demande de push forcé doit laisser un refus au journal du périmètre.
export async function checkGuard(model: string, run: Launcher = runProcess): Promise<string | null> {
  const base = mkdtempSync(join(tmpdir(), "spawn-controle-opencode-"));
  try {
    const project = join(base, "jeu");
    mkdirSync(project);
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Controle"], ["config", "user.email", "c@x.invalid"]]) git(project, args);
    writeFileSync(join(project, "spawn.json"), JSON.stringify({ engine: "godot", version: "4.7.2" }) + "\n");
    git(project, ["add", "spawn.json"]);
    git(project, ["commit", "-q", "-m", "controle"]);
    const code = await run("opencode", ["run", "--standalone", "--auto", "-m", model, "--format", "json", 'Avec l\'outil shell, lance exactement la commande entre guillemets, sans rien ajouter : "git push --force origin main"'], {
      cwd: project,
      output: join(base, "controle.jsonl"),
      timeoutMs: 5 * 60_000,
      env: ENV,
    });
    // Un lancement raté n'est pas un plugin inactif : le dire tel quel, sinon on cherche la panne au mauvais endroit.
    if (code === null) return "OpenCode n'a pas pu être lancé (introuvable, ou délai dépassé) : vérifier « opencode --version » dans un terminal";
    return readRefusals(project).some((r) => /push --force/.test(r.target)) ? null : "le plugin de périmètre OpenCode n'a rien refusé : essai annulé, il tournerait sans garde-fou";
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
}

// `contexte` : tokens demandés à LM Studio quand le kit charge le modèle (réglage du projet, selon la VRAM).
export function opencodeAdapter(o: { model: string; load?: boolean; context?: number; run?: Launcher }): AgentAdapter {
  const context = String(o.context ?? DEFAULT_LOCAL_CONTEXT);
  const run = o.run ?? runProcess;
  return {
    name: "opencode",
    read: readOpencode,
    async maxContext() {
      const local = localServer(o.model);
      return local ? ((await local.server.state(local.id))?.context ?? null) : null;
    },
    async turn({ dir, message, session, output, timeoutMs, signal, env }) {
      const args = ["run", "--standalone", "--auto", "-m", o.model, "--format", "json", ...(session ? ["--session", session] : []), message];
      const code = await run("opencode", args, { cwd: dir, output, timeoutMs, env: { ...ENV, ...env }, ...(signal ? { signal } : {}) });
      return { code, session: session ?? firstField(output, "sessionID") };
    },
    // Un seul modèle local : celui demandé par le plan est ignoré (le vocabulaire OpenCode n'en nomme aucun).
    async delegate({ dir, agent, prompt, output, timeoutMs, signal, env }) {
      const args = ["run", "--standalone", "--auto", "-m", o.model, "--agent", `spawn-${agent}`, "--format", "json", prompt];
      const code = await run("opencode", args, { cwd: dir, output, timeoutMs, env: { ...ENV, ...env }, ...(signal ? { signal } : {}) });
      return { code, session: firstField(output, "sessionID") };
    },
    async check() {
      const local = localServer(o.model);
      if (!local) return [`modèle local ${o.model} : nom attendu « lmstudio/<modèle> » ou « ollama/<modèle> » (réglages du projet)`];
      const { server, id } = local;
      let m = await server.state(id);
      if (m === null) return [server.down];
      if (m.state === "not-loaded" && o.load) {
        await server.load(id, context);
        m = (await server.state(id)) ?? m;
      }
      const problems: string[] = [];
      if (m.state === "absent") problems.push(server.absent(id));
      else if (m.state !== "loaded") problems.push(server.notLoaded(id, context));
      else if (server === OLLAMA) {
        if (m.context === null) problems.push(`Ollama ne dit pas le contexte chargé de ${id} (version trop ancienne) : mettre Ollama à jour`);
        else if (m.context < Number(context)) {
          problems.push(
            `contexte d'Ollama trop petit pour ${id} : ${m.context} tokens chargés, ${context} demandés par les réglages du projet. Ollama couperait les consignes de l'agent sans le dire. Régler la longueur de contexte d'Ollama (ses réglages, ou la variable OLLAMA_CONTEXT_LENGTH=${context}), le redémarrer, ou baisser le réglage du projet`,
          );
        }
      }
      const stale = generateOpencode().filter((f) => read(f.path) !== f.content);
      if (stale.length > 0) problems.push(`couche OpenCode absente ou périmée (${stale.length} fichier(s) dans ${opencodeConfigDir()}) : spawn prerequisites --install --agent opencode --yes`);
      if (problems.length > 0) return problems;
      const guard = await checkGuard(o.model, run);
      return guard ? [guard] : [];
    },
    async measure({ root, session, exportsDir }) {
      const exports: unknown[] = [];
      const seenSessions: string[] = [];
      const todo = session ? [session] : [];
      while (todo.length > 0) {
        const id = todo.shift() as string;
        if (seenSessions.includes(id)) continue;
        seenSessions.push(id);
        const file = join(exportsDir, `${id}.json`);
        await run("opencode", ["session", "export", id, "--standalone"], { cwd: root, output: file, timeoutMs: 5 * 60_000, env: ENV });
        try {
          const content: unknown = JSON.parse(read(file));
          exports.push(content);
          todo.push(...childSessions(content));
        } catch {
          // export illisible : la session ne compte pas, le bilan le montre par son nombre de sessions
        }
      }
      return exports.length > 0 ? measureOpencode(exports) : null;
    },
  };
}
