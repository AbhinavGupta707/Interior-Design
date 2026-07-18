"""Safe failures for the C14 optional image-enhancement boundary."""

from enum import StrEnum


class EnhancementSafeCode(StrEnum):
    """Bounded codes that may cross the worker boundary or enter diagnostics."""

    ALLOWED_MASK_INVALID = "ALLOWED_MASK_INVALID"
    BASE_ARTIFACT_MISMATCH = "BASE_ARTIFACT_MISMATCH"
    CAMERA_MISMATCH = "CAMERA_MISMATCH"
    CANCELLED = "ENHANCEMENT_CANCELLED"
    CONDITIONING_MISMATCH = "CONDITIONING_MISMATCH"
    INPUT_HASH_MISMATCH = "INPUT_HASH_MISMATCH"
    INPUT_INVALID = "ENHANCEMENT_INPUT_INVALID"
    NON_FINITE_VALUE = "NON_FINITE_VALUE"
    OUTPUT_HASH_MISMATCH = "OUTPUT_HASH_MISMATCH"
    OUTPUT_INVALID = "ENHANCEMENT_OUTPUT_INVALID"
    OUTSIDE_ALLOWED_MASK_CHANGED = "OUTSIDE_ALLOWED_MASK_CHANGED"
    PNG_INVALID = "PNG_INVALID"
    PNG_RESOURCE_LIMIT = "PNG_RESOURCE_LIMIT"
    PROTECTED_GEOMETRY_CHANGED = "PROTECTED_GEOMETRY_CHANGED"
    PROVIDER_DISABLED = "IMAGE_ENHANCEMENT_PROVIDER_DISABLED"
    PROVIDER_FAILED = "IMAGE_ENHANCEMENT_PROVIDER_FAILED"
    PROVIDER_OUTPUT_INVALID = "PROVIDER_OUTPUT_INVALID"
    PROVIDER_PROVENANCE_MISMATCH = "PROVIDER_PROVENANCE_MISMATCH"
    RESOURCE_LIMIT = "IMAGE_ENHANCEMENT_RESOURCE_LIMIT"
    SEGMENTATION_THRESHOLD_FAILED = "SEGMENTATION_THRESHOLD_FAILED"
    TEST_ADAPTER_NOT_ALLOWED = "TEST_ADAPTER_NOT_ALLOWED"
    TIME_LIMIT = "IMAGE_ENHANCEMENT_TIME_LIMIT"


class EnhancementError(ValueError):
    """Internal failure carrying only one publishable safe code.

    The developer detail is deliberately absent from ``str`` and ``repr`` so
    request bytes, paths, prompts, provider payloads, and private project data
    cannot be logged by an ordinary exception handler.
    """

    def __init__(self, safe_code: EnhancementSafeCode, detail: str) -> None:
        self.safe_code = safe_code
        self.detail = detail
        super().__init__(safe_code.value)

    def __str__(self) -> str:
        return self.safe_code.value
