// En-tête d'un lieu ou d'un objet : titre, une ligne d'état, et les actions de ce niveau (docs/navigation.md §9).
import type { ReactNode } from "react";

export function PlaceHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="place-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="place-subtitle muted">{subtitle}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}
