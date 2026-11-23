// Où en est une story, dit en mots d'utilisateur, sans le vocabulaire du kit.
import type { StoryView } from "../shared/api.ts";
import { t, type Key } from "../i18n/i18n.ts";
import { since } from "../shared/time.ts";

// Étapes de `spawn next` (texte du kit, en français) → clé de message.
const STEP_KEYS: Record<string, Key> = {
  spec: "project.step.spec",
  "en attente de l'utilisateur": "project.step.waitingUser",
  plan: "project.step.plan",
  "plan illisible": "project.step.plan",
  "plan introuvable": "project.step.plan",
  "relecture finale": "project.step.finalReview",
  "preuve et captures": "project.step.proof",
  "compte rendu à juger": "project.step.reportToJudge",
  "à juger": "project.step.toJudge",
  "worktree à commiter": "project.step.toCommit",
  "relecture finale approuvée": "project.step.finalReviewApproved",
  "corrections de la relecture finale": "project.step.finalReviewFixes",
  "correction demandée": "project.step.fixRequested",
  fusion: "project.step.merge",
  "fusion en cours": "project.step.merge",
  "après fusion": "project.step.afterMerge",
};

export function readableStep(step: string | null): string | null {
  if (step === null) return null;
  const task = /^tâche (\d+\/\d+) : (.+?), [^,]+$/.exec(step);
  if (task) return t("project.step.task", { progress: task[1], name: task[2] });
  if (step.startsWith("fusion refusée")) return t("project.step.mergeRefused");
  const key = STEP_KEYS[step];
  return key ? t(key) : step;
}

export function subtitle(f: StoryView): string {
  if (f.group === "history") return t(f.result === "accepted" ? "project.sub.delivered" : f.result === "abandoned" ? "project.sub.abandoned" : "project.sub.closed", { since: since(f.updated) });
  if (f.group === "acceptance") return t("project.sub.acceptance", { since: since(f.updated) });
  if (f.place !== null) return f.place === 1 ? t("project.sub.place.first") : t("project.sub.place.other", { rank: f.place });
  if (f.waiting?.reason === "spec-approval") return t("project.sub.specApproval");
  if (f.waiting?.reason === "question") return t("project.sub.question");
  if (f.waiting?.reason === "interrupted") return t("project.sub.interrupted");
  if (f.waiting?.reason === "paused") return t("project.sub.paused");
  if (f.waiting?.reason === "stopped") return t("project.sub.stopped");
  return readableStep(f.step) ?? t(f.running ? "project.sub.running" : "project.sub.waiting");
}
