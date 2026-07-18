import type { CatalogAssetVersion, SpecificationLine } from "@interior-design/contracts";

import styles from "./materials-products.module.css";
import { lineQuantity, roomLabel, shortHash } from "./presentation";
import { projectScheduleLines } from "./schedule-projection";
import type { ScheduleKind } from "./schedule-projection";

const scheduleDetails: Readonly<Record<ScheduleKind, { caption: string; title: string }>> = {
  element: {
    caption: "One immutable projection row per stable canonical element.",
    title: "Element schedule",
  },
  finish: {
    caption: "Finish selections; quantities are explicitly not derived in C13.",
    title: "Finish schedule",
  },
  "product-light": {
    caption: "Furnishings and lights; no price, supplier, stock, or delivery data is provided.",
    title: "Product / light schedule",
  },
  room: {
    caption: "The same specification lines ordered by explicit room assignment or review state.",
    title: "Room schedule",
  },
};

function ScheduleTable({
  assets,
  kind,
  lines,
}: {
  readonly assets: ReadonlyMap<string, CatalogAssetVersion>;
  readonly kind: ScheduleKind;
  readonly lines: readonly SpecificationLine[];
}) {
  const rows = projectScheduleLines(kind, lines);
  const details = scheduleDetails[kind];
  return (
    <section aria-labelledby={`schedule-${kind}`} className={styles.scheduleBlock}>
      <h3 id={`schedule-${kind}`}>{details.title}</h3>
      <div className={styles.tableScroller} tabIndex={0}>
        <table>
          <caption>{details.caption}</caption>
          <thead>
            <tr>
              <th scope="col">Room / review</th>
              <th scope="col">Element</th>
              <th scope="col">Selection</th>
              <th scope="col">Kind</th>
              <th scope="col">Decision</th>
              <th scope="col">Quantity</th>
              <th scope="col">Rights pin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>No {details.title.toLowerCase()} lines in this revision.</td>
              </tr>
            ) : (
              rows.map((line) => (
                <tr key={line.lineId}>
                  <td>{roomLabel(line)}</td>
                  <th scope="row">
                    <code>{line.elementId}</code>
                  </th>
                  <td>{assets.get(line.assetVersionId)?.displayName ?? line.assetVersionId}</td>
                  <td>{line.kind}</td>
                  <td>{line.decisionStatus.replace("-", " ")}</td>
                  <td>{lineQuantity(line)}</td>
                  <td title={line.rightsRecordSha256}>
                    <code>{shortHash(line.rightsRecordSha256)}</code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Schedules({
  assets,
  lines,
  revision,
}: {
  readonly assets: ReadonlyMap<string, CatalogAssetVersion>;
  readonly lines: readonly SpecificationLine[];
  readonly revision: number;
}) {
  return (
    <section aria-labelledby="schedules-title" className={styles.schedulesPanel}>
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>One line truth · four projections</p>
          <h2 id="schedules-title">Room and specification schedules</h2>
        </div>
        <p>Revision {revision}</p>
      </header>
      <div className={styles.scheduleGrid}>
        {(["room", "element", "product-light", "finish"] as const).map((kind) => (
          <ScheduleTable assets={assets} kind={kind} key={kind} lines={lines} />
        ))}
      </div>
    </section>
  );
}
