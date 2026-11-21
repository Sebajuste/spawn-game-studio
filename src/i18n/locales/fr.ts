import type { Messages } from "../i18n.ts";
import { project } from "./zones/project.ts";
import { story } from "./zones/story.ts";
import { misc } from "./zones/misc.ts";
import { workspace } from "./zones/workspace.ts";
import { navigation } from "./zones/navigation.ts";
import { talk } from "./zones/talk.ts";
import { settings } from "./zones/settings.ts";
import { adopt } from "./zones/adopt.ts";

export const fr: Messages = {
  "app.connecting": "Connexion au service…",
  "app.dismiss": "Cliquer pour fermer",

  "menu.file": "Fichier",
  "menu.file.new": "Nouveau projet…",
  "menu.file.open": "Ajouter un projet existant?",
  "menu.file.recent": "Projets récents",
  "menu.project": "Projet",
  "menu.project.launch": "Lancer le projet",
  "menu.project.folder": "Ouvrir le dossier",
  "menu.project.settings": "Réglages du projet…",
  "menu.view": "Affichage",
  "menu.view.goto": "Aller à…",
  "menu.help": "Aide",
  "menu.help.journey": "Parcours de l'app : docs/ux-parcours.md",


  "dialog.cancel": "Annuler",
  "dialog.close": "Fermer",
  "dialog.edit": "Modifier",
  "dialog.browse": "Parcourir…",
  "new.title": "Nouveau projet",
  "new.creating": "Création de « {name} »",
  "new.name": "Nom",
  "new.namePlaceholder": "Casse-briques",
  "new.parent": "Dans le dossier",
  "new.parentPick": "Dossier où créer le projet",
  "new.engine": "Moteur",
  "new.engineVersion": "version du moteur, ex. 4.5.1 pour Godot, 24 pour Node (aucun moteur connu sur cette machine)",
  "new.advanced": "Avancé",
  "new.tag": "Préfixe des exigences (2 à 6 majuscules)",
  "new.tagPlaceholder": "tiré du nom",
  "new.remote": "Dépôt distant",
  "new.remoteLocal": "Local, à côté du projet",
  "new.remoteNone": "Aucun",
  "new.create": "Créer",
  "new.pending": "Création…",
  ...project.fr,
  ...story.fr,
  ...misc.fr,
  ...workspace.fr,
  ...navigation.fr,
  ...talk.fr,
  ...settings.fr,
  ...adopt.fr,
};
