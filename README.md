# fsnd

An unofficial Freesound CLI for humans and AI agents. Search sounds, inspect metadata, and download previews or original audio with source metadata.

[npm package](https://www.npmjs.com/package/freesound-org-cli) · [Freesound](https://freesound.org/)

## Install

Requires **Node.js 22+**; also tested with Bun. The package is `freesound-org-cli`; the installed command is `fsnd`.

```sh
npm install --global freesound-org-cli
fsnd --help
```

Without installing globally, replace `fsnd` in any command below with `npx freesound-org-cli` or `bunx freesound-org-cli`.

## Set up authentication

**Choose one path. You do not need to configure both.** Both use your own Freesound account and application, created on the [API credentials page](https://freesound.org/apiv2/apply/).

| What you need | Choose | Field to copy from Freesound |
| --- | --- | --- |
| Search, inspect sounds, download previews **and original files** | **OAuth (recommended)** | `Client id` |
| Search, inspect sounds and download previews only | **API key** | `Client secret/Api key` |

“API credentials” is Freesound's name for your application details, not a third authentication mode. fsnd does not bundle shared credentials.

### Option A: OAuth — including original downloads

1. Sign in to Freesound and [create an API application](https://freesound.org/apiv2/apply/). Set its callback/redirect URL to **`http://127.0.0.1/callback`**, with no port. Copy its **Client id**.
2. Replace `YOUR_CLIENT_ID` below and run:

   ```sh
   fsnd auth configure --client-id YOUR_CLIENT_ID --redirect-uri http://127.0.0.1/callback
   fsnd auth login
   ```

3. Press Enter when prompted to open the browser on the same computer. Sign in and approve access; the CLI receives the callback automatically. Return to the terminal and wait for login to finish.
4. Check the connection:

   ```sh
   fsnd doctor --online --auth oauth
   ```

fsnd saves the OAuth tokens locally and refreshes them as needed. You can now run the [usage examples](#use-it) without extra authentication flags. Check login status with `fsnd auth status` or sign out locally with `fsnd auth logout`.

Using an existing application with a different callback, a remote terminal, or a client that requires a secret? See the [authentication guide](docs/authentication.md), including the [browser-login verification status](docs/authentication.md#verification-status-2026-09-08).

### Option B: API key — search and previews

1. Sign in to Freesound and [create an API application](https://freesound.org/apiv2/apply/). Copy the value in **Client secret/Api key**, not Client id. No browser authorization is needed for this mode.
2. Create a local `.env` file containing your key:

   ```dotenv
   FREESOUND_API_KEY=YOUR_API_KEY
   ```

   Keep this file private and out of Git.
3. Check the connection, then search:

   ```sh
   fsnd doctor --online --auth key --env-file .env
   fsnd search "gentle rain" --limit 5 --auth key --env-file .env
   ```

Include **`--auth key --env-file .env` on each command** when using this setup: fsnd does not load `.env` automatically. For example, replace `12345` with an ID from the search results to download a preview:

```sh
fsnd download 12345 --preview --output ./rain-preview.mp3 --auth key --env-file .env
```

Original-file downloads require Option A. You do not need `auth login` for API-key mode.

## Use it

The examples below assume OAuth is set up. API-key users can search, inspect and download previews by appending the flags shown in Option B. Replace `12345` with a sound ID from your search results.

```sh
fsnd search "gentle rain" --filter 'duration:[30 TO 300]' --limit 5
fsnd details 12345
fsnd download 12345 --preview --output ./rain-preview.mp3
```

To download the original file with OAuth, omit `--preview`. Use the original file's extension from its metadata (`type`); this example assumes a WAV file. fsnd does not convert formats.

```sh
fsnd download 12345 --output ./rain.wav
```

Downloads never overwrite files. Each saved audio file gets a `.json` sidecar containing source metadata, the preview/original distinction and a SHA-256 checksum.

## Human and agent output

Interactive terminals get readable output, with progress on stderr. Noninteractive execution defaults to one JSON envelope on stdout. `--json` and `--human` override formatting. Errors use `ok:false`, a stable error code and exit status 1. Help/version are discovery text, not data envelopes.

```sh
fsnd search "soft wind" --limit 3 --json
fsnd search "soft wind" --fields id,name,duration --pages 2
fsnd search --help
```

`--pages` bounds searches; no implicit full-library traversal. `fsnd api 'packs/12345/sounds/?page_size=5'` accesses additional API resources (GET only). Uploads and social actions are outside this release.

- [Authentication, token storage and troubleshooting](docs/authentication.md)
- [Output and errors](docs/output.md)
- [Development](docs/development.md)
- Install the agent skill from your target project: `npx skills add ricky9w/freesound-org-cli --skill fsnd --agent codex claude-code` (omit `--global`).

## Development

```sh
npm ci
npm run check
node dist/index.js --help
npm pack --dry-run
```

Tests use synthetic credentials, mocked HTTP and a real local callback server; they never upload content or require a Freesound account.

This project is not affiliated with Freesound.
