#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
selection=${1:-all}
status=0
matched=false
for pkgbuild in packages/*/PKGBUILD; do
  directory=${pkgbuild%/PKGBUILD}
  name=${directory##*/}
  [[ "$selection" == all || "$selection" == "$name" ]] || continue
  matched=true
  if ! ./scripts/aur update "$name" || ! ./scripts/aur verify "$name"; then
    echo "$name: update or validation failed; continuing with other packages." >&2
    status=1
    continue
  fi
  git add -- "$directory"
  if ! git diff --cached --quiet -- "$directory"; then
    git commit -m "chore($name): update packaging" -- "$directory"
  fi
  if ! git push origin HEAD; then
    status=1
    continue
  fi
  if [[ ${AUR_PUBLISH_ENABLED:-false} == true ]]; then
    # Run even if update produced no diff, so failed AUR pushes can be retried.
    if ! ./scripts/aur publish "$name"; then
      status=1
    fi
  else
    echo "$name: AUR publishing is disabled; set AUR_PUBLISH_ENABLED after configuring the SSH key."
  fi
done
[[ "$matched" == true ]] || { echo "Unknown repack: $selection" >&2; exit 2; }
exit "$status"
