// Barre de menus classique (Fichier, Projet, Affichage, Aide) : ouverte au clic, puis au survol des voisins ; fermée par
// un clic ailleurs ou Échap. Les raccourcis sont tenus par App.tsx, les menus ne font que les afficher.
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n.ts";

export interface Entry {
  title: string;
  shortcut?: string;
  detail?: string;
  checked?: boolean;
  disabled?: boolean;
  action?: () => void;
  sub?: Entry[];
}

export interface Menu {
  title: string;
  entries: (Entry | "-")[];
}

export function Menus({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (e: Entry) => {
    if (e.disabled || !e.action) return;
    setOpen(null);
    e.action();
  };

  return (
    <div className="menus" ref={bar} role="menubar">
      {menus.map((m, i) => (
        <div key={m.title} className={`menu ${open === i ? "open" : ""}`}>
          <button className="menu-title" onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
            {m.title}
          </button>
          {open === i && (
            <ul role="menu">
              {m.entries.map((e, j) =>
                e === "-" ? (
                  <li key={j} className="sep" />
                ) : e.sub ? (
                  <li key={j} className="has-sub">
                    <span>{e.title}</span>
                    <span className="shortcut">›</span>
                    <ul>
                      {e.sub.length === 0 && <li className="disabled">{t("menus.none")}</li>}
                      {e.sub.map((s, k) => (
                        <li key={k} className={s.checked ? "checked" : ""} onClick={() => choose(s)} title={s.detail}>
                          <span>{s.title}</span>
                          {s.detail && <span className="shortcut">{s.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : (
                  <li key={j} className={`${e.disabled ? "disabled" : ""} ${e.checked === undefined ? "" : e.checked ? "checked" : "checkbox"}`} onClick={() => choose(e)} title={e.detail}>
                    <span>{e.title}</span>
                    {e.shortcut && <span className="shortcut">{e.shortcut}</span>}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
