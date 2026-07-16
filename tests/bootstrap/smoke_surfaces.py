#!/usr/bin/env python3
"""Smoke the running web and API shells without third-party Python packages."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def fetch(url: str) -> tuple[int, str, str]:
    request = urllib.request.Request(url, headers={"Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return (
            response.status,
            response.headers.get_content_type(),
            response.read().decode("utf-8"),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:4100")
    parser.add_argument("--web-url", default="http://127.0.0.1:3000")
    args = parser.parse_args()

    try:
        api_status, api_content_type, api_body = fetch(f"{args.api_url.rstrip('/')}/health")
        if api_status != 200 or json.loads(api_body) != {"status": "ok"}:
            raise RuntimeError(f"unexpected API health response: {api_status} {api_body!r}")
        if api_content_type != "application/json":
            raise RuntimeError(f"API health content type is {api_content_type!r}")
        print("[ok] API /health contract")

        web_status, web_content_type, web_body = fetch(args.web_url)
        if web_status != 200 or "Complete Home Design System" not in web_body:
            raise RuntimeError(f"unexpected web response: HTTP {web_status}")
        if web_content_type != "text/html":
            raise RuntimeError(f"web content type is {web_content_type!r}")
        print("[ok] web shell response")
    except (json.JSONDecodeError, OSError, RuntimeError, urllib.error.URLError) as error:
        print(f"[failed] application surface smoke: {error}", file=sys.stderr)
        return 1

    print("\nWeb and API smoke contracts passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
