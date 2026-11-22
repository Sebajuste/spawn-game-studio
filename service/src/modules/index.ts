// Les modules de l'app, dans l'ordre d'affichage. Ajouter une fonctionnalité = ajouter un module ici.
import type { ServiceModule } from "../module.ts";
import { conversationModule } from "./conversation.ts";
import { backlogModule } from "./backlog.ts";
import { filesModule, galleryModule } from "./files.ts";
import { storiesModule } from "./stories.ts";
import { projectsModule } from "./projects.ts";
import { workspacesModule } from "./workspaces.ts";
import { talkModule } from "./talk/index.ts";
import { activityModule, statusBarModule, contextModule } from "./views.ts";

const conversation = conversationModule();

export const MODULES: readonly ServiceModule[] = [projectsModule, workspacesModule, storiesModule, conversation, backlogModule(conversation), talkModule(conversation), activityModule, contextModule(), statusBarModule, filesModule(), galleryModule];
