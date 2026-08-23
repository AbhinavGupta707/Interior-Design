"""Explicit C8 v2 exposure boundary.

The package is importable by acceptance tooling only. No worker route, job kind, or
environment variable enables production dispatch.
"""

from typing import Final, Never

CAPABILITY_STATUS: Final = "acceptance-only"
PRODUCTION_ROUTING_ENABLED: Final = False


def require_production_routing() -> Never:
    """Fail closed if application code attempts to dispatch through C8 v2."""

    raise RuntimeError("C8_V2_ACCEPTANCE_ONLY")
