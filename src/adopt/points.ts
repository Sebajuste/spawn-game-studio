// Mise en forme du diagnostic et du résultat d'une adoption (docs/adoption.md §2) : les points par groupe, dans l'ordre
// où l'adoption les traite, et ce qu'il faut savoir une fois le projet adopté.
import { t } from "../i18n/i18n.ts";
import type { AdoptionView, DiagnosisPoint, PointGroup, PointStatus } from "../shared/api.ts";

export const MARKS: Record<PointStatus, string> = { ok: "✓", add: "+", complete: "~", warn: "⚠", stop: "⛔" };

const ORDER: PointGroup[] = ["git", "engine", "files", "hooks", "plugin"];

export function groupPoints(points: readonly DiagnosisPoint[]): { group: PointGroup; points: DiagnosisPoint[] }[] {
  return ORDER.map((group) => ({ group, points: points.filter((p) => p.group === group) })).filter((g) => g.points.length > 0);
}

export interface Note {
  status: PointStatus;
  label: string;
  detail?: string;
}

// La suite de départ est dite même rouge ; les manques du gabarit et ce qu'elle a laissé non commité aussi.
export function adoptionNotes(a: AdoptionView): Note[] {
  const notes: Note[] = [];
  const b = a.baseline;
  if (b?.ok) notes.push({ status: "ok", label: t("adopt.note.green", { passed: b.passed, total: b.total }) });
  else if (b && b.failed > 0) notes.push({ status: "warn", label: t("adopt.note.red", { failed: b.failed, total: b.total }), detail: t("adopt.note.redDetail") });
  else if (b) notes.push({ status: "warn", label: t("adopt.note.notRun"), ...(b.message ? { detail: b.message } : {}) });
  for (const g of a.gaps) notes.push({ status: "warn", label: g.message, detail: g.code });
  if (a.leftovers.length > 0) notes.push({ status: "warn", label: t("adopt.note.leftovers"), detail: a.leftovers.join(", ") });
  return notes;
}
