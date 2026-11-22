// Noms d'agent montrés à l'utilisateur. Les valeurs sont lues à l'affichage (accesseurs) : le texte suit la langue.
import type { AgentName } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";

export const AGENT_NAMES: Record<AgentName, string> = {
  "claude-code": "Claude Code",
  get opencode() {
    return t("project.agent.opencode");
  },
  copilot: "GitHub Copilot",
};
