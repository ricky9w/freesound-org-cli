# Output contract, version 1

Successful data commands emit `{ "schemaVersion": 1, "ok": true, "data": ... }` in non-TTY mode or with `--json`. Failed commands emit `{ "schemaVersion": 1, "ok": false, "error": { "code": "...", "message": "...", "hint": "..." } }` and exit 1. Optional hint/status fields may be omitted. Help and version remain text.

Search data contains `count` (provider total), `results`, `returned` and `next` (null when exhausted). The default search projection includes id, name, username, duration, license, tags, previews and type. Use `--fields` to reduce context. The service's native field types remain intact.

Download data contains absolute `file`, byte count, SHA-256, content type, `preview` and `metadataFile`. The sidecar keeps the original provider metadata. File extensions are chosen by the caller; use sound `type` for originals and `.mp3` for previews. No conversion is performed.

Common error codes: `INVALID_ARGUMENT`, `AUTH_REQUIRED`, `OAUTH_REQUIRED`, `AUTH_REJECTED`, `CLIENT_REQUIRED`, `CLIENT_MISMATCH`, `AUTH_BUSY`, `AUTH_TIMEOUT`, `STATE_MISMATCH`, `NETWORK_ERROR`, `TLS_ERROR`, `RATE_LIMITED`, `API_ERROR`, `OUTPUT_EXISTS`, `DOWNLOAD_FAILED`.

Read-only API requests retry at most twice for 429/5xx with bounded backoff. Long Retry-After values return an error rather than wait indefinitely. OAuth exchanges and interrupted downloads are not automatically retried. Download redirects retain authentication only on the Freesound API origin/path; CDN requests do not receive Bearer credentials. Unsupported hosts are rejected.
