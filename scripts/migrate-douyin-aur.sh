#!/usr/bin/env bash
# One-time migration of the already published package; no binary rebuild.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
configuration="$root/packages/douyin-devtools-bin/configs/packaging.json"
repository=$(jq -er '.arch.githubRepository' "$configuration")
tag_prefix=$(jq -er '.arch.githubTagPrefix' "$configuration")
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
git clone --quiet ssh://aur@aur.archlinux.org/douyin-devtools-bin.git "$temporary/aur"
cd "$temporary/aur"
python3 - "$repository" "$tag_prefix" <<'PY'
from pathlib import Path
import re
import sys

repository, tag_prefix = sys.argv[1:]
path = Path('PKGBUILD')
content = path.read_text()
content, count = re.subn(
    r'^url=.*$',
    f"url='https://github.com/{repository}/tree/main/packages/douyin-devtools-bin'",
    content, count=1, flags=re.MULTILINE,
)
assert count == 1, 'Missing package homepage'
content = re.sub(
    r'https://github\.com/Geequlim/(?:-douyin-game-devtools-linux|douyin-minigame-devtools-linux)/releases/download/v',
    f'https://github.com/{repository}/releases/download/{tag_prefix}',
    content,
)
assert f'https://github.com/{repository}/releases/download/{tag_prefix}' in content
path.write_text(content)
PY
makepkg --printsrcinfo > .SRCINFO
makepkg --verifysource
git diff -- PKGBUILD .SRCINFO
git add PKGBUILD .SRCINFO
if ! git diff --cached --quiet; then
  git -c user.name='github-actions[bot]' \
    -c user.email='github-actions[bot]@users.noreply.github.com' \
    commit -m 'Move package references to Geequlim/aur-packages'
  git push origin HEAD:master
else
  git push --dry-run origin HEAD:master
fi
