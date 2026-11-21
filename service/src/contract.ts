// Contrat de l'API du service, partagé avec l'interface : des types seuls, sans aucun import, pour que l'interface
// ne tire pas le code Node du kit. `contract-check.ts` vérifie à la compilation qu'ils restent égaux à ceux du kit.

export interface Story {
  story: string;
  status: "active" | "compacting" | "handoff-pending" | `blocked:${string}` | "in-acceptance" | "done" | "cleaned";
  branch: string;
  worktree: string | null;
  base: string;
  task: string | null;
  first_step: string | null;
  subagents: string[];
  mr: string | null;
  updated: string;
}

export interface Action {
  step: string;
  instruction: string;
  commands: string[];
  proof?: string;
}

export interface ModuleState {
  id: string;
  title: string;
  description: string;
  core: boolean;
  active: boolean;
  reason: string | null;
  dependencies: readonly string[];
}

export interface ProjectView {
  id: string;
  name: string;
  root: string;
  engine: string | null;
  version: string | null;
  tag: string | null;
  open_stories: number;
  problem: string | null;
}

// Workspace : état réel de chaque story d'epic, lu dans son projet.
export interface EpicStoryView {
  project: string;
  story: string;
  blocked_by: { project: string; story: string }[];
  state: string;
  merged: boolean;
  waiting_for: { project: string; story: string }[];
  metrics: { verdict: string; duration_min: number; interventions: number; cache_read: number } | null;
}

export interface EpicView {
  id: string;
  title: string;
  acceptance: string[];
  stories: EpicStoryView[];
  merged: number;
}

export interface WorkspaceView {
  id: string;
  name: string;
  projects: string[];
  epics: EpicView[];
}

// État technique d'une story (module stories), avec l'étape donnée par `spawn next`.
export interface StoryStateView extends Story {
  step: string | null;
  // Dernier tour de conversation coupé (arrêt du PC ou de l'app) : à reprendre. Faux sans le module conversation.
  interrupted: boolean;
}

export type AgentName = "claude-code" | "opencode" | "copilot";

// Événements normalisés d'un tour d'agent (kit/core/src/agent/events.ts).
export type AgentEvent =
  | { type: "start"; session: string | null; model: string | null }
  | { type: "text"; text: string; subagent: boolean }
  | { type: "tool"; id: string; name: string; summary: string; files: string[]; subagent: boolean }
  | { type: "tool-result"; id: string; error: boolean; excerpt: string }
  | { type: "subagent"; id: string; agent: string; description: string }
  | { type: "usage"; context: number; output: number }
  | { type: "end"; text: string | null; error: string | null };

export interface ConversationTurn {
  n: number;
  agent: AgentName;
  message: string;
  start: string;
  end: string | null;
  code: number | null;
  stopped: boolean;
  interrupted: boolean;
  refused: string[];
  events: AgentEvent[];
}

export interface ConversationView {
  agent: AgentName | null;
  session: string | null;
  running: boolean;
  // Messages envoyés pendant un tour ou une fusion : ils partent ensemble à sa fin, sauf s'ils sont retirés avant.
  queued: { id: string; message: string; date: string }[];
  turns: ConversationTurn[];
}

// Événements poussés par le module conversation.
export interface ConversationEvent {
  project: string;
  story: string;
  turn: number;
  events: AgentEvent[];
}

export interface ConversationEnd {
  project: string;
  story: string;
  turn: number;
  code: number | null;
  stopped: boolean;
  refused: string[];
  // L'agent s'était arrêté sans raison : un nouveau tour est lancé tout de suite (relance automatique).
  restarted: boolean;
}

// Conversation de portée (docs/conversation.md) : l'Accueil d'un projet ou d'un workspace.
export type TalkScope = "project" | "workspace";

// Ce que le service a fait d'une action demandée par l'agent : vérifié par lui, jamais une promesse de l'agent.
export type TalkActionResult =
  | { kind: "story"; ok: true; project: string; story: string; title: string }
  | { kind: "epic"; ok: true; epic: string; title: string; stories: { project: string; story: string }[] }
  | { kind: "story" | "epic" | "invalid"; ok: false; error: string };

export interface TalkTurn extends ConversationTurn {
  actions: TalkActionResult[];
}

export interface TalkView {
  agent: AgentName | null;
  running: boolean;
  turns: TalkTurn[];
}

// Événements poussés par le module talk : `id` est celui du projet ou du workspace.
export interface TalkEvent {
  scope: TalkScope;
  id: string;
  turn: number;
  events: AgentEvent[];
}

export interface TalkEnd {
  scope: TalkScope;
  id: string;
  turn: number;
}

export interface StoryStateDetail extends StoryStateView {
  ledger: string[];
  next: Action | null;
  refusals: { date: string; tool: string; target: string; reason: string }[];
}

export type FileState = "added" | "modified" | "deleted" | "renamed" | "untracked";
export type PreviewKind = "image" | "video" | "audio" | "text";

