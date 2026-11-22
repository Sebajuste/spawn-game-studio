// Une ligne de réglage : le libellé à gauche, le champ (ou la valeur lue) à droite, une note dessous s'il en faut une.
import type { ReactNode } from "react";

export function SettingRow({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="setting-value">
        {children}
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}
