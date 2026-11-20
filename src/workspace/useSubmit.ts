// Création et ajout passent tous par la même forme : un appel, l'erreur du service montrée dans le dialogue.
import { useState } from "react";

export function useSubmit(run: () => Promise<unknown>, onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };
  return { pending, error, submit };
}
