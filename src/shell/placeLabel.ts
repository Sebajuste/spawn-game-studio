// Le nom d'un lieu, lu dans la langue courante (barre de lieux, fil d'Ariane, menu Affichage).
import { t } from "../i18n/i18n.ts";
import type { Place } from "../navigation/route.ts";

const KEYS = { home: "nav.place.home", backlog: "nav.place.backlog", epics: "nav.place.epics", projects: "nav.place.projects" } as const;

export const placeLabel = (place: Place): string => t(KEYS[place]);
