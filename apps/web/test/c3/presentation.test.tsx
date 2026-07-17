import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DossierItem } from "../../src/features/property/dossier-view";
import {
  classificationPresentation,
  dossierItemConfidence,
  formatDossierValue,
} from "../../src/features/property/presentation";
import { dossier, sourceRecord } from "./fixtures";

describe("C3 dossier presentation", () => {
  it("defines plain-language help for exactly the five frozen classifications", () => {
    expect(Object.keys(classificationPresentation).sort()).toEqual([
      "estimate",
      "inference",
      "source-observation",
      "unknown",
      "user-assertion",
    ]);
    expect(classificationPresentation.unknown.description).toContain("not filled the gap");
    expect(classificationPresentation["source-observation"].description).toContain(
      "does not establish the current interior",
    );
  });

  it("shows confidence only for estimates and inferences", () => {
    const confidences = dossier.items.map(dossierItemConfidence);
    expect(confidences).toEqual([
      undefined,
      undefined,
      "70% confidence",
      "62% confidence",
      undefined,
    ]);
  });

  it("renders an explicit unknown and a source-linked observation with no interior claim", () => {
    const sourceLookup = new Map([[sourceRecord.id, sourceRecord]]);
    const observationItem = dossier.items[0];
    const unknownItem = dossier.items[4];
    if (!observationItem || !unknownItem)
      throw new Error("The synthetic dossier fixture is incomplete.");
    const observation = renderToStaticMarkup(
      <DossierItem item={observationItem} sourceLookup={sourceLookup} />,
    );
    const unknown = renderToStaticMarkup(
      <DossierItem item={unknownItem} sourceLookup={sourceLookup} />,
    );

    expect(observation).toContain("Source observation");
    expect(observation).toContain("No interior claim");
    expect(observation).toContain(`href="#source-${sourceRecord.id}"`);
    expect(unknown).toContain("Not established");
    expect(unknown).toContain("No source asserted");
  });

  it("formats bounded values without disguising unknowns", () => {
    expect(formatDossierValue({ kind: "unknown" })).toBe("Not established");
    expect(formatDossierValue({ kind: "number", unit: "percent", value: 54 })).toBe("54%");
    expect(formatDossierValue({ kind: "integer", unit: "mm", value: 2400 })).toBe("2400 mm");
  });
});
