"""Safe failures for the private C9 scan-to-model trust boundary."""

import re

_SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")


class ScanToModelError(ValueError):
    """A failure whose stable code, but never developer detail, may cross the boundary."""

    def __init__(self, safe_code: str, detail: str) -> None:
        if _SAFE_CODE.fullmatch(safe_code) is None:
            raise ValueError("invalid scan-to-model safe code")
        self.safe_code = safe_code
        self.detail = detail
        super().__init__(safe_code)

    def __str__(self) -> str:
        return self.safe_code


class FittingAbstention(ScanToModelError):
    """A schema-valid request that cannot safely produce proposal geometry."""


class WorkCancelled(RuntimeError):
    """Cooperative cancellation signal that contains no request data."""


class WorkLimitExceeded(RuntimeError):
    """Deterministic work-unit ceiling signal."""


class WorkDeadlineExceeded(RuntimeError):
    """Monotonic runtime deadline signal."""
