// Adaptateur d'agent (D8) : ce que le pilote, et demain l'app, attendent d'un agent de code. Le reste (état du fil,
// validation, relances, ménage, bilan) est commun et ne connaît aucun agent.
import type { Tokens } from "../metrics.ts";
import type { AgentEvent } from "./events.ts";

export interface AgentMetrics {
  sessions: number;
  interventions: { session: string; date: string; text: string }[];
  tokens: Tokens;
  by_model: Record<string, Tokens>;
}

export interface Turn {
  code: number | null;
  // Identifiant de session à reprendre au tour suivant.
  session: string | null;
}

export interface AgentAdapter {
  name: "claude-code" | "opencode";
  // Lance (session null) ou reprend une session dans `dossier` ; la sortie brute de l'agent va dans `sortie`.
  // `signal` arrête le tour (bouton Stop de l'app) : l'arbre du processus est tué par son PID.
  // `env` s'ajoute à l'environnement de l'agent (SPAWN_RUNNER : l'enchaîneur du service fait les étapes automatiques).
  turn(o: { dir: string; message: string; session: string | null; output: string; timeoutMs: number; signal?: AbortSignal; env?: Record<string, string> }): Promise<Turn>;
  // Lance un agent du kit (implémenteur, relecteur) seul, en mode non interactif, pour l'enchaîneur (`spawn run`) :
  // une session neuve par geste, son prompt exact, aucune conversation.
  delegate?(o: { dir: string; agent: "implementer" | "task-reviewer"; model: string; prompt: string; output: string; timeoutMs: number; signal?: AbortSignal }): Promise<Turn>;
  // Lit une ligne de la sortie brute du tour en événements normalisés (vide pour une ligne sans intérêt).
  read(line: string): AgentEvent[];
  // Taille de contexte à laquelle rapporter la jauge (seuil de compactage, ou contexte chargé du modèle local) ;
  // null si inconnue : l'app dit « inconnu » plutôt qu'un chiffre faux.
  maxContext(root: string): Promise<number | null>;
  // Tout ce qui ferait échouer au premier tour, périmètre compris ; vide si prêt.
  check(root: string): Promise<string[]>;
  // Mesures des sessions de l'essai (sous-agents compris), lues dans les traces de l'agent.
  measure(o: { root: string; session: string | null; since: string; exportsDir: string }): Promise<AgentMetrics | null>;
}
