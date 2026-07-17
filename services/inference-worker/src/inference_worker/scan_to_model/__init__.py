"""Deterministic, proposal-only C9 semantic fitting boundary."""

from .canonical import canonical_json_bytes, sha256_json, source_manifest_sha256
from .protocol import execute_protocol
from .schema import (
    REQUEST_SCHEMA_VERSION,
    RESULT_SCHEMA_VERSION,
    SOURCE_MANIFEST_SCHEMA_VERSION,
    parse_request,
)

__all__ = [
    "REQUEST_SCHEMA_VERSION",
    "RESULT_SCHEMA_VERSION",
    "SOURCE_MANIFEST_SCHEMA_VERSION",
    "canonical_json_bytes",
    "execute_protocol",
    "parse_request",
    "sha256_json",
    "source_manifest_sha256",
]
