// Ce qui diffère d'un agent à l'autre dans les consignes (D8) : noms des agents et skills, gestes de worktree,
// reprise d'un sous-agent, choix du modèle. Le reste de l'outillage ne connaît aucun agent.
export type Agent = "claude-code" | "opencode";

export interface Vocabulary {
  agent: Agent;
  subagent(name: "implementer" | "task-reviewer" | "scene-validator"): string;
  skill(name: "story" | "task" | "review" | "finish-story"): string;
  // Suffixe « , modèle X » ; vide quand l'agent n'a qu'un modèle (modèle local).
  model(name: string): string;
  enterWorktree(name: string): string;
  resumeSubagent: string;
  viewImage: string;
  // L'outil qui lance un sous-agent : pas une skill ni une commande (essai de nuit du 18/11).
  subagentTool: string;
}

const claude: Vocabulary = {
  agent: "claude-code",
  subagent: (name) => `spawnstudio:${name}`,
  skill: (name) => `spawnstudio:${name}`,
  model: (name) => `, modèle ${name}`,
  enterWorktree: (name) => `entrer dans le worktree du fil par l'outil EnterWorktree, nom « ${name} » (le hook du kit crée la branche, l'import du moteur et l'état du fil)`,
  resumeSubagent: "le même implémenteur repris (SendMessage) avec les findings numérotés",
  viewImage: "regardée avec l'outil Read",
  subagentTool: "l'outil Agent (paramètre subagent_type)",
};

const opencode: Vocabulary = {
  agent: "opencode",
  subagent: (name) => `spawn-${name}`,
  skill: (name) => `spawn-${name}`,
  model: () => "",
  enterWorktree: (name) => `créer le fil et son worktree par la commande « spawn story create ${name} », puis terminer la session : le pilote (ou l'app) la relance dans ce worktree`,
  resumeSubagent: "un implémenteur relancé avec le brief, les findings numérotés et git log de la tâche",
  viewImage: "regardée avec l'outil de lecture de fichiers",
  subagentTool: "l'outil subagent (pas l'outil skill)",
};

export function vocabulary(agent = process.env.SPAWN_AGENT): Vocabulary {
  return agent === "opencode" ? opencode : claude;
}
