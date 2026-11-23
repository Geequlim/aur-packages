# thirtyfile-bin

Arch Linux package for the official [ThirtyFile](https://github.com/ThirtyFile/ThirtyFile) stable binaries. Supports x86_64 and aarch64. The static program includes the web interface; it runs directly on the host.

## Install and start

```bash
yay -S thirtyfile-bin
sudo systemctl enable --now thirtyfile.service
```

Open http://127.0.0.1:8080. The first start creates the `admin` account and prints its randomly generated password in the service journal:

```bash
sudo journalctl -u thirtyfile.service -b
```

Settings are in `/etc/thirtyfile/thirtyfile.conf`; restart the service after editing them or upgrading the package. Pacman preserves local changes to this file. To serve other machines, change `THIRTYFILE_ADDR` as appropriate and follow the [upstream reverse proxy guide](https://thirtyfile.github.io/ThirtyFile/docs/internet.html).

The service runs as `thirtyfile`. Systemd creates `/var/lib/thirtyfile` for this account. The database and encryption key are under `/var/lib/thirtyfile/data`, and built-in file storage is under `/var/lib/thirtyfile/storage`. Back up both folders, including `secret.key`. Access to additional local folders follows the service account's filesystem permissions.

Reset the administrator password interactively using the same state folder:

```bash
sudo -u thirtyfile env THIRTYFILE_DATA=/var/lib/thirtyfile/data THIRTYFILE_STORAGE=/var/lib/thirtyfile/storage thirtyfile reset-password admin
```

Optional FTP receive folders use port 2121 so the ordinary service account can bind it. FTP and SFTP are activated separately in ThirtyFile's control panel. Other settings and the single-user mode are described in the [upstream guide](https://thirtyfile.github.io/ThirtyFile/docs/settings.html).

The upstream command line is also available directly:

```bash
thirtyfile --help
```

## Updates

From the maintenance repository root:

```bash
./scripts/aur check thirtyfile-bin
./scripts/aur update thirtyfile-bin
./scripts/aur verify thirtyfile-bin
./scripts/aur build thirtyfile-bin
```

The shared daily workflow checks the newest stable release. An update requires both Linux architectures, `LICENSE`, `THIRD-PARTY-NOTICES` and `SHA256SUMS`. It checks GitHub's SHA-256 digests, the checksum manifest, ELF architecture and static linkage, then verifies both binaries' GitHub attestations against `ThirtyFile/ThirtyFile/.github/workflows/release.yml` before writing packaging changes.

The updater uses `curl`, `jq`, `vercmp`, `readelf`, `makepkg` and GitHub CLI (`gh`). If upstream replaces files without changing the version, the normal update reports the change. After reviewing it, `FORCE=true ./scripts/aur update thirtyfile-bin` refreshes and increments `pkgrel`.

After validation, the shared workflow commits the metadata and synchronizes AUR using the existing `AUR_SSH_PRIVATE_KEY`. It publishes the service, configuration and sysusers files together with `PKGBUILD` and `.SRCINFO`.
