// Une action, un retour (SGS-33) : le bouton cliqué affiche son attente, les autres gestes de la carte sont grisés
// jusqu'à la réponse ; un refus s'affiche à côté du bouton, en mots simples, et les gestes redeviennent actifs.
// Une seule action à la fois par carte : le hook ignore un second clic tant que la réponse n'est pas venue.
import { createElement, useCallback, useRef, useState, type ReactElement } from "react";

export interface Action {
  // Clé du bouton cliqué, nulle quand rien n'est en cours.
  pending: string | null;
  refusal: { key: string; text: string } | null;
  // Vrai si le service a accepté ; faux sur refus (le texte est alors dans `refusal`) ou si une action est déjà en cours.
  run(key: string, f: () => Promise<unknown>): Promise<boolean>;
}

export function useAction(): Action {
  const [pending, setPending] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Action["refusal"]>(null);
  // Le state ne se met pas à jour entre deux clics du même instant : la garde passe par une référence.
  const busy = useRef(false);
  const run = useCallback(async (key: string, f: () => Promise<unknown>) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(key);
    setRefusal(null);
    try {
      await f();
      return true;
    } catch (e) {
      setRefusal({ key, text: (e as Error).message });
      return false;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }, []);
  return { pending, refusal, run };
}

// Libellé d'un bouton : son attente tant que c'est lui qui est en cours.
export const label = (a: Action, key: string, idle: string, busy: string): string => (a.pending === key ? busy : idle);

// Le refus de la clé, à placer à côté de son bouton.
export function Refusal({ action, k }: { action: Action; k: string }): ReactElement | null {
  return action.refusal?.key === k ? createElement("span", { className: "refusal", role: "alert" }, action.refusal.text) : null;
}
