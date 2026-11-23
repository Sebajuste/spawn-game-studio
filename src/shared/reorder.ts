// Glisser un élément sur un autre : il prend sa place, les autres se décalent (ordre des projets, ordre du Backlog).
export function moved(ids: readonly string[], dragged: string, target: string): string[] {
  const from = ids.indexOf(dragged);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = ids.filter((id) => id !== dragged);
  next.splice(to, 0, dragged);
  return next;
}
