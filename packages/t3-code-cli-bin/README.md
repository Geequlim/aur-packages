# t3-code-cli-bin

Arch Linux AUR package for the standalone [T3 Code](https://github.com/pingdotgg/t3code) CLI and web server. It installs the upstream release under `/opt/t3-code-cli-bin` and exposes the `t3` command. Both x86_64 and aarch64 are supported.

```sh
makepkg -si
t3 --help
```

The package downloads the official release archive from GitHub when it is built. Publishing the PKGBUILD to AUR does not provide a mirror of the archive; builders still need access to GitHub.

## Automatic updates

Managed by the shared [root workflow](../../.github/workflows/auto-update.yml). See the [maintenance guide](../../README.md). Run local package commands from `packages/t3-code-cli-bin`.
