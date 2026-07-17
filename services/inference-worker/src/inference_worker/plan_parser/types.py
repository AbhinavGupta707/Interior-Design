"""Internal immutable types for the C6 plan parser."""

from dataclasses import dataclass
from typing import Literal

type JsonScalar = str | int | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
type JsonObject = dict[str, JsonValue]
type ParserMode = Literal["deterministic-vector", "deterministic-raster", "deterministic-fixture"]
type NormalizedKind = Literal["vector", "fixture", "raster-gray8"]
type OpeningKind = Literal["door", "window", "unknown"]


@dataclass(frozen=True, order=True, slots=True)
class Point:
    """One integer point in the normalized source coordinate space."""

    x: int
    y: int


@dataclass(frozen=True, slots=True)
class Segment:
    """A normalized straight source segment."""

    start: Point
    end: Point
    confidence: int

    def canonical(self) -> "Segment":
        if self.start <= self.end:
            return self
        return Segment(start=self.end, end=self.start, confidence=self.confidence)


@dataclass(frozen=True, slots=True)
class OpeningSegment:
    """An opening marker that must be hosted by one wall segment."""

    start: Point
    end: Point
    confidence: int
    opening_kind: OpeningKind

    def canonical(self) -> "OpeningSegment":
        if self.start <= self.end:
            return self
        return OpeningSegment(
            start=self.end,
            end=self.start,
            confidence=self.confidence,
            opening_kind=self.opening_kind,
        )


@dataclass(frozen=True, slots=True)
class ParserRequest:
    """Validated frozen c6-plan-parser-input-v1 request."""

    job_id: str
    normalized_input_sha256: str
    parser_mode: ParserMode
    source: JsonObject
    source_sha256: str
    project_id: str
    width: int
    height: int
    timeout_milliseconds: int
    maximum_candidates: int
    maximum_output_bytes: int


@dataclass(frozen=True, slots=True)
class NormalizedPlan:
    """Validated lane-local normalized geometry."""

    kind: NormalizedKind
    source_sha256: str
    width: int
    height: int
    walls: tuple[Segment, ...]
    openings: tuple[OpeningSegment, ...]
    label_count: int
    raster_pixels: bytes | None = None
