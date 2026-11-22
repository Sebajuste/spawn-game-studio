// Barre d'état de la conversation : agent, modèle, branche et worktree.
import type { AgentEvent, AgentName } from "../../shared/api.ts";
import { agentName } from "./agents.ts";
import { t } from "../../i18n/i18n.ts";

export function AgentStatus({ agent, events, branch, worktree }: { agent: AgentName | null; events: AgentEvent[]; branch: string | null; worktree: string | null }) {
  const start = [...events].reverse().find((e) => e.type === "start" && e.model);
  return (
    <div className="status-bar">
      <span>{agent ? agentName(agent) : t("conversation.agentToChoose")}</span>
      {start?.type === "start" && start.model && <span>{start.model}</span>}
      {branch && <span>⎇ {branch}</span>}
      {worktree && <span title={worktree}>{worktree}</span>}
    </div>
  );
}
