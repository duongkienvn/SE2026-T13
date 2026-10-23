"""Isolated fault injection: no Docker daemon, AWS, real env or production I/O."""

import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


def load(name):
    path = Path(__file__).with_name(f"{name}.py")
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(path.read_text(), str(path), "exec"), module.__dict__)
    return module


env_module = load("release_env")
deployment = load("deploy")
SHA = "a" * 40
ORIGINAL = (b"# keep comments\r\nDATABASE_PASSWORD='keep $ # = private'\r\n"
            b"JWT_SECRET=do-not-change\r\nIMAGE_TAG=old\r\n"
            b"BACKEND_IMAGE=old-backend\r\nFRONTEND_IMAGE=old-frontend\r\n")


class ProtectedFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "production.env"
        self.path.write_bytes(ORIGINAL)
        self.path.chmod(0o600)


class EnvTests(ProtectedFixture):
    def test_preserves_secret_bytes_and_protected_backup(self):
        backup = env_module.update_release(self.path, SHA)
        self.assertEqual(backup.read_bytes(), ORIGINAL)
        result = self.path.read_bytes()
        self.assertTrue(result.startswith(ORIGINAL.split(b"IMAGE_TAG")[0]))
        for key, value in env_module.release_values(SHA).items():
            self.assertIn(f"{key}={value}\r\n".encode(), result)
        if os.name == "posix":
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)

    def test_missing_keys_and_no_final_newline(self):
        result = env_module.render_release(b"JWT_SECRET=unchanged", SHA)
        self.assertTrue(result.startswith(b"JWT_SECRET=unchanged\n"))
        self.assertEqual(result.count(b"IMAGE_TAG="), 1)

    def test_rejects_invalid_sha_duplicate_and_multiline_without_writes(self):
        for original, sha in [(ORIGINAL, "main; id"),
                              (ORIGINAL + b"export IMAGE_TAG=duplicate\n", SHA),
                              (b'JWT_SECRET="multiline\nIMAGE_TAG=secret\n"\n', SHA)]:
            self.path.write_bytes(original)
            with self.assertRaises(ValueError):
                env_module.update_release(self.path, sha)
            self.assertEqual(self.path.read_bytes(), original)
            self.assertEqual(list(self.path.parent.glob("*.backup-*")), [])

    def test_failed_atomic_replace_preserves_original_and_backup(self):
        with patch.object(env_module.os, "replace", side_effect=OSError("injected")):
            with self.assertRaises(OSError):
                env_module.update_release(self.path, SHA)
        self.assertEqual(self.path.read_bytes(), ORIGINAL)
        backups = list(self.path.parent.glob("*.backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), ORIGINAL)
        self.assertEqual(len(list(self.path.parent.iterdir())), 2)

    @unittest.skipUnless(os.name == "posix", "POSIX file policy")
    def test_refuses_insecure_permissions_and_symlinks(self):
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            env_module.update_release(self.path, SHA)
        self.path.chmod(0o600)
        link = self.path.with_name("link.env")
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            env_module.update_release(link, SHA)


class DeployTests(ProtectedFixture):
    def scenario(self, failure=None):
        calls = []
        shows = 0

        def run(args, _env):
            nonlocal shows
            calls.append(args)
            text = " ".join(args)
            if failure == "dirty" and "status --porcelain" in text:
                return " M compose.prod.yml"
            if failure == "ancestry" and "merge-base" in text:
                raise RuntimeError("not on main")
            if "rev-parse HEAD" in text:
                return SHA
            if "compose" in args and args[-3:] == ["ps", "-q", "postgres"]:
                return "postgres-id"
            if "{{.State.Health.Status}}" in args:
                return "unhealthy" if failure == "database" else "healthy"
            if failure == "stale-migration" and args[:3] == ["docker", "ps", "-aq"]:
                return "stale-container"
            if args[:2] == ["docker", "pull"]:
                if failure in ("kanvexa-backend:", "kanvexa-frontend:") and failure in args[-1]:
                    raise RuntimeError("private or missing image")
            if args[:3] == ["docker", "image", "inspect"]:
                info = {"Os": "linux", "Architecture": "amd64", "Config": {"Labels": {
                    "org.opencontainers.image.source": deployment.SOURCE,
                    "org.opencontainers.image.revision": SHA}}}
                if failure == "wrong-image":
                    info["Architecture"] = "arm64"
                return json.dumps([info])
            if "migration:show" in args:
                shows += 1
                if failure == "show":
                    raise RuntimeError("show failed")
                return "[ ] pending" if shows == 1 or failure == "pending" else "[X] applied"
            if failure == "migrate" and "migration:run" in args:
                raise RuntimeError("migration failed")
            if failure == "health" and "up" in args:
                raise RuntimeError("health failed")
            return ""

        def update(path, sha):
            calls.append(["UPDATE_ENV"])
            if failure == "env":
                raise OSError("env update failed")
            return env_module.update_release(path, sha)

        with patch.object(deployment, "ENV_FILE", self.path):
            deploy = deployment.Deployment(SHA, {}, run=run, update=update)
            if failure:
                with self.assertRaises((RuntimeError, OSError)):
                    deploy.execute()
            else:
                deploy.execute()
        return calls

    def test_success_orders_pulls_stop_env_migrations_health(self):
        calls = self.scenario()
        texts = [" ".join(c) for c in calls]
        positions = [next(i for i, text in enumerate(texts) if marker in text)
                     for marker in ["kanvexa-frontend:" + SHA, "stop frontend backend",
                                    "UPDATE_ENV", "migration:show", "migration:run", "up --no-build"]]
        self.assertEqual(positions, sorted(positions))
        up = next(c for c in calls if "up" in c)
        for flag in ["--no-deps", "--wait", "--pull", "never"]:
            self.assertIn(flag, up)
        self.assertNotIn("postgres", up)

    def test_all_preflight_and_image_failures_precede_downtime(self):
        for failure in ["dirty", "ancestry", "database", "stale-migration",
                        "kanvexa-backend:", "kanvexa-frontend:", "wrong-image"]:
            with self.subTest(failure=failure):
                calls = self.scenario(failure)
                self.assertFalse(any("stop" in c or "UPDATE_ENV" in c for c in calls))
                self.assertEqual(self.path.read_bytes(), ORIGINAL)

    def test_env_or_migration_failure_never_starts_application_or_reverts(self):
        for failure in ["env", "show", "migrate", "pending"]:
            with self.subTest(failure=failure):
                calls = self.scenario(failure)
                self.assertFalse(any("up" in c for c in calls))
                self.assertFalse(any("migration:revert" in c for c in calls))

    def test_health_failure_is_propagated_without_database_or_volume_commands(self):
        calls = self.scenario("health")
        self.assertTrue(any("up" in c for c in calls))
        self.assertFalse(any("down" in c or "prune" in c for c in calls))


if __name__ == "__main__":
    unittest.main()
