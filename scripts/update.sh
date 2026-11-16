#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/update.sh [options]

Options:
  --check-only         Only detect whether an update is available.
  --format <format>    Output format for --check-only: plain (default) or json.
  --force              Redownload the current upstream version and bump pkgrel.
  -h, --help           Show this help.

Environment:
  FORCE=true           Same as --force.
  CACHE_DIR=<dir>      Cache downloaded runtime ZIPs in this directory.
  ARIA2_CONNECTIONS=N  Parallel connections for aria2c (auto-detected by default).
  ARIA2_MIN_SPLIT_SIZE Size threshold for aria2c splits (default: 5M).
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

LATEST_URL="https://ldc-1251285021.file.myqcloud.com/layaair3/latest.txt"
CURL_RETRY_ARGS=(--http1.1 --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 30)
ARIA2_MIN_SPLIT_SIZE="${ARIA2_MIN_SPLIT_SIZE:-5M}"

detect_download_connections() {
  local configured="${ARIA2_CONNECTIONS:-}"
  local cpu_count
  local connections

  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return
  fi

  cpu_count="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
  if ! [[ "$cpu_count" =~ ^[0-9]+$ ]] || [[ "$cpu_count" -lt 1 ]]; then
    cpu_count=2
  fi

  connections=$(( cpu_count * 2 ))
  if [[ "$connections" -lt 4 ]]; then
    connections=4
  elif [[ "$connections" -gt 16 ]]; then
    connections=16
  fi

  printf '%s' "$connections"
}

download_file() {
  local url="$1"
  local dest="$2"
  local dir_path
  local file_name
  local connections
  local cpu_count

  dir_path="$(dirname "$dest")"
  file_name="$(basename "$dest")"

  if command -v aria2c >/dev/null 2>&1; then
    connections="$(detect_download_connections)"
    cpu_count="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
    echo "Using downloader: aria2c (cpu_count=${cpu_count}, connections=${connections}, min_split_size=${ARIA2_MIN_SPLIT_SIZE})"
    aria2c \
      --allow-overwrite=true \
      --auto-file-renaming=false \
      --continue=true \
      --max-tries=5 \
      --retry-wait=2 \
      --connect-timeout=30 \
      --timeout=30 \
      --summary-interval=0 \
      --console-log-level=warn \
      --file-allocation=none \
      --split="${connections}" \
      --max-connection-per-server="${connections}" \
      --min-split-size="${ARIA2_MIN_SPLIT_SIZE}" \
      --dir="$dir_path" \
      --out="$file_name" \
      "$url"
    return
  fi

  echo "Using downloader: curl"
  curl "${CURL_RETRY_ARGS[@]}" -fL "$url" -o "$dest"
}

FORCE="${FORCE:-false}"
CACHE_DIR="${CACHE_DIR:-}"
CHECK_ONLY=false
OUTPUT_FORMAT="plain"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      CHECK_ONLY=true
      ;;
    --format)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --format" >&2
        exit 1
      fi
      OUTPUT_FORMAT="$1"
      ;;
    --force)
      FORCE=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$OUTPUT_FORMAT" != "plain" && "$OUTPUT_FORMAT" != "json" ]]; then
  echo "Unsupported format: $OUTPUT_FORMAT" >&2
  exit 1
fi

if [[ "$OUTPUT_FORMAT" == "json" ]] && ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for --format json" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

