import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { password, confirm, isCancel } from "@clack/prompts";
import {
  AppError,
  configDir,
  readJson,
  privateJson,
  locked,
  interactive,
  networkError,
} from "./core.js";

const API = "https://freesound.org/apiv2";
export interface Config {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  redirectUri?: string;
}
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  client_id?: string;
}
export const configPath = () => join(configDir(), "config.json");
export const tokenPath = () => join(configDir(), "tokens.json");
export async function config(): Promise<Config> {
  const saved = (await readJson<Config>(configPath())) || {};
  return {
    clientId: process.env.FREESOUND_CLIENT_ID || saved.clientId,
    clientSecret: process.env.FREESOUND_CLIENT_SECRET || saved.clientSecret,
    apiKey: process.env.FREESOUND_API_KEY || saved.apiKey,
    redirectUri:
      process.env.FREESOUND_REDIRECT_URI ||
      saved.redirectUri ||
      "http://127.0.0.1/callback",
  };
}
export async function configure(clientId?: string, redirectUri?: string) {
  return locked("auth", async () => {
    const current = await config();
    if (clientId) {
      if (current.clientId && current.clientId !== clientId) {
        delete current.clientSecret;
        delete current.apiKey;
      }
      current.clientId = clientId;
    }
    if (redirectUri) {
      validateRedirect(redirectUri);
      current.redirectUri = redirectUri;
    }
    await privateJson(configPath(), current);
    return status();
  });
}
export async function status() {
  const c = await config(),
    t = await readJson<Tokens>(tokenPath());
  return {
    configured: !!(c.clientId || c.apiKey),
    clientId: c.clientId,
    redirectUri: c.redirectUri,
    apiKeyAvailable: !!c.apiKey,
    oauthAvailable: !!t?.access_token,
    expiresAt: t?.expires_at
      ? new Date(t.expires_at * 1000).toISOString()
      : null,
    expired: t ? t.expires_at <= Date.now() / 1000 : null,
    storage: configDir(),
  };
}
export async function importTokens(path: string) {
  return locked("auth", async () => {
    if (await readJson(tokenPath()))
      throw new AppError(
        "AUTH_EXISTS",
        "OAuth credentials already exist.",
        "Use fsnd auth logout before importing another account.",
      );
    const t = await readJson<Tokens>(path),
      c = await config();
    if (
      !t ||
      typeof t.access_token !== "string" ||
      !Number.isFinite(t.expires_at)
    )
      throw new AppError(
        "INVALID_TOKEN_FILE",
        "Expected access_token and numeric expires_at.",
      );
    if (!c.clientId)
      throw new AppError(
        "CLIENT_REQUIRED",
        "Set FREESOUND_CLIENT_ID before importing.",
      );
    // Legacy Freesound credentials use one Client secret / API key column.
    await privateJson(configPath(), {
      ...c,
      clientSecret: c.clientSecret || c.apiKey,
    });
    await privateJson(tokenPath(), { ...t, client_id: c.clientId });
    return status();
  });
}
async function exchange(
  fields: Record<string, string>,
  c: Config,
  previous?: Tokens,
): Promise<Tokens> {
  if (!c.clientId)
    throw new AppError(
      "CLIENT_REQUIRED",
      "An application client ID is required.",
      "Register an application at https://freesound.org/apiv2/apply/ and run fsnd auth configure --client-id ID.",
    );
  const body = new URLSearchParams({ client_id: c.clientId, ...fields });
  if (c.clientSecret) body.set("client_secret", c.clientSecret);
  let r: Response;
  try {
    r = await fetch(`${API}/oauth2/access_token/`, {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    const network = networkError(e);
    if (network.code === "TLS_ERROR") throw network;
    throw new AppError(
      "AUTH_UNCERTAIN",
      "Token exchange did not complete. It has not been retried.",
      "Start a fresh login if necessary.",
    );
  }
  if (!r.ok)
    throw new AppError(
      "AUTH_REJECTED",
      "Freesound rejected the token exchange.",
      "Check the client configuration or log in again.",
      r.status,
    );
  const data = (await r.json()) as Record<string, unknown>;
  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number" ||
    data.expires_in <= 0
  )
    throw new AppError(
      "INVALID_RESPONSE",
      "Freesound returned an invalid token response.",
    );
  return {
    access_token: data.access_token,
    refresh_token:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : previous?.refresh_token,
    expires_at: Date.now() / 1000 + data.expires_in,
    scope: typeof data.scope === "string" ? data.scope : undefined,
    client_id: c.clientId,
  };
}
export async function authorization(
  mode: string = "auto",
  oauthRequired = false,
): Promise<string> {
  if (!["auto", "oauth", "key"].includes(mode))
    throw new AppError(
      "INVALID_ARGUMENT",
      "--auth must be auto, oauth or key.",
    );
  const c = await config();
  if (mode !== "key") {
    let t = await readJson<Tokens>(tokenPath());
    if (t) {
      if (t.client_id && t.client_id !== c.clientId)
        throw new AppError(
          "CLIENT_MISMATCH",
          "Stored OAuth token belongs to another application.",
        );
      if (t.expires_at <= Date.now() / 1000 + 60) {
        t = await locked("auth", async () => {
          const latest = await readJson<Tokens>(tokenPath());
          if (!latest)
            throw new AppError(
              "LOGIN_REQUIRED",
              "Log in with fsnd auth login.",
            );
          if (latest.expires_at > Date.now() / 1000 + 60) return latest;
          if (!latest.refresh_token)
            throw new AppError(
              "LOGIN_REQUIRED",
              "Refresh token is missing. Run fsnd auth login.",
            );
          const renewed = await exchange(
            {
              grant_type: "refresh_token",
              refresh_token: latest.refresh_token,
            },
            c,
            latest,
          );
          await privateJson(tokenPath(), renewed);
          return renewed;
        });
      }
      return `Bearer ${t.access_token}`;
    }
  }
  if (oauthRequired || mode === "oauth")
    throw new AppError(
      "OAUTH_REQUIRED",
      "This operation needs OAuth.",
      "Run fsnd auth login.",
    );
  if (c.apiKey) return `Token ${c.apiKey}`;
  throw new AppError(
    "AUTH_REQUIRED",
    "No Freesound credentials are configured.",
    "Run fsnd auth login or set FREESOUND_API_KEY.",
  );
}
export function validateRedirect(uri: string) {
  const u = new URL(uri);
  if (u.username || u.password || u.hash || u.search)
    throw new AppError(
      "INVALID_REDIRECT",
      "Callback URL must not contain credentials, query or fragment.",
    );
  if (
    !(u.protocol === "http:" && u.hostname === "127.0.0.1") &&
    !(u.protocol === "https:" && u.hostname === "freesound.org")
  )
    throw new AppError(
      "INVALID_REDIRECT",
      "Use an HTTP 127.0.0.1 callback or the HTTPS Freesound manual callback.",
    );
  return u;
}
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
export function callbackCode(url: URL, state: string): string {
  const actual = url.searchParams.get("state") || "";
  if (
    Buffer.byteLength(actual) !== Buffer.byteLength(state) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(state))
  )
    throw new AppError(
      "STATE_MISMATCH",
      "The callback does not belong to this login.",
    );
  if (url.searchParams.get("error"))
    throw new AppError("AUTH_DENIED", "Authorization was declined.");
  const code = url.searchParams.get("code");
  if (!code)
    throw new AppError("INVALID_CALLBACK", "Authorization code is missing.");
  return code;
}
export async function listenCallback(
  registered: URL,
  state: string,
  timeoutMs: number,
) {
  let resolveCode!: (code: string) => void, rejectCode!: (e: unknown) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Attach a handler immediately while the browser is being opened.
  void code.catch(() => {});
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const u = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "GET" || u.pathname !== registered.pathname) {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      const value = callbackCode(u, state);
      res.end("fsnd is authorized. You can close this tab.");
      resolveCode(value);
    } catch (e) {
      res.writeHead(400).end("This authorization callback was not accepted.");
      if (e instanceof AppError && e.code === "AUTH_DENIED") rejectCode(e);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(registered.port) || 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new AppError(
      "CALLBACK_FAILED",
      "Could not start the callback listener.",
    );
  const redirect = new URL(registered);
  redirect.port = String(address.port);
  const timer = setTimeout(
    () => rejectCode(new AppError("AUTH_TIMEOUT", "Authorization timed out.")),
    timeoutMs,
  );
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };
  return { redirect: redirect.toString(), code, close };
}
async function openBrowser(url: string) {
  const [program, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program as string, args as string[], {
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("open")),
    );
  });
}
export async function login(options: {
  manual?: boolean;
  open?: boolean;
  timeout: number;
}) {
  return locked("auth", async () => {
    const c = await config();
    if (!c.clientId)
      throw new AppError(
        "CLIENT_REQUIRED",
        "Configure your Freesound application client ID first.",
        "See fsnd auth configure --help.",
      );
    const registered = validateRedirect(c.redirectUri!);
    if (options.manual && !interactive())
      throw new AppError(
        "INTERACTIVE_REQUIRED",
        "Manual callback login needs an interactive terminal.",
      );
    if (!options.manual && registered.hostname !== "127.0.0.1")
      throw new AppError(
        "CALLBACK_CONFIG",
        "This application uses a manual callback.",
        "Use --manual, or register a separate application with http://127.0.0.1/callback.",
      );
    const proof = pkce();
    const listener = options.manual
      ? undefined
      : await listenCallback(registered, proof.state, options.timeout * 1000);
    const redirectUri = listener?.redirect || registered.toString();
    const url = new URL(`${API}/oauth2/authorize/`);
    for (const [k, v] of Object.entries({
      client_id: c.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state: proof.state,
      code_challenge: proof.challenge,
      code_challenge_method: "S256",
    }))
      url.searchParams.set(k, v);
    const abort = () => {
      listener?.close();
      process.exit(130);
    };
    process.once("SIGINT", abort);
    try {
      console.error(`Authorize fsnd in your browser:\n${url}\n`);
      let shouldOpen = options.open;
      if (shouldOpen === undefined && interactive()) {
        const answer = await confirm({
          message: "Open the authorization URL in your browser?",
          initialValue: true,
          output: process.stderr,
        });
        if (isCancel(answer))
          throw new AppError("CANCELLED", "Login cancelled.");
        shouldOpen = answer;
      }
      if (shouldOpen) {
        try {
          await openBrowser(url.toString());
        } catch {
          console.error(
            "Could not open the browser. Open the URL above manually.",
          );
        }
      }
      let code: string;
      if (options.manual) {
        const answer = await password({
          message: "Paste the full callback URL from the browser address bar",
          output: process.stderr,
        });
        if (isCancel(answer))
          throw new AppError("CANCELLED", "Login cancelled.");
        const callback = new URL(answer);
        if (
          callback.origin !== registered.origin ||
          callback.pathname !== registered.pathname
        )
          throw new AppError(
            "INVALID_CALLBACK",
            "Callback URL does not match this application.",
          );
        code = callbackCode(callback, proof.state);
      } else code = await listener!.code;
      const tokens = await exchange(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: proof.verifier,
        },
        c,
      );
      await privateJson(configPath(), c);
      await privateJson(tokenPath(), tokens);
      return status();
    } finally {
      process.removeListener("SIGINT", abort);
      listener?.close();
    }
  });
}
export async function logout() {
  return locked("auth", async () => {
    await rm(tokenPath(), { force: true });
    return {
      signedOut: true,
      scope: "local OAuth tokens",
      revokeUrl: "https://freesound.org/home/app_permissions/",
    };
  });
}
