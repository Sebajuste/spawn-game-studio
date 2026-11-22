// Les actions que l'agent de la conversation demande au service (docs/conversation.md §3) : un objet JSON par bloc
// ```spawn de sa réponse. Lecture stricte : un bloc mal formé est refusé avec sa raison, jamais deviné.

export type TalkScopeKind = "project" | "workspace";

export interface StoryAction {
  kind: "story";
  // Absent dans un projet (la portée le donne) ; obligatoire dans un workspace.
  project?: string;
  request: string;
}

export interface EpicAction {
  kind: "epic";
  title: string;
  acceptance: string[];
  // `after` : indices des stories de cette liste qui doivent passer avant (toujours plus petits que le sien).
  stories: { project: string; request: string; after: number[] }[];
}

export type TalkAction = StoryAction | EpicAction;

const BLOCK = /```spawn[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function readAction(raw: unknown, scope: TalkScopeKind): TalkAction | string {
  if (typeof raw !== "object" || raw === null) return "un objet JSON est attendu";
  const o = raw as Record<string, unknown>;
  if (o.create === "story") {
    const request = text(o.request);
    if (!request) return "story sans « request » (la demande, en une ou plusieurs phrases)";
    if (scope === "project") return { kind: "story", request };
    const project = text(o.project);
    if (!project) return "dans un workspace, une story donne son « project »";
    return { kind: "story", project, request };
  }
  if (o.create === "epic") {
    if (scope !== "workspace") return "un epic se crée dans un workspace, pas dans un projet";
    const title = text(o.title);
    if (!title) return "epic sans « title »";
    if (!Array.isArray(o.stories) || o.stories.length === 0) return "epic sans « stories »";
    const acceptance = Array.isArray(o.acceptance) ? o.acceptance.flatMap((a) => (text(a) ? [text(a) as string] : [])) : [];
    const stories: EpicAction["stories"] = [];
    for (const [i, s] of (o.stories as unknown[]).entries()) {
      const story = (s ?? {}) as Record<string, unknown>;
      const project = text(story.project);
      const request = text(story.request);
      if (!project || !request) return `story ${i} de l'epic sans « project » ou « request »`;
      const after = story.after === undefined ? [] : story.after;
      if (!Array.isArray(after) || !after.every((a) => Number.isInteger(a) && (a as number) >= 0 && (a as number) < i)) {
        return `story ${i} de l'epic : « after » ne peut citer que des stories placées avant elle`;
      }
      stories.push({ project, request, after: after as number[] });
    }
    return { kind: "epic", title, acceptance, stories };
  }
  return `action inconnue : « ${String(o.create)} » (story ou epic)`;
}

export function parseActions(reply: string, scope: TalkScopeKind): { actions: TalkAction[]; errors: string[] } {
  const actions: TalkAction[] = [];
  const errors: string[] = [];
  // Le message final de l'agent répète souvent son dernier texte : un bloc identique ne compte qu'une fois.
  const seen = new Set<string>();
  for (const m of reply.matchAll(BLOCK)) {
    const body = (m[1] ?? "").trim();
    if (seen.has(body)) continue;
    seen.add(body);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      errors.push(`bloc spawn illisible (JSON attendu) : ${body.slice(0, 80)}`);
      continue;
    }
    const r = readAction(raw, scope);
    if (typeof r === "string") errors.push(r);
    else actions.push(r);
  }
  return { actions, errors };
}
