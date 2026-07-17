export interface GeometryLocation {
  readonly levelId: string;
  readonly xMm: number;
  readonly yMm: number;
}

export interface GeometryFinding {
  readonly affectedElementIds: readonly string[];
  readonly code: string;
  readonly location?: GeometryLocation;
  readonly message: string;
  readonly severity: "error" | "warning" | "information";
}

export interface Point2Mm {
  readonly xMm: number;
  readonly yMm: number;
}

export type IntegerComputationFailureCode = "SAFE_INTEGER_RANGE_EXCEEDED" | "UNSAFE_INTEGER_INPUT";

export interface IntegerComputationFailure {
  readonly code: IntegerComputationFailureCode;
  readonly message: string;
  readonly ok: false;
}

export interface IntegerComputationSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export type IntegerComputation<TValue> =
  IntegerComputationFailure | IntegerComputationSuccess<TValue>;

export type Orientation2d = -1 | 0 | 1;

export type SegmentIntersectionKind = "cross" | "none" | "overlap" | "touch";

export interface IntegerLengthBoundsMm {
  /** Sum of the floor of each exact Euclidean segment length. */
  readonly lowerBoundMm: number;
  /** Sum of the ceiling of each exact Euclidean segment length. */
  readonly upperBoundMm: number;
}

