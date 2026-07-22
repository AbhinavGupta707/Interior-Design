import { parseProtectedC10Glb } from "@interior-design/render-scene";

import { rendererFailure } from "./errors.js";
import type { GlbInspection, GlbInspectionPort, ProtectedObjectBounds } from "./types.js";

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rendererFailure("RENDER_GLB_UNSAFE");
  }
  return value as Readonly<Record<string, unknown>>;
}

function point(value: unknown): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    rendererFailure("RENDER_GLB_UNSAFE");
  }
  return value as unknown as readonly [number, number, number];
}

function binding(
  value: Readonly<Record<string, unknown>>,
): NonNullable<GlbInspection["c13SpecificationBinding"]> {
  if (
    typeof value.catalogReleaseId !== "string" ||
    typeof value.catalogReleaseSha256 !== "string" ||
    typeof value.specificationId !== "string" ||
    !Number.isSafeInteger(value.specificationRevision) ||
    typeof value.specificationRevisionSha256 !== "string"
  ) {
    rendererFailure("RENDER_GLB_UNSAFE");
  }
  return {
    catalogReleaseId: value.catalogReleaseId,
    catalogReleaseSha256: value.catalogReleaseSha256,
    specificationId: value.specificationId,
    specificationRevision: value.specificationRevision as number,
    specificationRevisionSha256: value.specificationRevisionSha256,
  };
}

/**
 * Parses C10's canonical, protected GLB before Blender is allowed to import it.
 * C10 already rejects external resources, arbitrary extensions and executable text;
 * this adapter turns its verified extras into the narrow renderer boundary shape.
 */
export class C10ProtectedGlbInspector implements GlbInspectionPort {
  inspect(bytes: Uint8Array): Promise<GlbInspection> {
    return Promise.resolve().then(() => this.#inspect(bytes));
  }

  #inspect(bytes: Uint8Array): GlbInspection {
    let parsed: ReturnType<typeof parseProtectedC10Glb>;
    try {
      parsed = parseProtectedC10Glb(bytes);
    } catch {
      rendererFailure("RENDER_GLB_UNSAFE");
    }
    const nodes = parsed.json.nodes;
    if (!Array.isArray(nodes)) rendererFailure("RENDER_GLB_UNSAFE");
    const objectIds: string[] = [];
    const objectBounds: ProtectedObjectBounds[] = [];
    for (const rawNode of nodes) {
      const node = record(rawNode);
      const extras = record(node.extras);
      if (typeof extras.canonicalElementId !== "string" || extras.canonicalElementId.length === 0) {
        rendererFailure("RENDER_GLB_UNSAFE");
      }
      const translation =
        node.translation === undefined ? ([0, 0, 0] as const) : point(node.translation);
      objectIds.push(extras.canonicalElementId);
      objectBounds.push({
        elementId: extras.canonicalElementId,
        maximumMetres: translation,
        minimumMetres: translation,
      });
    }
    if (new Set(objectIds).size !== objectIds.length) rendererFailure("RENDER_GLB_UNSAFE");
    const c13SpecificationBinding = binding(parsed.specificationBinding);
    return {
      c13SpecificationBinding,
      containsDriversOrScripts: false,
      externalResourceCount: 0,
      objectBounds: objectBounds.sort((left, right) => left.elementId.localeCompare(right.elementId)),
      objectIds: objectIds.sort((left, right) => left.localeCompare(right)),
      unsafeExtensionNames: [],
    };
  }
}
