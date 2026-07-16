from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, ClassVar, cast

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPOSITORY_ROOT / "infrastructure" / "local" / "compose.yaml"
IAC_ROOT = REPOSITORY_ROOT / "infrastructure" / "iac"
OWNED_ROOTS = [
    REPOSITORY_ROOT / "infrastructure",
    REPOSITORY_ROOT / "tests" / "bootstrap",
    REPOSITORY_ROOT / "docs" / "runbooks" / "development",
]


def run(command: list[str], *, environment: dict[str, str] | None = None) -> str:
    completed = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        env=environment,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(f"`{' '.join(command)}` failed:\n{completed.stdout}")
    return completed.stdout


def compose_config() -> dict[str, object]:
    output = run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "config", "--format", "json"]
    )
    value = json.loads(output)
    if not isinstance(value, dict):
        raise AssertionError("Compose config did not render a JSON object")
    return value


class LocalStackConfigurationTests(unittest.TestCase):
    configuration: ClassVar[dict[str, Any]]
    services: ClassVar[dict[str, Any]]

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("docker") is None:
            raise unittest.SkipTest("Docker Compose is required to render the stack contract")
        cls.configuration = compose_config()
        cls.services = cast(dict[str, Any], cls.configuration["services"])

    def test_compose_syntax_is_valid(self) -> None:
        run(["docker", "compose", "-f", str(COMPOSE_FILE), "config", "--quiet"])

    def test_only_required_replaceable_services_are_present(self) -> None:
        self.assertEqual(set(self.services), {"object-storage", "postgres", "temporal"})

    def test_images_are_version_pinned(self) -> None:
        for name, service in self.services.items():
            image = service["image"]
            with self.subTest(service=name, image=image):
                self.assertRegex(image, r"^[^:@]+(?:/[^:@]+)*:[0-9][A-Za-z0-9._-]*$")
                self.assertNotIn(":latest", image)

    def test_every_service_has_a_healthcheck(self) -> None:
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertIn("healthcheck", service)
                self.assertGreaterEqual(service["healthcheck"]["retries"], 3)

    def test_host_ports_are_loopback_only(self) -> None:
        for name, service in self.services.items():
            for port in service.get("ports", []):
                with self.subTest(service=name, port=port):
                    self.assertEqual(port["host_ip"], "127.0.0.1")

    def test_storage_uses_named_volumes_only(self) -> None:
        for name, service in self.services.items():
            for volume in service.get("volumes", []):
                with self.subTest(service=name, volume=volume):
                    self.assertEqual(volume["type"], "volume")
                    self.assertNotIn("bind", volume)

    def test_dependency_network_defaults_host_bindings_to_loopback(self) -> None:
        network = self.configuration["networks"]["dependencies"]
        self.assertEqual(network["driver"], "bridge")
        self.assertEqual(
            network["driver_opts"]["com.docker.network.bridge.host_binding_ipv4"],
            "127.0.0.1",
        )

    def test_fixture_credentials_are_visibly_local(self) -> None:
        credential_name = re.compile(r"(?:ACCESS_KEY|PASS|PASSWORD|SECRET)")
        for name, service in self.services.items():
            for variable, value in service.get("environment", {}).items():
                if credential_name.search(variable):
                    with self.subTest(service=name, variable=variable):
                        self.assertIn("local", value.lower())

    def test_object_storage_classes_are_distinct(self) -> None:
        buckets = set(self.services["object-storage"]["environment"]["S3_BUCKET"].split(","))
        self.assertEqual(buckets, {"source", "derived", "issued", "quarantine"})


class InfrastructureContractTests(unittest.TestCase):
    def test_iac_is_provider_free_and_non_deploying(self) -> None:
        terraform = "\n".join(path.read_text(encoding="utf-8") for path in IAC_ROOT.rglob("*.tf"))
        forbidden_block = re.compile(r'^\s*(?:provider|resource|data)\s+"', re.MULTILINE)
        self.assertIsNone(forbidden_block.search(terraform))
        self.assertIn('default     = "disabled"', terraform)
        self.assertIn("default     = false", terraform)

    def test_iac_syntax_and_format_when_tool_is_available(self) -> None:
        tool = shutil.which("tofu") or shutil.which("terraform")
        if tool is None:
            self.skipTest("OpenTofu or Terraform is not installed")
        run([tool, f"-chdir={IAC_ROOT}", "fmt", "-check", "-recursive"])
        with tempfile.TemporaryDirectory(prefix="interior-design-iac-") as data_directory:
            environment = os.environ.copy()
            environment["TF_DATA_DIR"] = data_directory
            run(
                [tool, f"-chdir={IAC_ROOT}", "init", "-backend=false", "-input=false", "-no-color"],
                environment=environment,
            )
            run([tool, f"-chdir={IAC_ROOT}", "validate", "-no-color"], environment=environment)


class RepositorySafetyTests(unittest.TestCase):
    def test_owned_files_contain_no_developer_absolute_paths(self) -> None:
        forbidden = [
            re.compile(r"/Users/[A-Za-z0-9._-]+/"),
            re.compile(re.escape(Path.home().as_posix() + "/")),
            re.compile(r"[A-Za-z]:\\\\(?:Users|Documents and Settings)\\\\"),
            re.compile(r"\$\{?(?:HOME|CODEX_HOME)\}?"),
            re.compile(r"(?:^|\s)~/"),
        ]
        for root in OWNED_ROOTS:
            for path in root.rglob("*"):
                if not path.is_file() or "__pycache__" in path.parts:
                    continue
                content = path.read_text(encoding="utf-8")
                for pattern in forbidden:
                    with self.subTest(
                        path=path.relative_to(REPOSITORY_ROOT), pattern=pattern.pattern
                    ):
                        self.assertIsNone(pattern.search(content))

    def test_owned_files_contain_no_private_key_or_provider_token(self) -> None:
        forbidden = [
            re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
            re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
            re.compile(r"\bgh[oprsu]_[A-Za-z0-9]{30,}\b"),
            re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
        ]
        for root in OWNED_ROOTS:
            for path in root.rglob("*"):
                if not path.is_file() or "__pycache__" in path.parts:
                    continue
                content = path.read_text(encoding="utf-8")
                for pattern in forbidden:
                    with self.subTest(
                        path=path.relative_to(REPOSITORY_ROOT), pattern=pattern.pattern
                    ):
                        self.assertIsNone(pattern.search(content))

    def test_shell_entrypoints_parse(self) -> None:
        for path in (REPOSITORY_ROOT / "infrastructure").rglob("*.sh"):
            run(["sh", "-n", str(path)])

    def test_frozen_root_versions_are_referenced_without_duplication(self) -> None:
        package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual((REPOSITORY_ROOT / ".nvmrc").read_text().strip(), "22.22.2")
        self.assertEqual(package["packageManager"], "pnpm@10.33.0")
        self.assertEqual((REPOSITORY_ROOT / ".python-version").read_text().strip(), "3.12")


if __name__ == "__main__":
    unittest.main()
