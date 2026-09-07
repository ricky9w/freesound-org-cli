# fsnd

An unofficial Freesound CLI for people and coding agents. Search sounds, inspect metadata, authorize with OAuth, and save previews or original audio with provenance.

Requires Node.js 22+; also tested with Bun. Freesound is not affiliated with this project.

The npm package is `freesound-org-cli`; its installed command is `fsnd`. For a persistent installation: `npm install --global freesound-org-cli`.

```sh
npx freesound-org-cli --help
bunx freesound-org-cli --help
fsnd search "gentle rain" --filter 'duration:[30 TO 300]' --limit 5
fsnd details 12345
fsnd download 12345 --preview --output ./rain-preview.mp3
fsnd download 12345 --output ./rain.wav
```

From a checkout: `npm ci && npm run build`, then `node dist/index.js --help`.

## Authentication

OAuth can authenticate both public resources and original downloads. API-key mode is optional for read-only use. This release uses your own Freesound application; it does not embed a shared client ID or secret.

1. Register at https://freesound.org/apiv2/apply/ with callback `http://127.0.0.1/callback` (no port).
2. Run `fsnd auth configure --client-id YOUR_CLIENT_ID`.
3. Run `fsnd auth login`. Press Enter to open the browser, authorize, and return automatically.
4. Run `fsnd doctor --online --auth oauth`.

Automatic login uses PKCE. Upstream-source and local callback tests pass; see [authentication status and alternatives](docs/authentication.md) for the production verification boundary, existing manual callbacks, importing tokens and API-key mode.

## Human and agent output

TTY output is readable with progress on stderr. Non-TTY execution defaults to one JSON envelope on stdout. `--json` and `--human` override formatting. Errors use `ok:false`, a stable error code and exit status 1. Help/version are discovery text, not data envelopes.

```sh
fsnd search "soft wind" --limit 3 --json
fsnd search "soft wind" --fields id,name,duration --pages 2
fsnd api 'packs/12345/sounds/?page_size=5'
```

Downloads never overwrite files. Each saved audio file gets a `.json` sidecar with original metadata, preview/original distinction and SHA-256. `--pages` bounds searches; no implicit full-library traversal. Additional API resources are accessible through `api` (GET only); uploads and social actions are outside this release.

- [Authentication](docs/authentication.md)
- [Output and errors](docs/output.md)
- [Development](docs/development.md)
- Agent skill: `npx skills add ricky9w/freesound-org-cli --skill fsnd --agent codex claude-code` (run from the target project; omit `--global`).

## Development

```sh
npm ci
npm run check
npm pack --dry-run
```

Tests use synthetic credentials, mocked HTTP and a real local callback server; they never upload content or require a Freesound account.
