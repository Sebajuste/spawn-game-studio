// Réglages du projet (Projet › Réglages) : agent par défaut et modèle local. Rien n'est envoyé tant que c'est invalide.
import { useState } from "react";
import type { AgentName, Api, ProjectSettings } from "../shared/api.ts";
import { Dialog } from "../shared/Dialog.tsx";
import { t } from "../i18n/i18n.ts";
import { AGENT_NAMES } from "./agents.ts";
import { useProjectSettings } from "./useProjectSettings.ts";

export function SettingsDialog({ api, project, name, onClose, onError }: { api: Api; project: string; name: string; onClose: () => void; onError: (e: string) => void }) {
  const { settings, save } = useProjectSettings(api, project);
  if (!settings) return null;
  return (
    <SettingsForm
      key={project}
      initial={settings}
      name={name}
      onClose={onClose}
      onSave={(next) =>
        void save(next)
          .then(onClose)
          .catch((e: Error) => onError(e.message))
      }
    />
  );
}

function SettingsForm({ initial, name, onClose, onSave }: { initial: ProjectSettings; name: string; onClose: () => void; onSave: (r: ProjectSettings) => void }) {
  const [agent, setAgent] = useState<AgentName>(initial.agent);
  const [model, setModel] = useState(initial.localModel);
  const [context, setContext] = useState(String(initial.localContext));
  const value = Number(context.replace(/[s_]/g, ""));
  const valid = Number.isInteger(value) && value >= 8000 && value <= 1_000_000 && /^(lmstudio|ollama)\/\S+$/.test(model.trim());
  return (
    <Dialog title={t("project.settings.title", { name })} onClose={onClose}>
      <label className="field">
        <span>{t("project.settings.agent")}</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
          {(Object.keys(AGENT_NAMES) as AgentName[]).map((a) => (
            <option key={a} value={a}>
              {AGENT_NAMES[a]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small-text">{t("project.settings.agentNote")}</p>
      <label className="field">
        <span>{t("project.settings.model")}</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </label>
      <p className="muted small-text">{t("project.settings.modelNote")}</p>
      <label className="field">
        <span>{t("project.settings.context")}</span>
        <input value={context} onChange={(e) => setContext(e.target.value)} inputMode="numeric" />
      </label>
      <p className="muted small-text">{t("project.settings.contextNote")}</p>
      <div className="actions end">
        <button className="btn" onClick={onClose}>
          {t("project.settings.cancel")}
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ agent, localModel: model.trim(), localContext: value })}>
          {t("project.settings.save")}
        </button>
      </div>
    </Dialog>
  );
}
