import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  callbackCode,
  pkce,
  listenCallback,
  authorization,
  tokenPath,
  configPath,
} from "../src/auth.js";
import { apiURL, saveResponse, downloadResponse } from "../src/api.js";
import { privateJson } from "../src/core.js";

test("PKCE challenge is derived from verifier and callbacks bind state", () => {
  const p = pkce();
  assert.equal(
    p.challenge,
    createHash("sha256").update(p.verifier).digest("base64url"),
  );
  assert.equal(
    callbackCode(
      new URL(`http://127.0.0.1/callback?state=${p.state}&code=one`),
      p.state,
    ),
    "one",
  );
  assert.throws(
    () =>
      callbackCode(
        new URL("http://127.0.0.1/callback?state=wrong&code=one"),
        p.state,
      ),
    /does not belong/,
  );
});
test("real loopback callback rejects wrong state, then accepts correct callback", async () => {
  const listener = await listenCallback(
    new URL("http://127.0.0.1/callback"),
    "test-state",
    3000,
  );
  try {
    assert.equal(
      (await fetch(`${listener.redirect}?state=wrong&code=no`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${listener.redirect}?state=test-state&code=yes`)).status,
      200,
    );
    assert.equal(await listener.code, "yes");
  } finally {
    listener.close();
  }
});
test("API paths cannot exfiltrate credentials or retrieve OAuth tokens", () => {
  for (const path of [
    "https://example.com/",
    "../home/",
    "oauth2/access_token/",
    "sounds/?token=secret",
  ])
    assert.throws(() => apiURL(path));
  assert.equal(apiURL("sounds/123/").pathname, "/apiv2/sounds/123/");
});
test("download is exclusive, hashes exact bytes, and rejects JSON masquerading as audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fsnd-download-"));
  const dest = join(dir, "audio.wav");
  try {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await saveResponse(
      new Response(bytes, { headers: { "content-type": "audio/wav" } }),
      dest,
    );
    assert.equal(
      result.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    await assert.rejects(
      saveResponse(new Response(bytes), dest),
      /already exists/,
    );
    await assert.rejects(
      saveResponse(
        new Response("{}", { headers: { "content-type": "application/json" } }),
        join(dir, "bad.wav"),
      ),
    );
    assert.deepEqual(await readFile(dest), Buffer.from(bytes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CDN redirect drops Bearer header and external redirect is rejected", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; auth?: string }[] = [];
  try {
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.freesound.org/audio.wav" },
          })
        : new Response("audio");
    }) as typeof fetch;
    await downloadResponse(
      new URL("https://freesound.org/apiv2/sounds/1/download/"),
      "Bearer PRIVATE",
    );
    assert.equal(calls[0].auth, "Bearer PRIVATE");
    assert.equal(calls[1].auth, undefined);
    await assert.rejects(
      downloadResponse(new URL("https://evil.example/audio")),
      /outside/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("concurrent refreshes perform one exchange and save rotated token privately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fsnd-auth-"));
  const oldDir = process.env.FSND_CONFIG_DIR;
  const original = globalThis.fetch;
  process.env.FSND_CONFIG_DIR = dir;
  try {
    await privateJson(configPath(), { clientId: "test-client" });
    await privateJson(tokenPath(), {
      access_token: "expired",
      refresh_token: "old-refresh",
      expires_at: 1,
    });
    let requests = 0;
    globalThis.fetch = (async (_input, init) => {
      requests++;
      assert.equal(
        new URLSearchParams(String(init?.body)).has("client_secret"),
        false,
      );
      await new Promise((r) => setTimeout(r, 30));
      return Response.json({
        access_token: "new-token",
        refresh_token: "rotated",
        expires_in: 3600,
      });
    }) as typeof fetch;
    assert.deepEqual(
      await Promise.all([authorization("oauth"), authorization("oauth")]),
      ["Bearer new-token", "Bearer new-token"],
    );
    assert.equal(requests, 1);
    assert.equal((await stat(tokenPath())).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(tokenPath(), "utf8")).refresh_token,
      "rotated",
    );
  } finally {
    globalThis.fetch = original;
    if (oldDir === undefined) delete process.env.FSND_CONFIG_DIR;
    else process.env.FSND_CONFIG_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
test("noninteractive errors are one JSON value with nonzero status", () => {
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", "search", "rain", "--unknown"],
      { encoding: "utf8" },
    );
    assert.fail("must fail");
  } catch (error) {
    const e = error as { stdout: string; status: number };
    const result = JSON.parse(e.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_ARGUMENT");
    assert.equal(e.status, 1);
    assert.ok(!e.stdout.includes("\u001b"));
  }
});
