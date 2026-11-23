import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "packages/thirtyfile-bin"


class ThirtyFileUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.package = self.base / "package"
        (self.package / "scripts").mkdir(parents=True)
        for name in ["PKGBUILD", "thirtyfile.service", "thirtyfile.conf", "thirtyfile.sysusers", "scripts/update.sh"]:
            shutil.copyfile(SOURCE / name, self.package / name)
        self.update = self.package / "scripts/update.sh"
        self.update.chmod(0o755)
        content = (self.package / "PKGBUILD").read_text()
        content = re.sub(r"^pkgver=.*$", "pkgver=0.9.0", content, flags=re.MULTILINE)
        content = re.sub(r"^pkgrel=.*$", "pkgrel=4", content, flags=re.MULTILINE)
        (self.package / "PKGBUILD").write_text(content)
        metadata = subprocess.run(["makepkg", "--printsrcinfo"], cwd=self.package, capture_output=True, text=True, check=True)
        (self.package / ".SRCINFO").write_text(metadata.stdout)
        self.assets = self.base / "assets"
        self.assets.mkdir()
        self.payloads = {
            "LICENSE": b"Fixture license\n",
            "THIRD-PARTY-NOTICES": b"Fixture notices\n",
            "thirtyfile-1.1.0-linux-amd64": b"Fixture amd64 executable\n",
            "thirtyfile-1.1.0-linux-arm64": b"Fixture arm64 executable\n",
        }
        self.write_release()
        binaries = self.base / "bin"
        binaries.mkdir()
        self.executable(binaries / "curl", """#!/usr/bin/env python3
import os,pathlib,shutil,sys
root=pathlib.Path(os.environ['FIXTURE_DIR'])
url=next(a for a in sys.argv if a.startswith('https://'))
if url.endswith('/releases/latest'):
    print((root/'release.json').read_text())
else:
    shutil.copyfile(root/url.rsplit('/',1)[1],sys.argv[sys.argv.index('-o')+1])
""")
        self.executable(binaries / "readelf", """#!/usr/bin/env bash
if [[ "$1" == -h ]]; then
  if [[ "$2" == *arm64 ]]; then echo 'Machine: AArch64'; else echo 'Machine: Advanced Micro Devices X86-64'; fi
else
  echo 'There is no dynamic section in this file.'
fi
""")
        self.executable(binaries / "gh", """#!/usr/bin/env python3
import json,os,pathlib,sys
with pathlib.Path(os.environ['ATTEST_LOG']).open('a') as log: log.write(json.dumps(sys.argv[1:])+'\\n')
if os.environ.get('ATTEST_FAIL')=='true':
    print('Fixture attestation rejected',file=sys.stderr)
    sys.exit(1)
""")
        self.log = self.base / "attestations.jsonl"
        self.env = {
            **os.environ,
            "PATH": f"{binaries}:{os.environ['PATH']}",
            "FIXTURE_DIR": str(self.assets),
            "ATTEST_LOG": str(self.log),
            "FORCE": "false",
        }

    def executable(self, path, content):
        path.write_text(content)
        path.chmod(0o755)

    def write_release(self):
        manifest = "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in self.payloads.items()).encode()
        assets = {**self.payloads, "SHA256SUMS": manifest}
        for name, data in assets.items():
            (self.assets / name).write_bytes(data)
        self.release = {
            "tag_name": "v1.1.0", "draft": False, "prerelease": False,
            "assets": [{"name": name, "state": "uploaded", "digest": "sha256:" + hashlib.sha256(data).hexdigest()} for name, data in assets.items()],
        }
        self.save_release()

    def save_release(self):
        (self.assets / "release.json").write_text(json.dumps(self.release))

    def run_update(self, *arguments, **environment):
        return subprocess.run([str(self.update), *arguments], env={**self.env, **environment}, text=True, capture_output=True)

    def snapshot(self):
        return [(self.package / name).read_bytes() for name in ["PKGBUILD", ".SRCINFO"]]

    def test_upgrade_verifies_both_architectures_and_updates_metadata(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("pkgver=1.1.0\npkgrel=1\n", (self.package / "PKGBUILD").read_text())
        records = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertEqual({Path(row[2]).name for row in records}, {name for name in self.payloads if "linux-" in name})
        for row in records:
            self.assertEqual(row[row.index("--repo") + 1], "ThirtyFile/ThirtyFile")
            self.assertEqual(row[row.index("--signer-workflow") + 1], "ThirtyFile/ThirtyFile/.github/workflows/release.yml")

    def test_check_and_unchanged_update_do_not_download_or_write(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.snapshot()
        original_calls = self.log.read_text()
        for name in [*self.payloads, "SHA256SUMS"]:
            (self.assets / name).unlink()
        result = self.run_update("--check-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("needs_update=false", result.stdout)
        self.assertEqual(self.run_update().returncode, 0)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.log.read_text(), original_calls)

    def test_failed_attestation_leaves_packaging_unchanged(self):
        before = self.snapshot()
        result = self.run_update(ATTEST_FAIL="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("attestation rejected", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_missing_architecture_leaves_packaging_unchanged(self):
        before = self.snapshot()
        self.release["assets"] = [item for item in self.release["assets"] if not item["name"].endswith("linux-arm64")]
        self.save_release()
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing or ambiguous", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_corrupted_download_leaves_packaging_unchanged(self):
        before = self.snapshot()
        (self.assets / "thirtyfile-1.1.0-linux-amd64").write_bytes(b"Corrupted bytes")
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_prerelease_is_not_accepted(self):
        before = self.snapshot()
        self.release["prerelease"] = True
        self.save_release()
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_same_version_replacement_requires_force_and_bumps_release(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.snapshot()
        self.payloads["thirtyfile-1.1.0-linux-amd64"] += b"Replacement"
        self.write_release()
        check = self.run_update("--check-only")
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertIn("changed_in_place=true", check.stdout)
        self.assertEqual(self.snapshot(), before)
        refused = self.run_update()
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("FORCE=true", refused.stderr)
        self.assertEqual(self.snapshot(), before)
        refreshed = self.run_update(FORCE="true")
        self.assertEqual(refreshed.returncode, 0, refreshed.stderr)
        self.assertIn("pkgver=1.1.0\npkgrel=2\n", (self.package / "PKGBUILD").read_text())


if __name__ == "__main__":
    unittest.main()
