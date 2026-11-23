#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
force=${FORCE:-false}
check_only=false
if [[ $# -eq 1 && "$1" == --check-only ]]; then
  check_only=true
elif [[ $# -gt 0 ]]; then
  echo 'Usage: FORCE=true ./scripts/update.sh [--check-only]' >&2
  exit 2
fi
if [[ "$force" != true && "$force" != false ]]; then
  echo 'FORCE must be true or false' >&2
  exit 2
fi

current=$(sed -n 's/^pkgver=//p' PKGBUILD)
current_rel=$(sed -n 's/^pkgrel=//p' PKGBUILD)
[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$current_rel" =~ ^[0-9]+$ ]] || {
  echo 'Invalid current package version or release' >&2
  exit 1
}

api_args=(-fsSL --retry 3 -H 'Accept: application/vnd.github+json')
if [[ -n ${GITHUB_TOKEN:-} ]]; then
  api_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
release=$(curl "${api_args[@]}" https://api.github.com/repos/pingdotgg/t3code/releases/latest)
tag=$(jq -er '.tag_name' <<<"$release")
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Unexpected release tag: $tag" >&2; exit 1; }
latest=${tag#v}
comparison=$(vercmp "$latest" "$current")
if (( comparison < 0 )); then
  echo "Upstream version $latest is older than packaged version $current" >&2
  exit 1
fi
if [[ "$check_only" == true ]]; then
  printf 'current_ver=%s\nlatest_ver=%s\n' "$current" "$latest"
  if (( comparison > 0 )) || [[ "$force" == true ]]; then
    echo 'needs_update=true'
  else
    echo 'needs_update=false'
  fi
  exit 0
fi
if (( comparison == 0 )) && [[ "$force" != true ]]; then
  echo "Already at upstream version $latest"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for upstream_arch in x64 arm64; do
  name="t3-${latest}-linux-${upstream_arch}.tar.gz"
  digest=$(jq -er --arg name "$name" '[.assets[] | select(.name == $name and .state == "uploaded") | .digest] | if length == 1 then .[0] else empty end' <<<"$release")
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing SHA256 for $name" >&2; exit 1; }
  url="https://github.com/pingdotgg/t3code/releases/download/${tag}/${name}"
  aria2c --quiet --max-tries=3 --retry-wait=3 -x 8 -s 8 -k 1M --dir "$work" --out "$name" "$url"
  printf '%s  %s\n' "${digest#sha256:}" "$work/$name" | sha256sum -c -
  if [[ "$upstream_arch" == x64 ]]; then
    x64_sha=${digest#sha256:}
  else
    arm64_sha=${digest#sha256:}
  fi
done
curl -fsSL --retry 3 -o "$work/LICENSE" "https://raw.githubusercontent.com/pingdotgg/t3code/${tag}/LICENSE"
license_sha=$(sha256sum "$work/LICENSE" | cut -d' ' -f1)
new_rel=1
if (( comparison == 0 )); then
  new_rel=$((current_rel + 1))
fi

cp PKGBUILD "$work/PKGBUILD"
sed -i \
  -e "s/^pkgver=.*/pkgver=$latest/" \
  -e "s/^pkgrel=.*/pkgrel=$new_rel/" \
  -e "s/^sha256sums=.*/sha256sums=('$license_sha')/" \
  -e "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('$x64_sha')/" \
  -e "s/^sha256sums_aarch64=.*/sha256sums_aarch64=('$arm64_sha')/" \
  "$work/PKGBUILD"
(cd "$work" && makepkg --printsrcinfo > .SRCINFO)
cp "$work/PKGBUILD" "$work/.SRCINFO" .
echo "Updated package to $latest-$new_rel"