print_detection_result() {
  local status="$1"
  local reason="$2"
  local current_ver="$3"
  local current_url="$4"
  local latest_ver="$5"
  local latest_url="$6"
  local source_url="$7"
  local source_hash="$8"
  local current_sha="$9"
  local needs_update="${10}"

  if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    jq -nc \
      --arg status "$status" \
      --arg reason "$reason" \
      --arg current_ver "$current_ver" \
      --arg current_url "$current_url" \
      --arg latest_ver "$latest_ver" \
      --arg latest_url "$latest_url" \
      --arg source_url "$source_url" \
      --arg source_hash "$source_hash" \
      --arg current_sha "$current_sha" \
      --arg FORCE "$FORCE" \
      --argjson needs_update "$needs_update" \
      '{
        status: $status,
        reason: $reason,
        needs_update: $needs_update,
        current_ver: $current_ver,
        current_url: $current_url,
        latest_ver: $latest_ver,
        latest_url: $latest_url,
        current_sha256: $current_sha,
        source_url: $source_url,
        source_hash: $source_hash,
        FORCE: ($FORCE == "true")
      }'
    return
  fi

  cat <<EOF
status=${status}
reason=${reason}
needs_update=${needs_update}
current_ver=${current_ver}
current_url=${current_url}
latest_ver=${latest_ver}
latest_url=${latest_url}
current_sha256=${current_sha}
source_url=${source_url}
source_hash=${source_hash}
FORCE=${FORCE}
EOF
}

# Avoid CDN and proxy caches masking the current latest.txt.
cache_buster="$(date -u +%s)-$$"
separator='?'
if [[ "$LATEST_URL" == *\?* ]]; then
  separator='&'
fi
source_url="${LATEST_URL}${separator}_=${cache_buster}"

if ! latest_text=$(curl "${CURL_RETRY_ARGS[@]}" -fsSL \
  -H 'Cache-Control: no-cache, no-store, max-age=0' \
  -H 'Pragma: no-cache' \
  -H 'Expires: 0' \
  "$source_url"); then
  echo "Failed to fetch $LATEST_URL" >&2
  exit 1
fi

source_hash="$(printf '%s' "$latest_text" | sha256sum | awk '{print $1}')"
ver="$(printf '%s' "$latest_text" | LC_ALL=C tr -d '[:space:]' | sed 's/^\xEF\xBB\xBF//')"

