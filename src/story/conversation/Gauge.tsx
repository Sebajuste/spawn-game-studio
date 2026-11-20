import type { AgentEvent } from "../../shared/api.ts";
import { t } from "../../i18n/i18n.ts";

// Place prise dans le contexte de la session principale, rapportée au seuil de compactage.
export function Gauge({ events, max }: { events: AgentEvent[]; max: number | null | undefined }) {
  const usage = [...events].reverse().find((e) => e.type === "usage");
  const used = usage?.type === "usage" ? usage.context : 0;
  const share = max ? Math.min(1, used / max) : 0;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return (
    <div className="gauge" title={max ? t("conversation.gaugeTitle") : t("conversation.gaugeUnknownTitle")}>
      <span className="muted">{t("conversation.context")}</span>
      <div className="gauge-bar">
        <div className={`gauge-fill ${share > 0.85 ? "high" : ""}`} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="muted">{max ? `${k(used)} / ${k(max)}` : max === null ? `${k(used)} / ${t("conversation.unknown")}` : "…"}</span>
    </div>
  );
}
