#!/usr/bin/env python3
"""Exercise the live C0 PostGIS, S3, and Temporal service contracts."""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPOSITORY_ROOT / "infrastructure" / "local" / "compose.yaml"
EXPECTED_SERVICES = {"object-storage", "postgres", "temporal"}
EXPECTED_BUCKETS = {"source", "derived", "issued", "quarantine"}


def run(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if completed.returncode != 0:
        diagnostic = completed.stdout.strip() or "no diagnostic output"
        raise RuntimeError(f"`{' '.join(command)}` failed: {diagnostic}")
    return completed.stdout.strip()


def compose(*arguments: str) -> str:
    return run(["docker", "compose", "-f", str(COMPOSE_FILE), *arguments])


def verify_running_services() -> None:
    running = set(compose("ps", "--services", "--status", "running").splitlines())
    missing = EXPECTED_SERVICES - running
    if missing:
        raise RuntimeError(f"local services are not running: {', '.join(sorted(missing))}")
    print(f"[ok] running services: {', '.join(sorted(running))}")


def verify_postgis() -> None:
    query = """
SELECT CASE
  WHEN current_setting('server_version_num')::integer >= 180000
   AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
  THEN 'ok'
  ELSE 'invalid'
END;
""".strip()
    result = compose(
        "exec",
        "-T",
        "postgres",
        "sh",
        "-ec",
        'PGPASSWORD="$POSTGRES_PASS" psql '
        '--host 127.0.0.1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DBNAME" '
        "--tuples-only --no-align --command \"$1\"",
        "bootstrap-postgis-check",
        query,
    )
    if result.splitlines()[-1].strip() != "ok":
        raise RuntimeError(f"PostgreSQL/PostGIS contract returned {result!r}")
    print("[ok] PostgreSQL 18+ is ready and the PostGIS extension is installed")


def signing_key(secret: str, date: str, region: str, service: str) -> bytes:
    date_key = hmac.new(f"AWS4{secret}".encode(), date.encode(), hashlib.sha256).digest()
    region_key = hmac.new(date_key, region.encode(), hashlib.sha256).digest()
    service_key = hmac.new(region_key, service.encode(), hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def signed_list_buckets_request() -> urllib.request.Request:
    access_key = os.environ.get("LOCAL_OBJECT_STORE_ACCESS_KEY", "localdev")
    secret_key = os.environ.get("LOCAL_OBJECT_STORE_SECRET_KEY", "local-development-only")
    region = "us-east-1"
    service = "s3"
    host = "127.0.0.1:8333"
    now = dt.datetime.now(dt.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()
    canonical_headers = (
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        ["GET", "/", "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    signature = hmac.new(
        signing_key(secret_key, date_stamp, region, service),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return urllib.request.Request(
        f"http://{host}/",
        headers={
            "Authorization": authorization,
            "Host": host,
            "X-Amz-Content-SHA256": payload_hash,
            "X-Amz-Date": amz_date,
        },
        method="GET",
    )


def verify_s3() -> None:
    try:
        with urllib.request.urlopen(signed_list_buckets_request(), timeout=10) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        raise RuntimeError(f"S3 ListBuckets failed with HTTP {error.code}: {body}") from error
    root = ET.fromstring(body)
    buckets = {
        element.text
        for element in root.iter()
        if element.tag.rsplit("}", maxsplit=1)[-1] == "Name" and element.text is not None
    }
    missing = EXPECTED_BUCKETS - buckets
    if missing:
        raise RuntimeError(f"S3 fixture buckets are missing: {', '.join(sorted(missing))}")
    print(f"[ok] signed S3 ListBuckets returned: {', '.join(sorted(buckets))}")


def verify_temporal() -> None:
    output = compose(
        "exec",
        "-T",
        "temporal",
        "temporal",
        "operator",
        "cluster",
        "health",
        "--address",
        "127.0.0.1:7233",
    )
    print(f"[ok] Temporal cluster health: {output or 'serving'}")


def main() -> int:
    try:
        compose("config", "--quiet")
        verify_running_services()
        verify_postgis()
        verify_s3()
        verify_temporal()
    except (ET.ParseError, OSError, RuntimeError, urllib.error.URLError) as error:
        print(f"[failed] local service smoke: {error}", file=sys.stderr)
        return 1
    print("\nAll local dependency contracts passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
