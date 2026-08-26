import { parseProtectedC10Glb } from "@interior-design/render-scene";

import { rendererFailure } from "./errors.js";
import type { GlbInspection, GlbInspectionPort } from "./types.js";

function binding(
  value: Readonly<Record<string, unknown>> | undefined,
): NonNullable<GlbInspection["c13SpecificationBinding"]> {
  if (
    value === undefined ||
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
    const objectBounds = parsed.objectBounds;
    const objectIds = objectBounds.map(({ elementId }) => elementId);
    if (new Set(objectIds).size !== objectIds.length) rendererFailure("RENDER_GLB_UNSAFE");
    const c13SpecificationBinding = binding(parsed.specificationBinding);
    return {
      c13SpecificationBinding,
      containsDriversOrScripts: false,
      externalResourceCount: 0,
      objectBounds,
      objectIds: objectIds.sort((left, right) => left.localeCompare(right)),
      unsafeExtensionNames: [],
    };
  }
}