export const geometryFindingCodes = Object.freeze({
  cameraFovUnknown: "CAMERA_FOV_UNKNOWN",
  cameraPositionUnknown: "CAMERA_POSITION_UNKNOWN",
  cameraTargetCoincident: "CAMERA_TARGET_COINCIDENT",
  cameraTargetOutsideLevel: "CAMERA_TARGET_OUTSIDE_LEVEL",
  cameraTargetUnknown: "CAMERA_TARGET_UNKNOWN",
  elementIdDuplicate: "ELEMENT_ID_DUPLICATE",
  elementIdInvalid: "ELEMENT_ID_INVALID",
  elementPositionOutsideLevel: "ELEMENT_POSITION_OUTSIDE_LEVEL",
  fixedObjectDimensionsUnknown: "FIXED_OBJECT_DIMENSIONS_UNKNOWN",
  fixedObjectPositionUnknown: "FIXED_OBJECT_POSITION_UNKNOWN",
  furnishingDimensionsUnknown: "FURNISHING_DIMENSIONS_UNKNOWN",
  furnishingPositionUnknown: "FURNISHING_POSITION_UNKNOWN",
  geometryIntegerRangeExceeded: "GEOMETRY_INTEGER_RANGE_EXCEEDED",
  geometryResourceLimitExceeded: "GEOMETRY_RESOURCE_LIMIT_EXCEEDED",
  hostWallReferenceInvalid: "HOST_WALL_REFERENCE_INVALID",
  hostWallReferenceMissing: "HOST_WALL_REFERENCE_MISSING",
  levelElevationUnknown: "LEVEL_ELEVATION_UNKNOWN",
  levelReferenceInvalid: "LEVEL_REFERENCE_INVALID",
  levelReferenceMissing: "LEVEL_REFERENCE_MISSING",
  levelStoreyHeightUnknown: "LEVEL_STOREY_HEIGHT_UNKNOWN",
  lightPositionUnknown: "LIGHT_POSITION_UNKNOWN",
  openingAboveHostHeight: "OPENING_ABOVE_HOST_HEIGHT",
  openingBelowHostBase: "OPENING_BELOW_HOST_BASE",
  openingHeightUnknown: "OPENING_HEIGHT_UNKNOWN",
  openingHostExtentIndeterminate: "OPENING_HOST_EXTENT_INDETERMINATE",
  openingHostExtentUnknown: "OPENING_HOST_EXTENT_UNKNOWN",
  openingOffsetUnknown: "OPENING_OFFSET_UNKNOWN",
  openingOutsideHostExtent: "OPENING_OUTSIDE_HOST_EXTENT",
  openingOverlap: "OPENING_OVERLAP",
  openingSillUnknown: "OPENING_SILL_UNKNOWN",
  openingWidthUnknown: "OPENING_WIDTH_UNKNOWN",
  roomBoundaryConnectivityUnknown: "ROOM_BOUNDARY_CONNECTIVITY_UNKNOWN",
  roomBoundaryDisconnected: "ROOM_BOUNDARY_DISCONNECTED",
  roomBoundaryLevelMismatch: "ROOM_BOUNDARY_LEVEL_MISMATCH",
  roomBoundaryNotClosed: "ROOM_BOUNDARY_NOT_CLOSED",
  roomBoundaryReferenceDuplicate: "ROOM_BOUNDARY_REFERENCE_DUPLICATE",
  roomBoundaryReferenceInvalid: "ROOM_BOUNDARY_REFERENCE_INVALID",
  roomBoundaryReferenceMissing: "ROOM_BOUNDARY_REFERENCE_MISSING",
  roomBoundaryReferencesEmpty: "ROOM_BOUNDARY_REFERENCES_EMPTY",
  spaceBoundaryUnknown: "SPACE_BOUNDARY_UNKNOWN",
  spacePolygonDegenerate: "SPACE_POLYGON_DEGENERATE",
  spacePolygonRepeatedVertex: "SPACE_POLYGON_REPEATED_VERTEX",
  spacePolygonSelfIntersection: "SPACE_POLYGON_SELF_INTERSECTION",
  spacePolygonZeroLengthEdge: "SPACE_POLYGON_ZERO_LENGTH_EDGE",
  stairLevelElevationUnknown: "STAIR_LEVEL_ELEVATION_UNKNOWN",
  stairLevelsIdentical: "STAIR_LEVELS_IDENTICAL",
  stairPathRepeatedVertex: "STAIR_PATH_REPEATED_VERTEX",
  stairPathSelfIntersection: "STAIR_PATH_SELF_INTERSECTION",
  stairPathUnknown: "STAIR_PATH_UNKNOWN",
  stairPathZeroLengthSegment: "STAIR_PATH_ZERO_LENGTH_SEGMENT",
  stairRiseLevelMismatch: "STAIR_RISE_LEVEL_MISMATCH",
  stairRiseUnknown: "STAIR_RISE_UNKNOWN",
  stairRunPathIndeterminate: "STAIR_RUN_PATH_INDETERMINATE",
  stairRunPathMismatch: "STAIR_RUN_PATH_MISMATCH",
  stairRunUnknown: "STAIR_RUN_UNKNOWN",
  stairStepCountInvalid: "STAIR_STEP_COUNT_INVALID",
  stairStepCountUnknown: "STAIR_STEP_COUNT_UNKNOWN",
  stairWidthUnknown: "STAIR_WIDTH_UNKNOWN",
  surfaceBoundaryUnknown: "SURFACE_BOUNDARY_UNKNOWN",
  surfaceOutsideLevelVerticalExtent: "SURFACE_OUTSIDE_LEVEL_VERTICAL_EXTENT",
  surfacePolygonDegenerate: "SURFACE_POLYGON_DEGENERATE",
  surfacePolygonNonPlanar: "SURFACE_POLYGON_NON_PLANAR",
  surfacePolygonRepeatedVertex: "SURFACE_POLYGON_REPEATED_VERTEX",
  surfacePolygonSelfIntersection: "SURFACE_POLYGON_SELF_INTERSECTION",
  surfacePolygonZeroLengthEdge: "SURFACE_POLYGON_ZERO_LENGTH_EDGE",
  targetReferenceInvalid: "TARGET_REFERENCE_INVALID",
  targetReferenceMissing: "TARGET_REFERENCE_MISSING",
  wallBaseOffsetUnknown: "WALL_BASE_OFFSET_UNKNOWN",
  wallHeightUnknown: "WALL_HEIGHT_UNKNOWN",
  wallOutsideLevelVerticalExtent: "WALL_OUTSIDE_LEVEL_VERTICAL_EXTENT",
  wallPathRepeatedVertex: "WALL_PATH_REPEATED_VERTEX",
  wallPathSelfIntersection: "WALL_PATH_SELF_INTERSECTION",
  wallPathUnknown: "WALL_PATH_UNKNOWN",
  wallPathZeroLengthSegment: "WALL_PATH_ZERO_LENGTH_SEGMENT",
  wallThicknessUnknown: "WALL_THICKNESS_UNKNOWN",
} as const);

export type GeometryFindingCode = (typeof geometryFindingCodes)[keyof typeof geometryFindingCodes];
