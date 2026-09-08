# Authentication

## Choose a mode

`--auth auto` prefers saved OAuth credentials, then an API key. `--auth oauth` requires OAuth. `--auth key` explicitly chooses API-key authentication. Original audio downloads require OAuth; search, details and other ordinary API resources accept OAuth too. An expired/invalid OAuth login is reported, not silently replaced with key authentication.

The API key and client secret appear in the same Freesound credential-table column. They serve different roles: `Authorization: Token …` authenticates key-mode requests, while a client secret may be used during OAuth token exchange. Bearer API requests do not include that key.

## Browser login

Register your application at https://freesound.org/apiv2/apply/ and set its callback to `http://127.0.0.1/callback`, without a port. Configure the same callback locally:

```sh
fsnd auth configure --client-id YOUR_CLIENT_ID --redirect-uri http://127.0.0.1/callback
fsnd auth login
```

The CLI binds an ephemeral port on 127.0.0.1 only, generates state and S256 PKCE, opens https://freesound.org/apiv2/oauth2/authorize/, receives the callback and exchanges the code at https://freesound.org/apiv2/oauth2/access_token/. Tokens are saved without printing them. Browser opening can be skipped with `--no-open`. `--open` opens immediately. The default callback timeout is 180 seconds, configurable up to 600.

Noninteractive login prints the URL to stderr and waits for callback; it does not open the browser by default. In remote shells the browser and listener must be on the same machine or have explicit port forwarding; use manual mode if they do not.

### Verification status (2026-09-08)

Freesound's documentation shows client-secret exchange. Its public source at commit `829678a193973c454750545986d832e191955600` registers public clients, uses django-oauth-toolkit 3.0.1 and disables mandatory PKCE while supporting it. An isolated test using that validator and dependency version verified dynamic loopback ports, S256 exchange without secret, refresh without secret and rejection of an incorrect verifier. fsnd additionally tests the actual local HTTP callback and concurrent refresh behavior.

Normal HTTPS connectivity was restored on 2026-09-08, and `fsnd doctor --online --auth oauth` succeeded with existing OAuth credentials. A newly registered application's complete PKCE/browser login still needs production verification; the local tests above do not establish that end-to-end result. Do not disable TLS checks. No shared production client ID is distributed in this release.

Sources: https://freesound.org/docs/api/authentication.html ; https://github.com/MTG/freesound/blob/829678a193973c454750545986d832e191955600/apiv2/models.py ; https://github.com/MTG/freesound/blob/829678a193973c454750545986d832e191955600/freesound/settings.py

## Existing manual callback

If your existing application uses Freesound's code display page, retain its exact registered callback:

```sh
fsnd auth configure --client-id YOUR_CLIENT_ID --redirect-uri https://freesound.org/home/app_permissions/permission_granted/
fsnd auth login --manual
```

Paste the **full URL from the browser address bar** at the hidden prompt. It must contain code and matching state. Raw authorization codes alone are not accepted. Manual mode needs an interactive terminal. This is an authorization-code flow, not the OAuth device-code flow.

If a configured application requires a secret, set `FREESOUND_CLIENT_SECRET` in a local env file and supply `--env-file PATH`. No secret flag is provided, to keep secrets out of shell history. Do not put a shared client secret in the npm package.

## Existing credentials

`fsnd auth import --token-file PATH --env-file PATH` imports a JSON token file with `access_token`, numeric Unix `expires_at`, and optional `refresh_token`. The environment must identify the same application with `FREESOUND_CLIENT_ID`. Legacy `FREESOUND_API_KEY` is also saved as its client secret during import. Existing token storage is never overwritten by import; sign out locally first if switching accounts. Set `FREESOUND_REDIRECT_URI` to the application's registered callback when importing.

`--env-file` is explicit: fsnd never scans arbitrary parent directories for secrets and never evaluates dotenv as shell code. Existing process environment variables take precedence.

## Storage and refresh

Configuration defaults to `${XDG_CONFIG_HOME:-~/.config}/fsnd`; override with `FSND_CONFIG_DIR` for tests or a separate profile. Credential files use mode 0600 and newly created directories 0700. `auth status` prints presence/expiry, never token values. Refresh is serialized with a file lock and tokens are replaced atomically. A crashed login may leave `auth.lock`; remove it only after confirming no fsnd process is active. Authentication POST requests are not automatically retried.

`auth logout` deletes local OAuth tokens only. Saved API keys remain usable when key mode is selected or auto has no OAuth login. Revoke server authorization separately at https://freesound.org/home/app_permissions/ .

For API-key-only use, set `FREESOUND_API_KEY` via an explicit env file, then run `fsnd doctor --online --auth key --env-file PATH`. Pass `--auth key --env-file PATH` on subsequent commands too; a local `.env` file is not loaded automatically. See the [README walkthrough](../README.md#option-b-api-key--search-and-previews).
