# t3-code-cli-bin

> Maintenance has moved to [Geequlim/aur-packages](https://github.com/Geequlim/aur-packages/tree/main/packages/t3-code-cli-bin). Please use the new repository for updates and issues. This repository retains historical code and releases; scheduled updates now run in the new repository.

Arch Linux AUR package for the standalone [T3 Code](https://github.com/pingdotgg/t3code) CLI and web server. It installs the upstream release under `/opt/t3-code-cli-bin` and exposes the `t3` command. Both x86_64 and aarch64 are supported.

```sh
makepkg -si
t3 --help
```

The package downloads the official release archive from GitHub when it is built. Publishing the PKGBUILD to AUR does not provide a mirror of the archive; builders still need access to GitHub.

## Automatic updates

The GitHub Actions workflow checks the latest upstream stable release daily at 02:00 UTC and can also be run manually from the repository's default branch. On a new version it downloads and verifies both architecture archives against GitHub's release SHA-256 digests, updates `PKGBUILD` and `.SRCINFO`, and commits the result to GitHub. Each run also checks AUR and pushes packaging changes if needed, so a failed AUR push is retried on the next run. The manual `force` option rechecks the current release and increments `pkgrel`.

The repository uses the `AUR_SSH_PRIVATE_KEY` Actions secret for an AUR account with permission to maintain `t3-code-cli-bin`. It is configured with the same key as the layaair package. A first run publishes the package; subsequent runs synchronize changes.

The workflow requires access to GitHub's release API and AUR over SSH. AUR publishing has not occurred until the workflow succeeds.
