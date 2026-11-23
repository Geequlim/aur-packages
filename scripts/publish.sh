#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
name=${1:?Usage: ./scripts/publish.sh package}
case "$name" in
  layaair-ide|layaair-cli|cosbrowser-bin|t3-code-cli-bin|thirtyfile-bin) ;;
  *) echo "Unsupported repack: $name" >&2; exit 2 ;;
esac
directory="$root/packages/$name"
if [[ -n $(git -C "$root" status --porcelain -- "packages/$name") ]]; then
  echo "Commit the changes in packages/$name before publishing." >&2
  exit 1
fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
repository="$temporary/aur"
# Always clone the AUR history. Never push the monorepo or force-update AUR.
git clone --quiet "ssh://aur@aur.archlinux.org/$name.git" "$repository"
git -C "$repository" rm -r --quiet --ignore-unmatch .
files=(PKGBUILD .SRCINFO)
for file in "$directory"/*.install; do
  [[ ! -f "$file" ]] || files+=("${file##*/}")
done
if [[ "$name" == thirtyfile-bin ]]; then
  files+=(thirtyfile.service thirtyfile.conf thirtyfile.sysusers)
fi
for file in "${files[@]}"; do
  cp "$directory/$file" "$repository/$file"
done
git -C "$repository" add -- "${files[@]}"
if git -C "$repository" diff --cached --quiet; then
  # Exercise the receive-pack permission check even when there is no update.
  git -C "$repository" push --dry-run origin HEAD:master
  echo "$name: AUR is already up to date."
  exit 0
fi

(cd "$repository" && makepkg --verifysource)
version=$(sed -n 's/^pkgver=//p' "$directory/PKGBUILD")
release=$(sed -n 's/^pkgrel=//p' "$directory/PKGBUILD")
git -C "$repository" \
  -c user.name="$(git -C "$root" config user.name)" \
  -c user.email="$(git -C "$root" config user.email)" \
  commit --quiet -m "Update $name to $version-$release"
git -C "$repository" push origin HEAD:master