if ! [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+([._-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Failed to parse upstream version: '$ver'" >&2
  exit 1
fi

major="$(printf '%s' "$ver" | cut -d. -f1)"
minor="$(printf '%s' "$ver" | cut -d. -f2)"
if [[ -z "$major" || -z "$minor" ]]; then
  echo "Failed to derive a release series from version: $ver" >&2
  exit 1
fi

latest_url="https://ldc-1251285021.file.myqcloud.com/layaair3/layaair-${major}.${minor}/cli/layaair-cli-${ver}-linux-x64.zip"

current_ver=$(sed -n 's/^_upstream_ver=//p' PKGBUILD | head -n1 || true)
current_url=$(sed -n 's/^_url=//p' PKGBUILD | head -n1 || true)
current_pkgrel=$(sed -n 's/^pkgrel=//p' PKGBUILD | head -n1 || true)
current_sha=$(sed -n "s/^sha256sums=('\([^']*\)').*/\1/p" PKGBUILD | head -n1 || true)

status="up-to-date"
reason="no_change"
needs_update=false

if [[ "$current_ver" != "$ver" || "$current_url" != "$latest_url" ]]; then
  status="update-available"
  reason="upstream_changed"
  needs_update=true
elif [[ "$FORCE" == "true" ]]; then
  status="update-available"
  reason="FORCE"
  needs_update=true
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
  print_detection_result "$status" "$reason" "$current_ver" "$current_url" "$ver" "$latest_url" "$source_url" "$source_hash" "$current_sha" "$needs_update"
  exit 0
fi

echo "Detection result: status=${status}, reason=${reason}, current=${current_ver:-unknown}, latest=${ver}"

if [[ "$needs_update" != "true" ]]; then
  echo "Already up to date: ${ver}"
  exit 0
fi

if ! command -v makepkg >/dev/null 2>&1; then
  echo "makepkg is required to regenerate .SRCINFO" >&2
  exit 1
fi

if ! command -v bsdtar >/dev/null 2>&1; then
  echo "bsdtar is required to validate the downloaded ZIP" >&2
  exit 1
fi

pkgver="${ver//-/_}"
pkgrel=1

if [[ "$current_ver" == "$ver" && "$current_pkgrel" =~ ^[0-9]+$ && "$current_pkgrel" -ge 1 ]]; then
  if [[ "$FORCE" == "true" || "$current_url" != "$latest_url" ]]; then
    pkgrel=$((current_pkgrel + 1))
    echo "Refreshing the same upstream version; bumping pkgrel to ${pkgrel} so AUR users see a new revision."
  fi
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

source_name="layaair-cli-${pkgver}-${pkgrel}.zip"
work_zip="$workdir/$source_name"
cached_zip=""

if [[ -n "$CACHE_DIR" ]]; then
  mkdir -p "$CACHE_DIR"
  url_hash="$(printf '%s' "$latest_url" | sha256sum | awk '{print $1}')"
  cached_zip="${CACHE_DIR}/${url_hash}.zip"
fi

use_cache=false
if [[ "$FORCE" != "true" && -n "$cached_zip" && -s "$cached_zip" ]]; then
  if bsdtar -tf "$cached_zip" >/dev/null 2>&1; then
    use_cache=true
  else
    echo "Ignoring invalid cached ZIP: $cached_zip"
  fi
fi

if [[ "$use_cache" == "true" ]]; then
  echo "Using cached ZIP: $cached_zip"
  cp -f "$cached_zip" "$work_zip"
else
  if [[ "$FORCE" == "true" && -n "$cached_zip" && -e "$cached_zip" ]]; then
    echo "[FORCE] Skipping cached ZIP restore: $cached_zip"
  fi
  echo "Downloading runtime: $latest_url"
  if ! download_file "$latest_url" "$work_zip"; then
    echo "Failed to download: $latest_url" >&2
    exit 1
  fi
fi

zip_list="$workdir/zip-list.txt"
if ! bsdtar -tf "$work_zip" > "$zip_list" 2>/dev/null; then
  echo "Downloaded file is not a valid ZIP: $work_zip" >&2
  exit 1
fi
if ! grep -qx 'Resources/cli-main.js' "$zip_list"; then
  echo "ZIP does not contain Resources/cli-main.js: $work_zip" >&2
  exit 1
fi

if [[ "$use_cache" != "true" && -n "$cached_zip" ]]; then
  cp -f "$work_zip" "$cached_zip"
  echo "Saved ZIP to cache: $cached_zip"
fi

sha256="$(sha256sum "$work_zip" | awk '{print $1}')"

for key in _upstream_ver pkgver pkgrel _url sha256sums; do
  if ! grep -q "^${key}=" PKGBUILD; then
    echo "PKGBUILD is missing expected field: ${key}" >&2
    exit 1
  fi
done

sed -i "s/^_upstream_ver=.*/_upstream_ver=${ver}/" PKGBUILD
sed -i "s/^pkgver=.*/pkgver=${pkgver}/" PKGBUILD
sed -i "s/^pkgrel=.*/pkgrel=${pkgrel}/" PKGBUILD
sed -i "s#^_url=.*#_url=${latest_url}#" PKGBUILD
sed -i "s/^sha256sums=.*/sha256sums=('${sha256}')/" PKGBUILD

# Ensure FORCE runs produce a diff even when the upstream version is unchanged.
if [[ "$FORCE" == "true" ]]; then
  ts="$(date -u +%Y%m%d%H%M%S)"
  if grep -q '^_FORCE_ts=' PKGBUILD; then
    sed -i "s/^_FORCE_ts=.*/_FORCE_ts=${ts}/" PKGBUILD
  else
    sed -i "1i_FORCE_ts=${ts}" PKGBUILD
  fi
fi

srcinfo_tmp="$(mktemp)"
makepkg --printsrcinfo > "$srcinfo_tmp"
mv "$srcinfo_tmp" .SRCINFO

echo "Updated to ${ver} (pkgver=${pkgver}, pkgrel=${pkgrel})"
echo "sha256=${sha256}"
