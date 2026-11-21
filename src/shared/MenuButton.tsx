// Le menu d'un objet (docs/reglages.md §5) : ⋯ dans l'en-tête d'une story ou d'un epic, ▾ sur le bloc de portée.
// Ouvert au clic ; fermé par Échap, un clic dehors ou un choix ; parcouru aux flèches, Entrée choisit.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useEscape } from "./useEscape.ts";
import "./overlay.css";

export type MenuItem =
  | {
      title: string;
      shortcut?: string;
      // Une suppression, un abandon : en rouge, et toujours derrière la confirmation partagée.
      danger?: boolean;
      disabled?: boolean;
      action: () => void;
    }
  | "-";

interface Props {
  items: MenuItem[];
  // Le contenu du bouton : « ⋯ » par défaut.
  trigger?: ReactNode;
  className?: string;
  title: string;
  align?: "left" | "right";
}

export function MenuButton({ items, trigger = "⋯", className = "btn", title, align = "right" }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEscape(open, close);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [open]);

  const move = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length];
    next?.focus();
  };

  return (
    <div className="menu-button" ref={box}>
      <button className={className} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`object-menu ${align}`} role="menu" ref={list} onKeyDown={move}>
          {items.map((item, i) =>
            item === "-" ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={item.danger ? "danger" : ""}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
              >
                <span>{item.title}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
