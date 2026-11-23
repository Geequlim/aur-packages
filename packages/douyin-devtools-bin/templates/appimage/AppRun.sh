#!/bin/sh
set -eu

if [ -z "${APPDIR:-}" ]; then
  APPDIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
fi

export GTK_MODULES=
export NO_AT_BRIDGE=1
if [ "${DOUYIN_KEEP_PROXY:-0}" != "1" ]; then
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
fi

USER_DATA_ARG="--user-data-dir=${XDG_CONFIG_HOME:-$HOME/.config}/douyin-devtools-linux"
for ARG in "$@"; do
  case "$ARG" in
    --user-data-dir*) USER_DATA_ARG="" ;;
  esac
done

if [ -n "$USER_DATA_ARG" ]; then
  exec "$APPDIR/usr/lib/douyin-devtools/electron" \
    --no-sandbox --gtk-version=3 "$USER_DATA_ARG" \
    "$APPDIR/usr/lib/douyin-devtools/resources/app" "$@"
else
  exec "$APPDIR/usr/lib/douyin-devtools/electron" \
    --no-sandbox --gtk-version=3 \
    "$APPDIR/usr/lib/douyin-devtools/resources/app" "$@"
fi
