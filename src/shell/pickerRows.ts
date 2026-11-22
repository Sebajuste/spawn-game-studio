// Les lignes du sélecteur de portée (docs/navigation.md §3) : les workspaces avec leurs projets en retrait, puis les
// projets hors workspace. La recherche garde un workspace si son nom ou l'un de ses projets correspond.
import { projectRoute, workspaceRoute, type Route } from "../navigation/route.ts";

export interface PickerRow {
  key: string;
  kind: "workspace" | "member" | "project";
  label: string;
  // Compte affiché à droite : le texte est fait par l'appelant (langue).
  count: number;
  route: Route;
}

interface P {
  id: string;
  name: string;
  open_stories: number;
}
interface W {
  id: string;
  name: string;
  projects: readonly string[];
}

export function pickerRows(projects: readonly P[], workspaces: readonly W[], search: string): { workspaces: PickerRow[]; standalone: PickerRow[] } {
  const q = search.trim().toLowerCase();
  const hit = (name: string, id: string) => !q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const grouped = new Set(workspaces.flatMap((w) => w.projects));
  const ws: PickerRow[] = [];
  for (const w of workspaces) {
    const members = w.projects.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    });
    const whole = hit(w.name, w.id);
    const shown = whole ? members : members.filter((p) => hit(p.name, p.id));
    if (!whole && shown.length === 0) continue;
    ws.push({ key: `w:${w.id}`, kind: "workspace", label: w.name, count: w.projects.length, route: workspaceRoute(w.id) });
    for (const p of shown) ws.push({ key: `w:${w.id}/${p.id}`, kind: "member", label: p.name, count: p.open_stories, route: projectRoute(p.id, w.id) });
  }
  const standalone = projects.filter((p) => !grouped.has(p.id) && hit(p.name, p.id)).map((p): PickerRow => ({ key: `p:${p.id}`, kind: "project", label: p.name, count: p.open_stories, route: projectRoute(p.id) }));
  return { workspaces: ws, standalone };
}
