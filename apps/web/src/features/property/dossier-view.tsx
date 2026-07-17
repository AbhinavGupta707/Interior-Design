import type {
  PropertyDossier,
  PropertyDossierItem,
  PropertySourceRecord,
} from "@interior-design/contracts";

import { ActionButton } from "../../components/ui-primitives";
import {
  classificationPresentation,
  dossierItemConfidence,
  formatDossierValue,
  formatPropertyDate,
} from "./presentation";

interface DossierViewProps {
  canMutate: boolean;
  conflict: boolean;
  dossier: PropertyDossier;
  onRefresh: () => void;
  onReload: () => void;
  refreshing: boolean;
  sources: PropertySourceRecord[];
}

export function DossierView({
  canMutate,
  conflict,
  dossier,
  onRefresh,
  onReload,
  refreshing,
  sources,
}: DossierViewProps) {
  const sourceRecords = sources.length > 0 ? sources : dossier.sources;
  const sourceLookup = new Map(sourceRecords.map((source) => [source.id, source]));
  const identifiers = dossier.property.identifiers;

  return (
    <div className="dossier-sections">
      <section aria-labelledby="dossier-boundaries-title" className="dossier-boundaries">
        <div>
          <p className="section-label">Current interior</p>
          <h2 id="dossier-boundaries-title">Unknown until supported by explicit evidence</h2>
          <p>
            An address, identifier or context record does not establish the room layout, dimensions,
            wall thickness, structure or condition of this home.
          </p>
        </div>
        <dl>
          <div>
            <dt>Planning</dt>
            <dd>Not reviewed · no clearance or approval claim</dd>
          </div>
          <div>
            <dt>Interior knowledge</dt>
            <dd>Unknown without evidence</dd>
          </div>
          <div>
            <dt>Dossier version</dt>
            <dd>{dossier.version}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="identity-title" className="dossier-identity">
        <header>
          <div>
            <p className="section-label">Selected identity</p>
            <h2 id="identity-title">{dossier.property.displayAddress}</h2>
            <p>
              Selected from a{" "}
              {dossier.property.mode === "manual" ? "manual entry" : "synthetic fixture candidate"}.
              This is an addressable identity, not a surveyed building or legal parcel.
            </p>
          </div>
          <span className="dossier-version">Updated {formatPropertyDate(dossier.generatedAt)}</span>
        </header>
        <dl className="identity-details">
          <div>
            <dt>Jurisdiction</dt>
            <dd>{dossier.property.jurisdiction.replace("-", " ")}</dd>
          </div>
          <div>
            <dt>Selection mode</dt>
            <dd>{dossier.property.mode}</dd>
          </div>
          <div>
            <dt>UPRN</dt>
            <dd>{identifiers[0]?.value ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt>Location point</dt>
            <dd>
              {dossier.property.location
                ? `${dossier.property.location.crs} · ${dossier.property.location.coordinates.join(", ")}`
                : "Not supplied"}
            </dd>
          </div>
        </dl>
        <p className="identity-caveat">
          A UPRN links addressable locations and may share a point with other properties. A location
          point is not a boundary, footprint or interior geometry.
        </p>
      </section>

      <section aria-labelledby="coverage-title" className="coverage-panel">
        <div>
          <p className="section-label">Coverage boundary</p>
          <h2 id="coverage-title">Absence of data is not clearance</h2>
        </div>
        <ul>
          {dossier.coverageWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="labels-title" className="classification-guide">
        <header>
          <p className="section-label">How to read the dossier</p>
          <h2 id="labels-title">Five labels keep evidence and uncertainty separate</h2>
        </header>
        <dl>
          {Object.entries(classificationPresentation).map(([classification, presentation]) => (
            <div data-classification={classification} key={classification}>
              <dt>{presentation.label}</dt>
              <dd>{presentation.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="dossier-items-title" className="dossier-items">
        <header className="section-heading-row">
          <div>
            <p className="section-label">Dossier items</p>
            <h2 id="dossier-items-title">What is known—and what is not</h2>
          </div>
          {canMutate ? (
            <ActionButton disabled={refreshing} onClick={onRefresh} tone="secondary">
              {refreshing ? "Refreshing dossier…" : "Refresh dossier"}
            </ActionButton>
          ) : (
            <span className="read-only-indicator">Viewer · read only</span>
          )}
        </header>

        {conflict ? (
          <div className="stale-alert" role="alert">
            <div>
              <strong>A newer dossier version exists.</strong>
              <span>Your refresh was not applied. Reload before trying again.</span>
            </div>
            <ActionButton onClick={onReload} tone="secondary">
              Reload current dossier
            </ActionButton>
          </div>
        ) : null}

        <div className="dossier-item-list">
          {dossier.items.map((item) => (
            <DossierItem item={item} key={item.key} sourceLookup={sourceLookup} />
          ))}
        </div>
      </section>

      <section aria-labelledby="sources-title" className="source-records">
        <header>
          <p className="section-label">Normalised source records</p>
          <h2 id="sources-title">Inspect provenance and permissions</h2>
          <p>
            Raw provider responses are not exposed. These immutable records retain the normalised
            payload hash, dataset, licence, coverage and allowed uses.
          </p>
        </header>
        {sourceRecords.length === 0 ? (
          <p className="source-empty">No source records are available for this dossier.</p>
        ) : (
          <div className="source-record-list">
            {sourceRecords.map((record) => (
              <SourceRecordDetails key={record.id} record={record} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function DossierItem({
  item,
  sourceLookup,
}: {
  item: PropertyDossierItem;
  sourceLookup: ReadonlyMap<string, PropertySourceRecord>;
}) {
  const presentation = classificationPresentation[item.classification];
  const confidence = dossierItemConfidence(item);
  return (
    <article className="dossier-item" data-classification={item.classification}>
      <div className="dossier-item__classification">
        <span>{presentation.label}</span>
        <small>{presentation.shortLabel}</small>
      </div>
      <div className="dossier-item__content">
        <h3>{item.label}</h3>
        <p className="dossier-item__value">{formatDossierValue(item.value)}</p>
        {item.note ? <p className="dossier-item__note">{item.note}</p> : null}
        <div className="dossier-item__meta">
          {confidence ? <span>{confidence}</span> : null}
          <span>No interior claim</span>
        </div>
        {item.sourceRecordIds.length > 0 ? (
          <ul aria-label={`Sources for ${item.label}`} className="dossier-item__sources">
            {item.sourceRecordIds.map((sourceId) => {
              const source = sourceLookup.get(sourceId);
              return (
                <li key={sourceId}>
                  <a href={`#source-${sourceId}`}>
                    {source
                      ? `${source.source.dataset} · ${source.source.datasetVersion}`
                      : "Source record"}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="dossier-item__no-source">
            No source asserted; value remains explicitly unknown.
          </p>
        )}
      </div>
    </article>
  );
}

function SourceRecordDetails({ record }: { record: PropertySourceRecord }) {
  const { source } = record;
  return (
    <details className="source-record" id={`source-${record.id}`}>
      <summary>
        <span>{source.dataset}</span>
        <small>
          {source.providerId} · {source.datasetVersion}
        </small>
      </summary>
      <div>
        <dl>
          <div>
            <dt>Provider</dt>
            <dd>{source.providerId}</dd>
          </div>
          <div>
            <dt>Dataset / version</dt>
            <dd>
              {source.dataset} / {source.datasetVersion}
            </dd>
          </div>
          <div>
            <dt>Licence</dt>
            <dd>
              {source.licence.url ? (
                <a href={source.licence.url} rel="noreferrer" target="_blank">
                  {source.licence.title}
                </a>
              ) : (
                source.licence.title
              )}{" "}
              ({source.licence.id})
            </dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{source.coverage.replace("-", " ")}</dd>
          </div>
          <div>
            <dt>Retrieved</dt>
            <dd>{formatPropertyDate(source.retrievedAt)}</dd>
          </div>
          <div>
            <dt>Service processing</dt>
            <dd>Allowed</dd>
          </div>
          <div>
            <dt>Project participant sharing</dt>
            <dd>{source.participantSharingAllowed ? "Allowed" : "Denied"}</dd>
          </div>
          <div>
            <dt>Model training</dt>
            <dd className="permission-denied">Denied</dd>
          </div>
          <div>
            <dt>Normalised fields</dt>
            <dd>{record.fields.join(", ")}</dd>
          </div>
          <div className="source-hash">
            <dt>Payload SHA-256</dt>
            <dd>
              <code>{record.normalizedPayloadSha256}</code>
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}
