// Le fil d'Ariane en tête de la zone principale : chaque segment ramène à son écran, le dernier est l'écran ouvert.
import { Fragment } from "react";
import { t } from "../i18n/i18n.ts";
import type { Crumb } from "./breadcrumb.ts";
import type { Route } from "./route.ts";
import "./navigation.css";

export function Breadcrumb({ crumbs, onNavigate }: { crumbs: Crumb[]; onNavigate: (route: Route) => void }) {
  if (crumbs.length === 0) return null;
  return (
    <nav className="breadcrumb" aria-label={t("nav.breadcrumb")}>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {c.route ? (
            <button onClick={() => c.route && onNavigate(c.route)}>{c.label}</button>
          ) : (
            <b aria-current="page">{c.label}</b>
          )}
        </Fragment>
      ))}
      <span className="breadcrumb-hint">{t("nav.history")}</span>
    </nav>
  );
}
