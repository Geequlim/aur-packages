# layaair-ide

Run the local commands below from `packages/layaair-ide`.

Repackage the official LayaAir IDE AppImage into an Arch Linux package and publish to AUR.

## How it works
- Fetches latest release metadata from:
  - `https://ldc-1251285021.file.myqcloud.com/layaair/log/3.0/navConfig.json`
- Picks the newest entry by `date`
- Downloads the Linux AppImage
- Updates `PKGBUILD` and `.SRCINFO`

The package extracts the AppImage and installs the unpacked app into `/opt/layaair-ide`, with desktop entry and icon configured for a normal Electron app.

## Local update
```bash
./scripts/update.sh
```

Check only, without downloading:
```bash
./scripts/update.sh --check-only
./scripts/update.sh --check-only --format json
```

Large AppImage downloads prefer `aria2c` automatically when available. You can override the auto-detected parallel connections with `ARIA2_CONNECTIONS`, and tune split size with `ARIA2_MIN_SPLIT_SIZE`.

## Automation

Updates and AUR publishing are managed by the shared [root workflow](../../.github/workflows/auto-update.yml). See the [maintenance guide](../../README.md) for credentials and commands.
