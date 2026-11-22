// « Aller à » (Ctrl+K) : une palette au clavier sur les entrées de la portée.
import { useState } from "react";
import { t } from "../i18n/i18n.ts";
import { matchEntries, type GoToEntry } from "./goto.ts";
import type { Route } from "./route.ts";
import "./navigation.css";

export function GoToDialog({ entries, onClose, onPick }: { entries: GoToEntry[]; onClose: () => void; onPick: (route: Route) => void }) {
  const [text, setText] = useState("");
  const [rank, setRank] = useState(0);
  const list = matchEntries(entries, text);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={t("nav.goto.placeholder")}>
        <input
          autoFocus
          value={text}
          placeholder={t("nav.goto.placeholder")}
          onChange={(e) => {
            setText(e.target.value);
            setRank(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setRank((r) => Math.min(r + 1, list.length - 1));
            else if (e.key === "ArrowUp") setRank((r) => Math.max(r - 1, 0));
            else if (e.key === "Enter" && list[rank]) onPick(list[rank].route);
            else return;
            e.preventDefault();
          }}
        />
        {list.length === 0 && <div className="muted">{t("project.goto.none")}</div>}
        {list.map((entry, i) => (
          <div key={entry.key} className={i === rank ? "selected" : ""} onMouseEnter={() => setRank(i)} onClick={() => onPick(entry.route)}>
            <span>{entry.label}</span>
            <span className="muted">{entry.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
