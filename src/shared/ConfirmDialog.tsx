// La confirmation partagée (docs/reglages.md §2) : une seule pour toute suppression ou abandon. Elle nomme l'objet et
// dit la conséquence. Le curseur est sur Annuler : Entrée ne confirme pas d'un geste machinal (Tab puis Entrée, ou
// clic) ; Échap annule. Un refus du service s'affiche ici, la fenêtre reste ouverte.
import { useCallback } from "react";
import { t } from "../i18n/i18n.ts";
import { label, Refusal, useAction } from "./action.ts";
import { useEscape } from "./useEscape.ts";
import "./overlay.css";

interface Props {
  title: string;
  consequence: string;
  confirm: string;
  pending: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

export function ConfirmDialog({ title, consequence, confirm, pending, onConfirm, onClose }: Props) {
  const act = useAction();
  const cancel = useCallback(() => {
    if (act.pending === null) onClose();
  }, [act.pending, onClose]);
  useEscape(true, cancel);
  return (
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="confirm" role="alertdialog" aria-label={title}>
        <h3>{title}</h3>
        <p>{consequence}</p>
        <Refusal action={act} k="confirm" />
        <div className="actions end">
          <button className="btn" autoFocus disabled={act.pending !== null} onClick={cancel}>
            {t("dialog.cancel")}
          </button>
          <button className="btn danger" disabled={act.pending !== null} onClick={() => void act.run("confirm", onConfirm).then((ok) => ok && onClose())}>
            {label(act, "confirm", confirm, pending)}
          </button>
        </div>
      </div>
    </div>
  );
}
