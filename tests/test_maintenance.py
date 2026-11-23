import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1]


class MaintenanceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "project"
        self.root.mkdir()
        shutil.copytree(SOURCE / "scripts", self.root / "scripts")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "GIT_CONFIG_GLOBAL": str(self.base / "gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "AUR_PUBLISH_ENABLED": "true",
            "CALL_LOG": str(self.base / "calls"),
        }
        self.run_git(self.base, "config", "--global", "user.name", "Test Maintainer")
        self.run_git(self.base, "config", "--global", "user.email", "test@example.invalid")
        self.run_git(self.root, "init", "-q", "-b", "main")
        self.write_executable(self.bin / "makepkg", """#!/usr/bin/env bash
set -eu
printf '%s %s\n' "$PWD" "$*" >> "$CALL_LOG"
if [[ "$1" == --printsrcinfo ]]; then cat .SRCINFO; fi
""")
        self.package = self.add_package("t3-code-cli-bin", "0.1.11")
        self.commit(self.root)
        self.github = self.base / "github.git"
        self.run_git(self.base, "clone", "-q", "--bare", str(self.root), str(self.github))
        self.run_git(self.root, "remote", "add", "origin", str(self.github))
        seed = self.base / "aur-seed"
        seed.mkdir()
        self.run_git(seed, "init", "-q", "-b", "master")
        (seed / "PKGBUILD").write_text("pkgname=t3-code-cli-bin\npkgver=0.1.10\npkgrel=1\n")
        (seed / ".SRCINFO").write_text("pkgbase = t3-code-cli-bin\n\tpkgver = 0.1.10\n")
        (seed / "obsolete.install").write_text("# removed helper\n")
        self.commit(seed)
        self.aur = self.base / "aur.git"
        self.run_git(self.base, "clone", "-q", "--bare", str(seed), str(self.aur))
        self.run_git(
            self.base, "config", "--global", f"url.{self.aur}.insteadOf",
            "ssh://aur@aur.archlinux.org/t3-code-cli-bin.git",
        )

    def run_git(self, directory, *arguments, check=True):
        return subprocess.run(
            ["git", "-C", str(directory), *arguments], env=self.env,
            text=True, capture_output=True, check=check,
        )

    def run_script(self, script, *arguments, **environment):
        return subprocess.run(
            [str(self.root / script), *arguments], cwd=self.root,
            env={**self.env, **environment}, text=True, capture_output=True,
        )

    def write_executable(self, path, content):
        path.write_text(content)
        path.chmod(0o755)

    def add_package(self, name, version):
        directory = self.root / "packages" / name
        (directory / "scripts").mkdir(parents=True)
        (directory / "PKGBUILD").write_text(f"pkgname={name}\npkgver={version}\npkgrel=1\n")
        (directory / ".SRCINFO").write_text(f"pkgbase = {name}\n\tpkgver = {version}\n")
        (directory / "README.md").write_text("Not part of the AUR upload.\n")
        self.write_executable(directory / "scripts/update.sh", "#!/usr/bin/env bash\nexit 0\n")
        return directory

    def commit(self, directory):
        self.run_git(directory, "add", ".")
        self.run_git(directory, "commit", "-qm", "Fixture")

    def test_publish_retries_after_failed_push_without_github_changes(self):
        old_aur_head = self.run_git(self.aur, "rev-parse", "master").stdout.strip()
        github_head = self.run_git(self.root, "rev-parse", "HEAD").stdout.strip()
        hook = self.aur / "hooks/pre-receive"
        self.write_executable(hook, "#!/bin/sh\nexit 1\n")
        first = self.run_script("scripts/maintain.sh", "t3-code-cli-bin")
        self.assertNotEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(self.run_git(self.aur, "rev-parse", "master").stdout.strip(), old_aur_head)
        hook.unlink()
        retry = self.run_script("scripts/maintain.sh", "t3-code-cli-bin")
        self.assertEqual(retry.returncode, 0, retry.stdout + retry.stderr)
        self.assertEqual(self.run_git(self.root, "rev-parse", "HEAD").stdout.strip(), github_head)
        self.assertEqual(self.run_git(self.github, "rev-parse", "main").stdout.strip(), github_head)
        self.assertEqual(self.run_git(self.aur, "rev-parse", "master^").stdout.strip(), old_aur_head)
        self.assertEqual(
            self.run_git(self.aur, "ls-tree", "--name-only", "master").stdout.splitlines(),
            [".SRCINFO", "PKGBUILD"],
        )
        self.assertNotIn("packages/", self.run_git(self.aur, "show", "master:PKGBUILD").stdout)
        new_head = self.run_git(self.aur, "rev-parse", "master").stdout
        no_change = self.run_script("scripts/aur", "publish", "t3-code-cli-bin")
        self.assertEqual(no_change.returncode, 0, no_change.stdout + no_change.stderr)
        self.assertEqual(self.run_git(self.aur, "rev-parse", "master").stdout, new_head)

    def test_publish_requires_committed_package_files(self):
        with (self.package / "PKGBUILD").open("a") as output:
            output.write("# unreviewed change\n")
        result = self.run_script("scripts/aur", "publish", "t3-code-cli-bin")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Commit the changes", result.stderr)

    def test_first_publication_includes_thirtyfile_service_files(self):
        package = self.add_package("thirtyfile-bin", "1.1.0")
        helpers = ["thirtyfile.service", "thirtyfile.conf", "thirtyfile.sysusers"]
        for name in helpers:
            shutil.copyfile(SOURCE / "packages/thirtyfile-bin" / name, package / name)
        self.commit(self.root)
        remote = self.base / "thirtyfile.git"
        self.run_git(self.base, "init", "--bare", "-q", "-b", "master", str(remote))
        self.run_git(
            self.base, "config", "--global", f"url.{remote}.insteadOf",
            "ssh://aur@aur.archlinux.org/thirtyfile-bin.git",
        )
        result = self.run_script("scripts/aur", "publish", "thirtyfile-bin")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            self.run_git(remote, "ls-tree", "--name-only", "master").stdout.splitlines(),
            [".SRCINFO", "PKGBUILD", "thirtyfile.conf", "thirtyfile.service", "thirtyfile.sysusers"],
        )
        for name in helpers:
            self.assertEqual(self.run_git(remote, "show", f"master:{name}").stdout, (package / name).read_text())

    def test_unchanged_package_still_checks_push_permission(self):
        initial = self.run_script("scripts/aur", "publish", "t3-code-cli-bin")
        self.assertEqual(initial.returncode, 0, initial.stdout + initial.stderr)
        real_git = shutil.which("git")
        self.write_executable(self.bin / "git", f"""#!/usr/bin/env bash
if [[ " $* " == *' push --dry-run '* ]]; then
  echo 'Push permission denied' >&2
  exit 23
fi
exec '{real_git}' "$@"
""")
        result = self.run_script("scripts/aur", "publish", "t3-code-cli-bin")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Push permission denied", result.stderr)

    def test_one_failed_package_does_not_skip_the_rest(self):
        earlier = self.add_package("layaair-ide", "3.4.3")
        self.write_executable(earlier / "scripts/update.sh", "#!/bin/sh\nexit 7\n")
        marker = self.base / "updated"
        self.write_executable(
            self.package / "scripts/update.sh",
            f"#!/bin/sh\ntouch '{marker}'\n",
        )
        result = self.run_script("scripts/aur", "update", "all")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(marker.exists(), result.stdout + result.stderr)

    def test_failed_douyin_build_does_not_run_packaging(self):
        (self.root / "packages/douyin-devtools-bin").mkdir()
        self.write_executable(self.bin / "node", """#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CALL_LOG"
if [[ "$1" == scripts/build.mts ]]; then exit 7; fi
""")
        result = self.run_script("scripts/aur", "build", "douyin-devtools-bin")
        self.assertNotEqual(result.returncode, 0)
        calls = (self.base / "calls").read_text()
        self.assertIn("scripts/build.mts", calls)
        self.assertNotIn("scripts/package-arch.mts", calls)

    def test_disabled_publishing_leaves_aur_unchanged(self):
        before = self.run_git(self.aur, "rev-parse", "master").stdout
        result = self.run_script(
            "scripts/maintain.sh", "t3-code-cli-bin", AUR_PUBLISH_ENABLED="false",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.run_git(self.aur, "rev-parse", "master").stdout, before)

    def test_unknown_package_is_rejected(self):
        result = self.run_script("scripts/aur", "publish", "../t3-code-cli-bin")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
