import type { CatalogAssetVersion, SpecificationLine } from "@interior-design/contracts";

import type { CatalogAssetPage, CatalogFilters } from "./contracts";
import styles from "./materials-products.module.css";
import {
  artifactReadiness,
  assetSelectable,
  commercialUnknowns,
  rightsLabel,
  shortHash,
  sourceLabel,
} from "./presentation";

function materialColour(asset: CatalogAssetVersion): string {
  const colour = asset.materials[0]?.baseColourSrgb8 ?? [222, 218, 207];
  return `rgb(${colour.join(" ")})`;
}

export function CatalogPanel({
  busy,
  candidateAssetVersionId,
  editable,
  filters,
  onCandidateChange,
  onFiltersChange,
  onNextPage,
  onPreviousPage,
  page,
  pageNumber,
  selectedLine,
}: {
  readonly busy: boolean;
  readonly candidateAssetVersionId?: string;
  readonly editable: boolean;
  readonly filters: CatalogFilters;
  readonly onCandidateChange: (assetVersionId: string) => void;
  readonly onFiltersChange: (filters: CatalogFilters) => void;
  readonly onNextPage: () => void;
  readonly onPreviousPage: () => void;
  readonly page?: CatalogAssetPage;
  readonly pageNumber: number;
  readonly selectedLine?: SpecificationLine;
}) {
  return (
    <section aria-labelledby="catalog-title" className={styles.catalogPanel}>
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>Versioned local catalog</p>
          <h2 id="catalog-title">Find a same-kind candidate</h2>
        </div>
        <p>
          {page ? `${String(page.total)} records in this filtered release` : "Loading catalog…"}
        </p>
      </header>
      <p className={styles.catalogBoundary} role="note">
        Missing model · missing thumbnail · missing or invalid scale: inspect-only. Withdrawn,
        expired, quarantined, or incomplete rights: inspect-only. A validated local GLB still
        remains a bounded placement proxy.
      </p>
      <form
        aria-label="Catalog filters"
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className={styles.searchField}>
          <span>Search catalog</span>
          <input
            maxLength={120}
            onChange={(event) => {
              onFiltersChange({ ...filters, cursor: undefined, query: event.currentTarget.value });
            }}
            placeholder="Name, category, or material"
            type="search"
            value={filters.query}
          />
        </label>
        <label>
          <span>Kind</span>
          <select
            onChange={(event) => {
              onFiltersChange({
                ...filters,
                cursor: undefined,
                kind: event.currentTarget.value as CatalogFilters["kind"],
              });
            }}
            value={filters.kind}
          >
            <option value="all">All kinds</option>
            <option value="furnishing">Furnishings</option>
            <option value="light">Lights</option>
            <option value="finish">Finishes</option>
          </select>
        </label>
        <label>
          <span>Source</span>
          <select
            onChange={(event) => {
              onFiltersChange({
                ...filters,
                cursor: undefined,
                source: event.currentTarget.value as CatalogFilters["source"],
              });
            }}
            value={filters.source}
          >
            <option value="all">All sources</option>
            <option value="creator-owned-synthetic">Creator-owned generic</option>
            <option value="licensed-local">Locally licensed</option>
          </select>
        </label>
        <label>
          <span>Rights review</span>
          <select
            onChange={(event) => {
              onFiltersChange({
                ...filters,
                cursor: undefined,
                rights: event.currentTarget.value as CatalogFilters["rights"],
              });
            }}
            value={filters.rights}
          >
            <option value="all">All rights states</option>
            <option value="approved">Active review</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="expired">Expired</option>
          </select>
        </label>
      </form>
      {busy ? <p aria-live="polite">Refreshing the bounded catalog page…</p> : null}
      {page?.assets.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No catalog records match</h3>
          <p>Change the filters. No fallback product or commercial data was fabricated.</p>
        </div>
      ) : (
        <ul aria-label="Catalog candidates" className={styles.catalogGrid}>
          {(page?.assets ?? []).map((asset) => {
            const selectable = assetSelectable(asset);
            const sameKind = !selectedLine || selectedLine.kind === asset.kind;
            const selected = candidateAssetVersionId === asset.versionId;
            const candidateActionable = editable && selectable && sameKind;
            const versionLabel = `${asset.displayName} version ${asset.version} (${shortHash(asset.versionId)})`;
            return (
              <li
                className={styles.assetCard}
                data-asset-version-id={asset.versionId}
                data-selected={String(selected)}
                key={asset.versionId}
              >
                <div
                  aria-label={`Material swatch for ${asset.displayName}`}
                  className={styles.assetVisual}
                  style={{ "--asset-colour": materialColour(asset) } as React.CSSProperties}
                >
                  <span>{asset.kind}</span>
                  <strong>{asset.placementProjection.c12Asset.materialLabel}</strong>
                </div>
                <div className={styles.assetBody}>
                  <div className={styles.assetTitle}>
                    <div>
                      <h3>{asset.displayName}</h3>
                      <p>{asset.category}</p>
                      <p>
                        Version {asset.version} · <code>{shortHash(asset.versionId)}</code>
                      </p>
                    </div>
                    <span data-state={selectable ? "ready" : "blocked"}>
                      {selectable ? "Selectable" : "Inspect only"}
                    </span>
                  </div>
                  <p>{asset.description}</p>
                  <dl className={styles.assetFacts}>
                    <div>
                      <dt>Source</dt>
                      <dd>{sourceLabel(asset)}</dd>
                    </div>
                    <div>
                      <dt>Rights</dt>
                      <dd>{rightsLabel(asset)}</dd>
                    </div>
                    <div>
                      <dt>Representation</dt>
                      <dd>{artifactReadiness(asset).join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Commercial data</dt>
                      <dd>{commercialUnknowns.join(" · ")}</dd>
                    </div>
                  </dl>
                  {!sameKind ? (
                    <p className={styles.incompatibility}>Cross-kind replacement is not allowed.</p>
                  ) : null}
                  <button
                    aria-label={
                      selected
                        ? `Selected ${versionLabel} as candidate`
                        : candidateActionable
                          ? `Use ${versionLabel} as candidate`
                          : `Inspect-only ${versionLabel}`
                    }
                    aria-pressed={selected}
                    className={styles.selectCandidate}
                    data-asset-version-id={asset.versionId}
                    disabled={!candidateActionable}
                    onClick={() => {
                      onCandidateChange(asset.versionId);
                    }}
                    type="button"
                  >
                    {selected
                      ? "Candidate selected"
                      : candidateActionable
                        ? "Use as candidate"
                        : "Inspect-only candidate"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <nav aria-label="Catalog pagination" className={styles.pagination}>
        <button disabled={pageNumber === 1 || busy} onClick={onPreviousPage} type="button">
          Previous page
        </button>
        <span aria-live="polite">Page {pageNumber}</span>
        <button disabled={!page?.nextCursor || busy} onClick={onNextPage} type="button">
          Next page
        </button>
      </nav>
    </section>
  );
}
