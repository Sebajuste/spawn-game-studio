// Exécution des actions demandées par l'agent de la conversation : une story par le chemin unique de création
// (`requestFeature`), un epic par le kit puis ses stories dans l'ordre. Chaque résultat est ce que le service a fait.
import { addEpicStory, createEpic, type StoryRef } from "../../../../kit/core/src/workspaces.ts";
import type { TalkActionResult } from "../../contract.ts";
import type { TalkAction } from "./actions.ts";
import type { TalkTarget } from "./scope.ts";

export type CreateStory = (projectId: string, request: string) => Promise<{ story: string; title: string }>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function inScope(target: TalkTarget, project: string): boolean {
  return target.projects.some((p) => p.id === project);
}

async function runOne(target: TalkTarget, action: TalkAction, create: CreateStory, changed: () => void): Promise<TalkActionResult> {
  if (action.kind === "story") {
    const project = action.project ?? target.host.id;
    if (!inScope(target, project)) return { kind: "story", ok: false, error: `projet « ${project} » hors de ${target.name}` };
    try {
      const r = await create(project, action.request);
      return { kind: "story", ok: true, project, story: r.story, title: r.title };
    } catch (e) {
      return { kind: "story", ok: false, error: message(e) };
    }
  }
  const outside = action.stories.find((s) => !inScope(target, s.project));
  // Vérifié avant de créer quoi que ce soit : un epic à moitié créé serait une dette cachée.
  if (outside) return { kind: "epic", ok: false, error: `projet « ${outside.project} » hors de ${target.name}` };
  let epic: { id: string; title: string };
  try {
    epic = createEpic(target.id, action.title, action.acceptance);
    // Annoncé à chaque écriture : créer les stories d'un epic dure des minutes.
    changed();
  } catch (e) {
    return { kind: "epic", ok: false, error: message(e) };
  }
  const refs: StoryRef[] = [];
  for (const s of action.stories) {
    try {
      const r = await create(s.project, s.request);
      const ref = { project: s.project, story: r.story };
      addEpicStory(target.id, epic.id, ref, s.after.map((i) => refs[i]).filter((x): x is StoryRef => x !== undefined));
      refs.push(ref);
      changed();
    } catch (e) {
      return { kind: "epic", ok: false, error: `${epic.id} créé, mais arrêt à la story ${refs.length + 1}/${action.stories.length} (${s.project}) : ${message(e)}` };
    }
  }
  return { kind: "epic", ok: true, epic: epic.id, title: epic.title, stories: refs };
}

export async function executeActions(target: TalkTarget, actions: TalkAction[], errors: string[], create: CreateStory, changed: () => void): Promise<TalkActionResult[]> {
  const results: TalkActionResult[] = errors.map((error) => ({ kind: "invalid", ok: false, error }));
  for (const a of actions) results.push(await runOne(target, a, create, changed));
  return results;
}

// Ce que l'agent apprend au début du tour suivant : le service a fait (ou refusé) ses actions.
export function reportForAgent(results: readonly TalkActionResult[]): string | null {
  if (results.length === 0) return null;
  const lines = results.map((r) => {
    if (!r.ok) return `- refusé : ${r.error}`;
    if (r.kind === "story") return `- story créée : ${r.project}/${r.story} « ${r.title} »`;
    return `- epic créé : ${r.epic} « ${r.title} » (${r.stories.map((s) => `${s.project}/${s.story}`).join(", ")})`;
  });
  return ["[Spawn] Suite à ta réponse précédente :", ...lines].join("\n");
}
