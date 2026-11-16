# layaair-cli

Arch Linux package for the official [LayaAir CLI](https://github.com/layabox/layaair-cli) runtime, published to the AUR as `layaair-cli`.

The package repacks the versioned runtime ZIP from Layabox's CDN. It does not build or patch the runtime itself, so the installed `layaair` command behaves like the official runtime for project creation, builds, validation, preview, and scripts.

## Requirements

- Arch Linux, `x86_64`
- Node.js 22.12 or newer (`nodejs`)

Upstream currently publishes only `linux-x64` runtime ZIPs for the 3.4 series. The installer advertises `arm64`, but the corresponding Linux ZIPs return 404, so this package is deliberately limited to `x86_64`.

## Install

```bash
yay -S layaair-cli
# or
paru -S layaair-cli
```

Then:

```bash
layaair --version
layaair create MyGame
layaair build web -p ./MyGame
layaair run -p ./MyGame
```

## Package layout

| Path | Purpose |
| --- | --- |
| `/opt/layaair-cli/` | Upstream runtime, including `Resources/` and bundled native tools |
| `/opt/layaair-cli/VERSION` | Installed runtime version |
| `/usr/bin/layaair` | Wrapper that invokes `node /opt/layaair-cli/Resources/cli-main.js` |

The upstream dispatcher supports multiple runtime versions and downloads them on demand. A system package provides exactly one version, so version switching is handled by pacman:

```bash
layaair --version          # print the installed runtime version
layaair list               # show the installed runtime
layaair install 3.4.0      # refused: use pacman
layaair uninstall 3.4.0    # refused: use pacman
```

To change versions, update the package with your AUR helper:

```bash
yay -S layaair-cli
# or
paru -S layaair-cli
```

`LAYAAIR_CLI_PREFIX` can override `/opt/layaair-cli`, which is useful for testing a package tree without installing it.

## Updating

The repository tracks `https://ldc-1251285021.file.myqcloud.com/layaair3/latest.txt`.

Check for a new upstream version without downloading:

```bash
./scripts/update.sh --check-only
./scripts/update.sh --check-only --format json
```

Download, recompute the checksum, update `PKGBUILD`, and regenerate `.SRCINFO`:

```bash
./scripts/update.sh
```

Useful options and environment variables:

| Option / variable | Purpose |
| --- | --- |
| `--force` / `FORCE=true` | Redownload the current version, bump `pkgrel`, and refresh the checksum |
| `CACHE_DIR=<dir>` | Cache downloaded runtime ZIPs |
| `ARIA2_CONNECTIONS=<n>` | Override the auto-detected aria2c connection count |
| `ARIA2_MIN_SPLIT_SIZE=<size>` | Override the aria2c split threshold (default `5M`) |

`aria2c` is used automatically when available; otherwise the script falls back to `curl`.

### Silent upstream replacement

If Layabox replaces the ZIP without changing the version or URL, the normal check sees no change. Run the workflow manually with `force=true` (or run `./scripts/update.sh --force`) to redownload, recompute the checksum, and bump `pkgrel` so AUR users receive the new revision.

## Nightly automation

`.github/workflows/auto-update.yml` runs daily at 02:00 UTC and can also be started manually:

1. Fetch the latest version from upstream.
2. Download and checksum the runtime ZIP (cached between runs).
3. Update `PKGBUILD` and regenerate `.SRCINFO`.
4. Commit and push to this repository.
5. Push `PKGBUILD` and `.SRCINFO` to the AUR repository.

Required repository secret:

- `AUR_SSH_PRIVATE_KEY`: private SSH key registered with the AUR account that owns `layaair-cli`.

The workflow creates the AUR repository on first push if it does not exist yet.

## Local build

```bash
makepkg -f
sudo pacman -U layaair-cli-3.4.3-1-x86_64.pkg.tar.zst
```

Adjust the filename when `pkgver` or `pkgrel` changes. To inspect the package without installing:

```bash
pacman -Qip layaair-cli-3.4.3-1-x86_64.pkg.tar.zst
pacman -Qlp layaair-cli-3.4.3-1-x86_64.pkg.tar.zst | head
```

## Layout

```text
.
├── PKGBUILD
├── .SRCINFO
├── scripts/update.sh
├── .github/workflows/auto-update.yml
└── README.md
```

## License

The packaging files in this repository are provided as-is. The bundled LayaAir CLI runtime is published by Layabox and remains under Layabox's own license; this repository only contains packaging metadata and automation.
