// Barre d'état (docs/navigation.md §7) : la charge de la machine (docs/reglages.md §3.2), les agents au travail dans la
// portée (un clic ouvre la story), le dernier message passager, et l'état du service.
import { t } from "../i18n/i18n.ts";
import type { InboxItem } from "../data/inbox.ts";
import type { LoadView } from "../shared/api.ts";
import { subtitle } from "../project/storyText.ts";

// « 2 stories au travail sur 2 · 1 en attente · 3 agents sur 4 » : tous projets confondus, pas seulement la portée.
export function loadText(l: LoadView): string {
  return [
    t("nav.status.loadStories", { running: l.running.length, max: l.stories }),
    ...(l.waiting.length > 0 ? [t("nav.status.loadWaiting", { n: l.waiting.length })] : []),
    t("nav.status.loadAgents", { running: l.agentsRunning, max: l.agents }),
  ].join(" · ");
}

interface Props {
  load: LoadView | null;
  working: InboxItem[];
  connected: boolean;
  notice: string | null;
  projectName: (id: string) => string;
  onOpen: (item: InboxItem) => void;
  onNotice: () => void;
}

export function StatusBar({ load, working, connected, notice, projectName, onOpen, onNotice }: Props) {
  return (
    <footer className="app-status">
      {load && <span className="load">{loadText(load)}</span>}
      {working.length === 0 && !load && <span>{t("nav.status.none")}</span>}
      {working.map((item) => (
        <button key={`${item.project}/${item.story.story}`} onClick={() => onOpen(item)} title={item.story.title}>
          <span className="dot green pulsing" />
          {projectName(item.project)}/{item.story.title} · {subtitle(item.story)}
        </button>
      ))}
      <span className="spacer" />
      {notice && (
        <span className="notice" onClick={onNotice}>
          {notice}
        </span>
      )}
      <span className={connected ? "" : "alert"}>{t(connected ? "nav.status.connected" : "nav.status.disconnected")}</span>
    </footer>
  );
}