export interface TouchedFile {
  // Relatif au dossier de travail de la story.
  path: string;
  state: FileState;
  category: string | null;
  language?: string;
  // Relatif à la racine du projet, pour /api/projects/:id/file et /open ; null pour un fichier supprimé.
  access: string | null;
  // Ce que l'app sait afficher ; null : seulement Ouvrir.
  preview: PreviewKind | null;
}

export interface StoryCapture {
  name: string;
  access: string;
  preview: "image" | "video";
  date: string;
}

export interface StoryFiles {
  // D'où vient la liste : worktree (non commités compris), commit de fusion, branche, ou aucune.
  source: "worktree" | "merge" | "branch" | "none";
  files: TouchedFile[];
  captures: StoryCapture[];
}

// Backlog (module backlog) : la vue utilisateur d'une story (docs/ux-parcours.md). Groupe = ce qui concerne
// l'utilisateur : une décision attendue, une recette, du travail en cours, ou l'historique.
export type StoryGroup = "blocked" | "acceptance" | "active" | "history";

export interface StoryView {
  story: string;
  title: string;
  // La phrase d'origine de l'utilisateur, si la feature a été demandée depuis l'app.
  request: string | null;
  group: StoryGroup;
  status: Story["status"];
  step: string | null;
  // Pourquoi elle attend une réponse : question de l'agent, agent arrêté, coupure.
  // spec-approval : la spec proposée attend l'utilisateur ; `spec` est son chemin relatif à la racine du projet.
  waiting: { reason: "spec-approval" | "question" | "stopped" | "paused" | "interrupted"; text: string | null; spec?: string } | null;
  agent: AgentName | null;
  running: boolean;
  start: string | null;
  updated: string;
  result: "accepted" | "abandoned" | null;
  // Action longue en cours (la fusion prime sur un tour d'agent) et sa date de début ; null au repos.
  operation: { kind: "merge" | "turn"; since: string } | null;
}

// Issue de la dernière fusion connue : livrée (commit), refusée ou en erreur (cause).
export interface LastMerge {
  verdict: "merged" | "refused" | "error";
  cause: string | null;
  commit: string | null;
  date: string;
}

export interface ProgressTask {
  number: number;
  title: string;
  state: "done" | "current" | "pending" | "parked";
  rounds: number;
}

export interface ProgressStep {
  id: "understand" | "breakdown" | "tasks" | "proof" | "acceptance" | "merge";
  title: string;
  state: "done" | "current" | "pending";
  detail: string | null;
  start: string | null;
  end: string | null;
  tasks?: ProgressTask[];
}

// Preuve faite par l'outil lui-même, plus récente que la dernière tâche : c'est la seule que l'app montre comme vérifiée.
export interface ToolProof {
  date: string;
  compilation: string;
  tests: string;
  launch: string;
  end_to_end: string;
}

export interface StoryDetail extends StoryView {
  progress: ProgressStep[];
  // Étape annoncée par `spawn next` que l'avancement ne connaît pas : rendue telle quelle.
  unknownStep: string | null;
  lastMerge: LastMerge | null;
  proof: ToolProof | null;
  // Relecture finale notée propre (verdict du relecteur, exigé par l'outil), plus récente que la dernière tâche.
  reviewed: boolean;
  acceptanceReport: { summary: string; how_to_check: string; date: string } | null;
  branch: string;
  worktree: string | null;
}

export interface ProjectSettings {
  agent: AgentName;
  // Modèle local d'OpenCode : `lmstudio/<modèle>` ou `ollama/<modèle>`.
  localModel: string;
  // Tokens demandés à LM Studio quand l'app charge le modèle local (selon la VRAM de la machine) ; minimum exigé d'Ollama.
  localContext: number;
}

export interface KnownEngine {
  engine: string;
  version: string;
  executable: string;
}

// Moteur proposé par « Nouveau projet » et « Ajouter un projet existant » : un adaptateur présent dans le kit.
export interface AdapterInfo {
  engine: string;
  title: string;
}

// Diagnostic d'adoption (docs/adoption.md §3) : ✓ ok, + add, ~ complete, ⚠ warn, ⛔ stop.
export type PointStatus = "ok" | "add" | "complete" | "warn" | "stop";
export type PointGroup = "git" | "engine" | "files" | "hooks" | "plugin";

export interface DiagnosisPoint {
  status: PointStatus;
  group: PointGroup;
  label: string;
  detail?: string;
}

export interface AdoptGap {
  code: string;
  message: string;
}

export interface Diagnosis {
  dir: string;
  name: string;
  spawn: boolean;
  engine: string | null;
  title: string | null;
  version: string | null;
  tag: string;
  points: DiagnosisPoint[];
  gaps: AdoptGap[];
  gitignore: string[];
  ready: boolean;
}

export interface Baseline {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  message: string | null;
}

export interface AdoptionView {
  project: ProjectView;
  commit: string | null;
  baseline: Baseline | null;
  gaps: AdoptGap[];
  leftovers: string[];
}

// Refus d'adoption (409) : le diagnostic refait, à montrer à la place de l'ancien.
export interface AdoptionRefusal {
  error: string;
  diagnosis: Diagnosis;
}
