"""Root-only EC2 deployment, invoked from the approved, verified main commit."""

import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile

release = runpy.run_path(str(Path(__file__).with_name("release_env.py")))
ROOT = Path("/opt/kanvexa")
ENV_FILE = Path("/etc/kanvexa/production.env")
SOURCE = "https://github.com/duongkienvn/SE2026-T13"


def command(args, env):
    result = subprocess.run(args, env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    if result.returncode:
        # This process's output goes only to the root-owned local diagnostic log.
        print(result.stdout, flush=True)
        raise RuntimeError(f"Command failed: {args[0]} (code {result.returncode})")
    return result.stdout


class Deployment:
    def __init__(self, sha, env, run=command, update=release["update_release"]):
        self.values = release["release_values"](sha)
        self.sha = sha
        self.env = env
        self.run_command = run
        self.update = update
        self.stage = "preflight"
        self.dc = ["docker", "compose", "--project-name", "kanvexa", "--env-file",
                   str(ENV_FILE), "-f", str(ROOT / "compose.prod.yml")]

    def run(self, *args):
        return self.run_command(list(args), self.env)

    def compose(self, *args):
        return self.run(*(self.dc + list(args)))

    def migrate(self, action):
        output = self.compose("run", "--rm", "--no-deps", "--pull", "never",
                              "--name", "kanvexa-migrate", "migrate", action,
                              "-d", "dist/database/data-source.js")
        print(output, flush=True)  # Migration status/SQL stays in protected diagnostics.
        return output

    def execute(self):
        try:
            self._execute()
        except Exception:
            print(f"FAILED stage={self.stage}. No automatic env/schema rollback. "
                  "Inspect SSM, containers, migration history and protected log before retry.", flush=True)
            raise

    def _execute(self):
        git = ["git", "-c", "safe.directory=/opt/kanvexa"]
        if self.run(*git, "status", "--porcelain", "--untracked-files=all").strip():
            raise RuntimeError("Checkout is dirty")
        if self.run(*git, "rev-parse", "HEAD").strip() != self.sha:
            raise RuntimeError("Checkout SHA mismatch")
        self.run(*git, "merge-base", "--is-ancestor", self.sha, "refs/remotes/origin/main")
        release["require_protected_file"](ENV_FILE)
        # Validate dotenv syntax before downtime, without printing it.
        release["render_release"](ENV_FILE.read_bytes(), self.sha)
        self.compose("config", "--quiet")
        if self.run("docker", "ps", "-aq", "--filter", "name=^/kanvexa-migrate$").strip():
            raise RuntimeError("Existing migration container; resolve before retry")
        postgres = self.compose("ps", "-q", "postgres").strip()
        if not postgres or self.run("docker", "inspect", "--format",
                                    "{{.State.Health.Status}}", postgres).strip() != "healthy":
            raise RuntimeError("Existing PostgreSQL must be healthy; operator intervention required")

        self.stage = "anonymous image pulls and verification"
        for key in ("BACKEND_IMAGE", "FRONTEND_IMAGE"):
            image = f"{self.values[key]}:{self.sha}"
            self.run("docker", "pull", "--platform", "linux/amd64", image)
            info = json.loads(self.run("docker", "image", "inspect", image))[0]
            labels = info.get("Config", {}).get("Labels") or {}
            if (info["Os"] != "linux" or info["Architecture"] != "amd64"
                    or labels.get("org.opencontainers.image.source") != SOURCE
                    or labels.get("org.opencontainers.image.revision") != self.sha):
                raise RuntimeError("Image platform/source/revision mismatch")
        print("Both release images pulled anonymously and verified; entering downtime", flush=True)

        self.stage = "stop application traffic"
        self.compose("stop", "frontend", "backend")
        self.stage = "atomic env update"
        backup = self.update(ENV_FILE, self.sha)
        print(f"Protected env backup: {backup}", flush=True)
        self.compose("config", "--quiet")
        self.stage = "migration status before execution"
        self.migrate("migration:show")
        self.stage = "migration execution"
        self.migrate("migration:run")
        self.stage = "migration status after execution"
        if "[ ]" in self.migrate("migration:show"):
            raise RuntimeError("Pending migrations remain")
        self.stage = "Compose health"
        self.compose("up", "--no-build", "--pull", "never", "--no-deps", "-d",
                     "--wait", "--wait-timeout", "180", "backend", "frontend")
        self.stage = "complete; runner smoke required"
        print(self.stage, flush=True)


def main():
    if os.name != "posix" or os.geteuid() != 0 or Path.cwd() != ROOT:
        raise RuntimeError("Run as root from /opt/kanvexa through the approved SSM bootstrap")
    if len(sys.argv) != 2:
        raise ValueError("Expected one release SHA")
    # Empty Docker config proves public pulls even if root previously logged into GHCR.
    # Do not inherit shell variables that override Compose dotenv settings.
    with tempfile.TemporaryDirectory(prefix="kanvexa-docker-") as config:
        env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
               "HOME": "/root", "DOCKER_CONFIG": config}
        Deployment(sys.argv[1], env).execute()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Deployment aborted: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
