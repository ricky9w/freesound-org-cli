---
name: fsnd
description: Search Freesound, inspect sound metadata, and download previews or original audio using the fsnd CLI. Use for programmatic sound sourcing and Freesound authentication troubleshooting.
---

Use the installed `fsnd` CLI; run `fsnd --help`, then the relevant command's `--help` when needed. This skill does not install or authenticate the executable automatically.

- Search with a small `--limit`; use `--fields` to keep results concise and `--filter` for duration/tags. Increase bounded `--pages` only when useful.
- Read details before selecting a sound. For auditions use `download ID --preview --output PATH`; original downloads omit `--preview` and require OAuth. Never label a preview as the original file.
- Prefer `--json` for machine use. Parse the envelope, check `ok`, and use returned file/metadata paths. Do not load entire audio files into tool output.
- Preserve the metadata sidecar with the source ID, creator, URL, format and hash. Downloads do not transcode and never overwrite.
- `doctor` is offline; `doctor --online` performs a read-only auth check. Dry runs and local callback tests do not establish live authentication.
- `auth status` reveals presence/expiry only. Use browser `auth login` with the user's configured application. It supports PKCE loopback callbacks; `--manual` supports the configured Freesound callback in an interactive terminal. Use `--env-file` for explicit local credentials; never echo secret contents.
- An uncertain authentication exchange is not automatically retried. Fix the reported condition; do not disable TLS checks or silently switch accounts.

Source repository README and `docs/authentication.md` describe application setup and production verification status. CLI commands and help are authoritative for the installed version. This skill supplies no CREVIK-specific creative preferences.
