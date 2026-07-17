"""Safe failure types for the C8 reconstruction trust boundary."""

import re

_SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")


class ReconstructionError(ValueError):
    """A bounded error whose code may cross the worker boundary.

    ``detail`` is intentionally developer-facing and must never be placed in a
    public result or telemetry record. Callers publish only ``safe_code``.
    """

    def __init__(self, safe_code: str, detail: str) -> None:
        if _SAFE_CODE.fullmatch(safe_code) is None:
            raise ValueError("invalid safe reconstruction code")
        self.safe_code = safe_code
        self.detail = detail
        super().__init__(safe_code)

    def __str__(self) -> str:
        return self.safe_code
