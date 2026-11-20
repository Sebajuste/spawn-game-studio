// Agents proposés pour une conversation, et leur nom dit à l'utilisateur.
import type { AgentName } from "../../shared/api.ts";
import { t } from "../../i18n/i18n.ts";

export const agentName = (a: AgentName): string => ({ "claude-code": "Claude Code", opencode: t("conversation.agent.opencode"), copilot: "GitHub Copilot" })[a];
export const AGENTS: AgentName[] = ["claude-code", "opencode", "copilot"];
