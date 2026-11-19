// Vérification à la compilation (tsc -p tsconfig.kit.json) : le contrat partagé avec l'interface reste égal aux types
// du kit. Une divergence casse la compilation au lieu de tromper l'interface en silence.
import type { Story as KitStory } from "../../kit/core/src/stories.ts";
import type { AgentEvent as KitAgentEvent } from "../../kit/core/src/agent/events.ts";
import type { AgentAdapter } from "../../kit/core/src/agent/type.ts";
import type { Action as KitAction } from "../../kit/core/src/next.ts";
import type { ProgressStep as KitProgressStep } from "../../kit/core/src/progress.ts";
import type { ProjectSettings as KitProjectSettings } from "../../kit/core/src/settings.ts";
import type { Action, AgentEvent, AgentName, ModuleState, ProgressStep, ProjectSettings, Story } from "./contract.ts";
import type { ModuleState as ServiceModuleState } from "./module.ts";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const sameStory: Equal<Story, KitStory> = true;
export const sameAction: Equal<Action, KitAction> = true;
export const sameEvent: Equal<AgentEvent, KitAgentEvent> = true;
export const sameAgent: Equal<AgentName, AgentAdapter["name"]> = true;
export const sameModuleState: Equal<ModuleState, ServiceModuleState> = true;
export const sameProgressStep: Equal<ProgressStep, KitProgressStep> = true;
export const sameSettings: Equal<ProjectSettings, KitProjectSettings> = true;
