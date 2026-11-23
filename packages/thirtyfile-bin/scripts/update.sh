#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
force=${FORCE:-false}
check_only=false
if [[ $# -eq 1 && "$1" == --check-only ]]; then
  check_only=true
elif [[ $# -ne 0 ]]; then
  echo 'Usage: FORCE=true ./scripts/update.sh [--check-only]' >&2
  exit 2
fi
[[ "$force" == true || "$force" == false ]] || { echo 'FORCE must be true or false' >&2; exit 2; }
for tool in curl jq vercmp; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

upstream=ThirtyFile/ThirtyFile
api_args=(-fsSL --retry 3 --connect-timeout 20 --max-time 60 -H 'Accept: application/vnd.github+json')
if [[ -n ${GITHUB_TOKEN:-} ]]; then
  api_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
release=$(curl "${api_args[@]}" "https://api.github.com/repos/$upstream/releases/latest")
if ! jq -e '.draft == false and .prerelease == false' <<< "$release" >/dev/null; then
  echo 'The upstream release is a draft or prerelease.' >&2
  exit 1
fi
tag=$(jq -er '.tag_name' <<< "$release")
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Unexpected stable release tag: $tag" >&2; exit 1; }
latest=${tag#v}
current=$(sed -n 's/^pkgver=//p' PKGBUILD)
current_rel=$(sed -n 's/^pkgrel=//p' PKGBUILD)
[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$current_rel" =~ ^[0-9]+$ ]] || { echo 'Invalid current package version' >&2; exit 1; }
comparison=$(vercmp "$latest" "$current")
(( comparison >= 0 )) || { echo "Refusing upstream downgrade: $current -> $latest" >&2; exit 1; }

amd64="thirtyfile-${latest}-linux-amd64"
arm64="thirtyfile-${latest}-linux-arm64"
required=(LICENSE THIRD-PARTY-NOTICES SHA256SUMS "$amd64" "$arm64")
declare -A digests
for name in "${required[@]}"; do
  if ! digest=$(jq -er --arg name "$name" '[.assets[] | select(.name == $name and .state == "uploaded") | .digest] | if length == 1 then .[0] else empty end' <<< "$release"); then
    echo "Required release asset is missing or ambiguous: $name" >&2
    exit 1
  fi
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing SHA256 release digest: $name" >&2; exit 1; }
  digests[$name]=${digest#sha256:}
done

helpers=(thirtyfile.service thirtyfile.conf thirtyfile.sysusers)
changed_in_place=false
if (( comparison == 0 )); then
  mapfile -t common_hashes < <(awk '$1 == "sha256sums" {print $3}' .SRCINFO)
  [[ ${#common_hashes[@]} -eq 5 ]] || { echo 'Invalid package checksum metadata' >&2; exit 1; }
  recorded_amd64=$(awk '$1 == "sha256sums_x86_64" {print $3}' .SRCINFO)
  recorded_arm64=$(awk '$1 == "sha256sums_aarch64" {print $3}' .SRCINFO)
  if [[ "${common_hashes[0]}" != "${digests[LICENSE]}" || "${common_hashes[1]}" != "${digests[THIRD-PARTY-NOTICES]}" || "$recorded_amd64" != "${digests[$amd64]}" || "$recorded_arm64" != "${digests[$arm64]}" ]]; then
    changed_in_place=true
  fi
  for index in "${!helpers[@]}"; do
    digest=$(sha256sum "${helpers[$index]}")
    [[ "${common_hashes[$((index + 2))]}" == "${digest%% *}" ]] || changed_in_place=true
  done
fi
needs_update=false
if (( comparison > 0 )) || [[ "$changed_in_place" == true || "$force" == true ]]; then
  needs_update=true
fi
if [[ "$check_only" == true ]]; then
  printf 'current_ver=%s\nlatest_ver=%s\nneeds_update=%s\nchanged_in_place=%s\n' "$current" "$latest" "$needs_update" "$changed_in_place"
  exit 0
fi
if [[ "$changed_in_place" == true && "$force" != true ]]; then
  echo 'Files changed without a version change. Review the release, then rerun with FORCE=true.' >&2
  exit 1
fi
if [[ "$needs_update" == false ]]; then
  echo "Already at verified release $tag"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for name in "${required[@]}"; do
  curl -fsSL --retry 3 --connect-timeout 20 --max-time 300 \
    "https://github.com/$upstream/releases/download/$tag/$name" -o "$work/$name"
  printf '%s  %s\n' "${digests[$name]}" "$work/$name" | sha256sum -c -
done
for name in LICENSE THIRD-PARTY-NOTICES "$amd64" "$arm64"; do
  published=$(awk -v name="$name" '$2 == name {print $1}' "$work/SHA256SUMS")
  [[ "$published" == "${digests[$name]}" ]] || { echo "SHA256SUMS does not match the release: $name" >&2; exit 1; }
done
for name in "$amd64" "$arm64"; do
  header=$(LC_ALL=C readelf -h "$work/$name")
  if [[ "$name" == "$amd64" ]]; then
    [[ "$header" == *'Advanced Micro Devices X86-64'* ]] || { echo 'Wrong amd64 ELF architecture' >&2; exit 1; }
  else
    [[ "$header" == *AArch64* ]] || { echo 'Wrong arm64 ELF architecture' >&2; exit 1; }
  fi
  dynamic=$(LC_ALL=C readelf -d "$work/$name")
  [[ "$dynamic" != *'(NEEDED)'* ]] || { echo "Upstream binary is no longer static: $name" >&2; exit 1; }
  gh attestation verify "$work/$name" --repo "$upstream" \
    --signer-workflow "$upstream/.github/workflows/release.yml"
done

new_rel=1
if (( comparison == 0 )); then new_rel=$((current_rel + 1)); fi
common=("${digests[LICENSE]}" "${digests[THIRD-PARTY-NOTICES]}")
for name in "${helpers[@]}"; do
  digest=$(sha256sum "$name")
  common+=("${digest%% *}")
  cp "$name" "$work/$name"
done
cp PKGBUILD "$work/PKGBUILD"
sed -i \
  -e "s/^pkgver=.*/pkgver=$latest/" \
  -e "s/^pkgrel=.*/pkgrel=$new_rel/" \
  -e "s/^sha256sums=.*/sha256sums=('${common[0]}' '${common[1]}' '${common[2]}' '${common[3]}' '${common[4]}')/" \
  -e "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('${digests[$amd64]}')/" \
  -e "s/^sha256sums_aarch64=.*/sha256sums_aarch64=('${digests[$arm64]}')/" \
  "$work/PKGBUILD"
(cd "$work" && makepkg --printsrcinfo > .SRCINFO)
cp "$work/PKGBUILD" "$work/.SRCINFO" .
echo "Updated ThirtyFile to $latest-$new_rel after checksum and provenance verification."
