import type { DesignBrief } from "@interior-design/contracts";

import styles from "./consultation.module.css";

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

export function ReferenceBoard({ brief }: { readonly brief: DesignBrief }) {
  return (
    <section aria-labelledby="reference-board-title" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.sectionLabel}>Reference board</p>
          <h2 id="reference-board-title">Immutable visual references</h2>
        </div>
        <p className={styles.revision}>{brief.referenceBoard.length} linked</p>
      </header>
      <p className={styles.panelIntro}>
        Each reference points to a rights-recorded source asset. A reference informs preference; it
        does not establish dimensions, product availability or an exact interior.
      </p>
      {brief.referenceBoard.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No references linked</h3>
          <p>References added by a confirmed proposal will appear here with immutable identity.</p>
        </div>
      ) : (
        <ul className={styles.referenceGrid}>
          {brief.referenceBoard.map((item) => (
            <li key={item.id}>
              <div
                aria-hidden="true"
                className={styles.referenceSwatch}
                data-sentiment={item.sentiment}
              >
                <span>
                  {item.sentiment === "like" ? "+" : item.sentiment === "dislike" ? "−" : "·"}
                </span>
              </div>
              <div className={styles.referenceCopy}>
                <strong>{item.sentiment.replaceAll("-", " ")}</strong>
                <p>{item.note ?? "No household note supplied."}</p>
                <dl>
                  <div>
                    <dt>Immutable asset</dt>
                    <dd>
                      <code>{item.assetId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Rights record SHA-256</dt>
                    <dd title={item.rightsRecordSha256}>
                      <code>{shortHash(item.rightsRecordSha256)}</code>
                    </dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
