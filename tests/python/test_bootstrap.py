def is_explicitly_unknown(status: str) -> bool:
    return status == "unknown"


def test_python_toolchain_bootstrap() -> None:
    assert is_explicitly_unknown("unknown")
