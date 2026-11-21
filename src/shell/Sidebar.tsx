// La barre de gauche : la portée, puis ses lieux.
import type { Place } from "../navigation/route.ts";
import { PlaceList } from "./PlaceList.tsx";
import { ScopeBlock, type Scope } from "./ScopeBlock.tsx";

interface Props {
  scope: Scope | null;
  places: Place[];
  current: Place | null;
  badge: number;
  onScope: () => void;
  onSettings: () => void;
  onLaunch: (() => void) | null;
  onPlace: (place: Place) => void;
}

export function Sidebar({ scope, places, current, badge, onScope, onSettings, onLaunch, onPlace }: Props) {
  return (
    <aside className="sidebar">
      <ScopeBlock scope={scope} onChange={onScope} onSettings={onSettings} onLaunch={onLaunch} />
      <PlaceList places={places} current={current} badge={badge} onPick={onPlace} />
    </aside>
  );
}
