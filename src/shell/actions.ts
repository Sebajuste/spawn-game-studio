// Les gestes de la coque, partagés par les menus et les raccourcis : un même geste fait la même chose des deux côtés.
import type { Place, Route } from "../navigation/route.ts";
import type { DialogKind } from "./dialogs.ts";

export interface ShellActions {
  navigate: (route: Route) => void;
  open: (dialog: DialogKind) => void;
  closeDialog: () => void;
  // Ctrl+J : l'Accueil de la portée, curseur dans la conversation.
  talk: () => void;
  launch: () => void;
  folder: () => void;
  // Ctrl+W : au parent (workspace) ou au sélecteur.
  closeScope: () => void;
  place: (place: Place) => void;
  toggleModule: (id: string, active: boolean) => void;
}
