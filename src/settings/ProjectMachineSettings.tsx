// Les réglages machine d'un projet (`.spawn/settings.json`, hors git) : agent par défaut, modèle local et son contexte.
// L'agent s'enregistre au choix ; le modèle et le contexte à la sortie du champ, et seulement s'ils sont valides.
import type { AgentName, Api } from "../shared/api.ts";
import { Refusal, useAction } from "../shared/action.ts";
import { t } from "../i18n/i18n.ts";
import { AGENT_NAMES } from "../project/agents.ts";
import { useProjectSettings } from "../project/useProjectSettings.ts";
import { BlurField } from "./BlurField.tsx";
import { SettingRow } from "./SettingRow.tsx";

const validModel = (v: string) => /^(lmstudio|ollama)\/\S+$/.test(v);
const contextOf = (v: string) => Number(v.replace(/[\s_]/g, ""));
const validContext = (v: string) => Number.isInteger(contextOf(v)) && contextOf(v) >= 8000 && contextOf(v) <= 1_000_000;

export function ProjectMachineSettings({ api, project }: { api: Api; project: string }) {
  const { settings, save } = useProjectSettings(api, project);
  const act = useAction();
  if (!settings) return <p className="muted">…</p>;
  return (
    <>
      <SettingRow label={t("project.settings.agent")} note={t("project.settings.agentNote")}>
        <select value={settings.agent} disabled={act.pending !== null} onChange={(e) => void act.run("agent", () => save({ ...settings, agent: e.target.value as AgentName }))}>
          {(Object.keys(AGENT_NAMES) as AgentName[]).map((a) => (
            <option key={a} value={a}>
              {AGENT_NAMES[a]}
            </option>
          ))}
        </select>
        <Refusal action={act} k="agent" />
      </SettingRow>
      <SettingRow label={t("project.settings.model")} note={t("project.settings.modelNote")}>
        <BlurField value={settings.localModel} valid={validModel} onSave={(localModel) => save({ ...settings, localModel })} />
      </SettingRow>
      <SettingRow label={t("project.settings.context")} note={t("project.settings.contextNote")}>
        <BlurField value={String(settings.localContext)} valid={validContext} onSave={(v) => save({ ...settings, localContext: contextOf(v) })} />
      </SettingRow>
    </>
  );
}
