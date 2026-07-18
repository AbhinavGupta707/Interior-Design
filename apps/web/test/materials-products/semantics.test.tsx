import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CatalogPanel } from "../../src/features/materials-products/catalog-panel";
import { PreviewPanel } from "../../src/features/materials-products/preview-panel";
import { Schedules } from "../../src/features/materials-products/schedules";
import { SelectionBoard } from "../../src/features/materials-products/selection-board";
import {
  artifactReadiness,
  assetSelectable,
  rightsLabel,
  shortHash,
} from "../../src/features/materials-products/presentation";
import {
  assetsResponse,
  chairAsset,
  chairLine,
  ids,
  preview,
  requestedConfirmation,
  retryRequiredConfirmation,
  sofaAsset,
  specification,
  withdrawnAsset,
} from "./fixtures";

const filters = {
  kind: "all" as const,
  pageSize: 9,
  query: "",
  rights: "all" as const,
  source: "all" as const,
};

describe("C13 selection semantics", () => {
  it("labels source, rights, representation, commercial unknowns, and non-drag selection", () => {
    const rendered = renderToStaticMarkup(
      <CatalogPanel
        busy={false}
        candidateAssetVersionId={ids.assetSofa}
        editable
        filters={filters}
        onCandidateChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        page={assetsResponse}
        pageNumber={1}
        selectedLine={chairLine}
      />,
    );
    expect(rendered).toContain("Creator-owned generic asset");
    expect(rendered).toContain("Locally licensed asset");
    expect(rendered).toContain("Validated local GLB");
    expect(rendered).toContain("Placement remains a bounded proxy");
    expect(rendered).toContain("Price not provided");
    expect(rendered).toContain("Supplier not provided");
    expect(rendered).toContain("Stock not provided");
    expect(rendered).toContain("Delivery not provided");
    expect(rendered).toContain("Rights withdrawn");
    expect(rendered).toContain("Use as candidate");
    expect(rendered).toContain(`Version ${chairAsset.version}`);
    expect(rendered).toContain(shortHash(chairAsset.versionId));
    expect(rendered).toContain(
      `Use ${chairAsset.displayName} version ${chairAsset.version} (${shortHash(chairAsset.versionId)}) as candidate`,
    );
    expect(rendered).toContain(
      `Selected ${sofaAsset.displayName} version ${sofaAsset.version} (${shortHash(sofaAsset.versionId)}) as candidate`,
    );
    expect(rendered).toContain(`data-asset-version-id="${sofaAsset.versionId}"`);
    expect(rendered).not.toContain("draggable");
  });

  it("keeps viewer board controls inspect-only and room ambiguity explicit", () => {
    const rendered = renderToStaticMarkup(
      <SelectionBoard
        busy={false}
        editable={false}
        onSave={vi.fn()}
        onSelectLine={vi.fn()}
        selectedLineId={ids.lineFinish}
        specification={specification}
      />,
    );
    expect(rendered).toContain("Room review required");
    expect(rendered).toContain("rather than being guessed in the browser");
    expect(rendered).toContain("Viewer access is inspect-only");
    expect(rendered.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(5);
  });

  it("labels preview truth before confirmation and exact C10 scene job after confirmation", () => {
    const before = renderToStaticMarkup(
      <PreviewPanel
        candidate={sofaAsset}
        editable
        onConfirm={vi.fn()}
        onInterrupt={vi.fn()}
        onPreview={vi.fn()}
        onRetryScene={vi.fn()}
        preview={preview}
        projectId={ids.project}
        selectedLine={chairLine}
      />,
    );
    expect(before).toContain("Bounded catalog preview only");
    expect(before).toContain("not a render, exact appearance");
    expect(before).toContain("not canonical");
    expect(before).not.toContain(`/viewer/${ids.project}?jobId=`);

    const after = renderToStaticMarkup(
      <PreviewPanel
        candidate={sofaAsset}
        confirmation={requestedConfirmation}
        editable
        onConfirm={vi.fn()}
        onInterrupt={vi.fn()}
        onPreview={vi.fn()}
        onRetryScene={vi.fn()}
        preview={preview}
        projectId={ids.project}
        selectedLine={chairLine}
      />,
    );
    expect(after).toContain(`/viewer/${ids.project}?jobId=${ids.sceneJob}`);
    expect(after).toContain("Open exact C10 scene job");
  });

  it("keeps a committed model honest when scene dispatch needs retry and viewers read-only", () => {
    const editable = renderToStaticMarkup(
      <PreviewPanel
        candidate={sofaAsset}
        confirmation={retryRequiredConfirmation}
        editable
        onConfirm={vi.fn()}
        onInterrupt={vi.fn()}
        onPreview={vi.fn()}
        onRetryScene={vi.fn()}
        preview={preview}
        projectId={ids.project}
        selectedLine={chairLine}
      />,
    );
    expect(editable).toContain("Model committed · exact scene unavailable");
    expect(editable).toContain("Retry exact scene");
    expect(editable).not.toContain(`/viewer/${ids.project}?jobId=`);

    const viewer = renderToStaticMarkup(
      <PreviewPanel
        confirmation={retryRequiredConfirmation}
        editable={false}
        onConfirm={vi.fn()}
        onInterrupt={vi.fn()}
        onPreview={vi.fn()}
        onRetryScene={vi.fn()}
        projectId={ids.project}
      />,
    );
    expect(viewer).toContain("Retry exact scene");
    expect(viewer).toMatch(/<button[^>]*disabled=""[^>]*>Retry exact scene<\/button>/u);
    expect(viewer).toContain("Viewer access is inspect-only");
  });

  it("renders four captioned semantic tables from the same exact lines", () => {
    const assets = new Map(assetsResponse.assets.map((asset) => [asset.versionId, asset]));
    const rendered = renderToStaticMarkup(
      <Schedules assets={assets} lines={specification.currentRevision.lines} revision={1} />,
    );
    expect(rendered.match(/<table>/gu)).toHaveLength(4);
    expect(rendered.match(/<caption>/gu)).toHaveLength(4);
    expect(rendered).toContain("Room schedule");
    expect(rendered).toContain("Element schedule");
    expect(rendered).toContain("Product / light schedule");
    expect(rendered).toContain("Finish schedule");
    expect(rendered).toContain("Unknown — not derived in C13");
  });

  it("fails selection for withdrawn rights and reports missing artifact/scale states", () => {
    expect(assetSelectable(chairAsset)).toBe(true);
    expect(assetSelectable(withdrawnAsset)).toBe(false);
    expect(rightsLabel(withdrawnAsset)).toContain("withdrawn");
    const incomplete = {
      ...chairAsset,
      artifacts: chairAsset.artifacts.filter(
        ({ role }) => role !== "model" && role !== "thumbnail",
      ),
      placementProjection: {
        ...chairAsset.placementProjection,
        gltfMetresToInteriorMillimetres: 999,
      },
    } as unknown as typeof chairAsset;
    expect(artifactReadiness(incomplete)).toEqual([
      "Model missing",
      "Thumbnail missing",
      "Scale missing or invalid",
      "Placement remains a bounded proxy",
    ]);
  });
});
