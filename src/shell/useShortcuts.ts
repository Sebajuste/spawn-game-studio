// Raccourcis clavier de la coque (docs/navigation.md §10) ; les menus ne font que les afficher.
import { useEffect } from "react";
import type { Route } from "../navigation/route.ts";
import type { ShellActions } from "./actions.ts";
import type { DialogKind } from "./dialogs.ts";
import { placesOf } from "./places.ts";

export function useShortcuts(route: Route, dialog: DialogKind, act: ShellActions): void {
  useEffect(() => {
    const inScope = route.kind !== "picker";
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const place = ctrl && /^[1-9]$/.test(e.key) ? placesOf(route)[Number(e.key) - 1] : undefined;
      if (ctrl && k === "j") {
        if (inScope) act.talk();
      } else if (ctrl && k === "n") act.open("new");
      else if (ctrl && k === "o") act.open("open");
      else if (ctrl && k === "p") act.open("picker");
      else if (ctrl && k === "k" && inScope) act.open("goto");
      else if (ctrl && k === "w" && inScope) act.closeScope();
      else if (place) act.place(place);
      else if (e.key === "F5" && route.kind === "project") act.launch();
      else if (e.key === "Escape" && dialog) act.closeDialog();
      else if (e.altKey && e.key === "ArrowLeft") window.history.back();
      else if (e.altKey && e.key === "ArrowRight") window.history.forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, dialog, act]);
}
