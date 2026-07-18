export type SpecificationDomainErrorCode =
  | "ASSET_BINDING_MISMATCH"
  | "ASSET_NOT_SELECTABLE"
  | "CROSS_KIND_REPLACEMENT"
  | "DUPLICATE_ELEMENT"
  | "ELEMENT_NOT_FOUND"
  | "GEOMETRY_INVALID"
  | "INVALID_REVISION"
  | "LINE_SET_MISMATCH"
  | "SOURCE_MISMATCH";

export class SpecificationDomainError extends Error {
  readonly code: SpecificationDomainErrorCode;

  constructor(code: SpecificationDomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpecificationDomainError";
    this.code = code;
  }
}
