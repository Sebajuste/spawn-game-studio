// Barre d'état (docs/navigation.md §7) : les agents au travail dans la portée (un clic ouvre la story), le dernier
// message passager, et l'état du service.
import { t } from "../i18n/i18n.ts";
import type { InboxItem } from "../data/inbox.ts";
import { subtitle } from "../project/storyText.ts";

interface Props {
  working: InboxItem[];
  connected: boolean;
  notice: string | null;
  projectName: (id: string) => string;
  onOpen: (item: InboxItem) => void;
  onNotice: () => void;
}

export function StatusBar({ working, connected, notice, projectName, onOpen, onNotice }: Props) {
  return (
    <footer className="app-status">
      {working.length === 0 && <span>{t("nav.status.none")}</span>}
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
