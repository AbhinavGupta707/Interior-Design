export {
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
  orientation2d,
  polylineLengthBoundsMm,
  segmentsIntersect2d,
  signedDoubleArea2d,
} from "./integer.js";
export { validateCanonicalGeometry } from "./validator.js";
export { geometryFindingCodes } from "./types.js";
export type {
  GeometryFinding,
  GeometryFindingCode,
  GeometryLocation,
  IntegerComputation,
  IntegerComputationFailure,
  IntegerComputationFailureCode,
  IntegerComputationSuccess,
  IntegerLengthBoundsMm,
  Orientation2d,
  Point2Mm,
  SegmentIntersectionKind,
} from "./types.js";
