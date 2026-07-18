export {
  c13SelectionBoardSchemaVersion,
  c13SpecificationLineSchemaVersion,
  c13SpecificationRevisionSchemaVersion,
  c13SpecificationSchemaVersion,
  specificationLineSchema,
  specificationRevisionSchema,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
} from "@interior-design/contracts";

export { deterministicSpecificationUuid, specificationSha256 } from "./canonical.js";
export { SpecificationDomainError, type SpecificationDomainErrorCode } from "./errors.js";
export {
  assertOneLinePerElement,
  assertSelectableCatalogAsset,
  buildInitialSpecificationLines,
  type BuildInitialLinesInput,
} from "./lines.js";
export {
  applySelectionBoard,
  buildSpecificationRevision,
  initialSelectionBoard,
  verifySpecificationRevision,
  type BuildRevisionInput,
  type SelectionBoardEntry,
} from "./revisions.js";
export {
  projectSpecificationSchedules,
  type SpecificationScheduleGroup,
  type SpecificationScheduleKind,
} from "./schedules.js";
export {
  buildCatalogReplacementOperation,
  previewCatalogReplacement,
  substituteSpecificationLine,
  type BuildSubstitutionInput,
} from "./substitution.js";
