// « + Nouvelle feature » (docs/navigation.md §9) : la demande en une phrase, et, pour cette feature seulement, un autre
// agent que celui du projet. Entrée envoie, Maj+Entrée va à la ligne, Échap referme.
import { useEffect, useRef, useState } from "react";
import { label, Refusal, useAction } from "../shared/action.ts";
import type { AgentName, Api } from "../shared/api.ts";
import { t } from "../i18n/i18n.ts";
import { AGENT_NAMES } from "./agents.ts";
import { useProjectSettings } from "./useProjectSettings.ts";

export function NewFeatureForm({ api, project, onCreated, onCancel }: { api: Api; project: string; onCreated: (story: string) => void; onCancel: () => void }) {
  const [request, setRequest] = useState("");
  const [agent, setAgent] = useState<AgentName | "">("");
  const { settings } = useProjectSettings(api, project);
  const act = useAction();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);

  const send = async () => {
    const text = request.trim();
    if (!text) return;
    let story = "";
    const ok = await act.run("request", async () => {
      story = (await api.call<{ story: string }>("POST", `/api/projects/${encodeURIComponent(project)}/backlog`, { request: text, ...(agent ? { agent } : {}) })).story;
    });
    if (ok) onCreated(story);
  };

  return (
    <form
      className="card new-feature"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={field}
        rows={2}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={t("project.request.placeholder")}
      />
      <div className="actions">
        <label className="inline-field">
          <span className="muted">{t("nav.feature.agent")}</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value as AgentName | "")}>
            <option value="">{settings ? `${AGENT_NAMES[settings.agent]} ${t("project.board.projectSetting")}` : t("project.board.projectSettingOnly")}</option>
            {(Object.keys(AGENT_NAMES) as AgentName[])
              .filter((a) => a !== settings?.agent)
              .map((a) => (
                <option key={a} value={a}>
                  {t("project.board.forThisFeature", { agent: AGENT_NAMES[a] })}
                </option>
              ))}
          </select>
        </label>
        <span className="spacer" />
        <Refusal action={act} k="request" />
        <button type="button" className="btn" onClick={onCancel}>
          {t("nav.feature.cancel")}
        </button>
        <button type="submit" className="btn primary" disabled={!request.trim() || act.pending !== null}>
          {label(act, "request", t("project.request.send"), t("project.request.sending"))}
        </button>
      </div>
    </form>
  );
}
