// La zone dangereuse d'une section : une seule action, qui dit sa conséquence, et passe par la confirmation partagée.
import { t } from "../i18n/i18n.ts";

export function DangerZone({ action, consequence, button, onClick }: { action: string; consequence: string; button: string; onClick: () => void }) {
  return (
    <section className="danger-zone-box">
      <h4>{t("settings.danger")}</h4>
      <div className="setting-line">
        <span className="setting-line-text">
          {action}
          <small>{consequence}</small>
        </span>
        <button className="btn danger-outline" onClick={onClick}>
          {button}
        </button>
      </div>
    </section>
  );
}
