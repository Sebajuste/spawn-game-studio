// Une ligne de diagnostic ou de résultat : sa marque (✓ + ~ ⚠ ⛔), son libellé, son détail.
import type { PointStatus } from "../shared/api.ts";
import { MARKS } from "./points.ts";

export function PointLine({ status, label, detail }: { status: PointStatus; label: string; detail?: string | undefined }) {
  return (
    <div className="adopt-point">
      <span className={`mark-${status}`} aria-label={status}>
        {MARKS[status]}
      </span>
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
    </div>
  );
}
