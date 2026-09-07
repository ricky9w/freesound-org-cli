#!/usr/bin/env node
import { defineCommand } from "citty";
import packageInfo from "../package.json";
import { execute } from "./command.js";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { AppError, output, fail, progress, positive } from "./core.js";
import * as auth from "./auth.js";
import { api, search, download } from "./api.js";

const common = {
  json: {
    type: "boolean",
    description: "Emit one JSON envelope; never prompt",
  },
  human: { type: "boolean", description: "Readable output even when piped" },
  "env-file": {
    type: "string",
    description: "Explicit dotenv file; existing environment variables win",
  },
  auth: {
    type: "string",
    default: "auto",
    description: "auto (OAuth first), oauth, or key",
  },
} as const;
const idArg = {
  type: "positional",
  required: true,
  description: "Freesound sound ID",
} as const;
export const main = defineCommand({
  meta: {
    name: "fsnd",
    version: packageInfo.version,
    description:
      "Search and download Freesound audio. OAuth login, clean JSON, source metadata.",
  },
  args: common,
  subCommands: {
    search: defineCommand({
      meta: {
        description:
          "Find sounds; use --filter for duration, tags and other Freesound filters",
      },
      args: {
        ...common,
        query: { type: "positional", required: true },
        filter: { type: "string" },
        sort: { type: "string" },
        fields: { type: "string" },
        page: { type: "string", default: "1" },
        limit: {
          type: "string",
          default: "10",
          description: "Results per page (1–150)",
        },
        pages: {
          type: "string",
          default: "1",
          description: "Bounded pages to fetch (1–100)",
        },
      },
      async run({ args }) {
        output(
          await progress("Searching Freesound", () =>
            search(args.query, {
              mode: args.auth,
              filter: args.filter,
              sort: args.sort,
              fields: args.fields,
              page: positive(args.page, "page"),
              pageSize: positive(args.limit, "limit", 150),
              pages: positive(args.pages, "pages", 100),
            }),
          ),
        );
      },
    }),
    details: defineCommand({
      meta: { description: "Read one sound’s metadata" },
      args: { ...common, id: idArg },
      async run({ args }) {
        output(await api(`sounds/${positive(args.id, "id")}/`, args.auth));
      },
    }),
    download: defineCommand({
      meta: {
        description:
          "Save original audio (OAuth) or --preview; never overwrite; save metadata beside audio",
      },
      args: {
        ...common,
        id: idArg,
        output: {
          type: "string",
          required: true,
          alias: "o",
          description: "Destination filename",
        },
        preview: { type: "boolean", default: false },
      },
      async run({ args }) {
        output(
          await progress("Downloading audio", () =>
            download(
              positive(args.id, "id"),
              args.output,
              args.preview,
              args.auth,
            ),
          ),
        );
      },
    }),
    me: defineCommand({
      meta: { description: "Read the current OAuth account" },
      args: common,
      async run({ args }) {
        output(await api("me/", args.auth, {}, true));
      },
    }),
    api: defineCommand({
      meta: {
        description:
          "Read an additional API resource; GET only, relative path with optional query",
      },
      args: { ...common, path: { type: "positional", required: true } },
      async run({ args }) {
        output(await api(args.path, args.auth));
      },
    }),
    doctor: defineCommand({
      meta: {
        description:
          "Check configuration; --online checks auth using read-only requests",
      },
      args: { ...common, online: { type: "boolean" } },
      async run({ args }) {
        const state = await auth.status();
        if (!args.online) {
          output(state);
          return;
        }
        const header = await auth.authorization(args.auth);
        const oauth = header.startsWith("Bearer ");
        await api(
          oauth ? "me/" : "search/text/?query=rain&page_size=1",
          args.auth,
        );
        output({
          ...state,
          online: {
            authenticated: true,
            mode: oauth ? "oauth" : "key",
            checks: [oauth ? "me" : "search"],
          },
        });
      },
    }),
    auth: defineCommand({
      meta: {
        description:
          "Configure an application, sign in, or inspect local credentials",
      },
      subCommands: {
        configure: defineCommand({
          meta: {
            description:
              "Save application settings. Register at https://freesound.org/apiv2/apply/; callback http://127.0.0.1/callback for automatic login",
          },
          args: {
            ...common,
            "client-id": { type: "string" },
            "redirect-uri": { type: "string" },
          },
          async run({ args }) {
            output(
              await auth.configure(args["client-id"], args["redirect-uri"]),
            );
          },
        }),
        login: defineCommand({
          meta: {
            description:
              "Authorize in a browser with PKCE and automatic loopback callback; --manual for Freesound-hosted callbacks",
          },
          args: {
            ...common,
            manual: { type: "boolean" },
            open: {
              type: "boolean",
              description:
                "Open browser immediately; --no-open only displays URL",
            },
            timeout: {
              type: "string",
              default: "180",
              description: "Callback timeout in seconds (1–600)",
            },
          },
          async run({ args }) {
            output(
              await auth.login({
                manual: args.manual,
                open: args.open,
                timeout: positive(args.timeout, "timeout", 600),
              }),
            );
          },
        }),
        status: defineCommand({
          meta: {
            description:
              "Show credential presence and expiry without revealing secrets",
          },
          args: common,
          async run() {
            output(await auth.status());
          },
        }),
        import: defineCommand({
          meta: {
            description:
              "Import existing OAuth JSON with access_token and expires_at; requires client ID via configuration or --env-file",
          },
          args: { ...common, "token-file": { type: "string", required: true } },
          async run({ args }) {
            output(await auth.importTokens(args["token-file"]));
          },
        }),
        logout: defineCommand({
          meta: {
            description:
              "Remove local OAuth tokens; API key config and server authorization remain",
          },
          args: common,
          async run() {
            output(await auth.logout());
          },
        }),
      },
    }),
  },
});

async function start() {
  const raw = process.argv.slice(2);
  const fileFlag = raw.findIndex(
    (x) => x === "--env-file" || x.startsWith("--env-file="),
  );
  if (fileFlag >= 0) {
    const file = raw[fileFlag].includes("=")
      ? raw[fileFlag].slice(11)
      : raw[fileFlag + 1];
    if (!file)
      throw new AppError("INVALID_ARGUMENT", "--env-file needs a filename.");
    const values = parse(await readFile(file));
    for (const [key, value] of Object.entries(values))
      if (process.env[key] === undefined) process.env[key] = value;
  }
  if (raw.includes("--version") || raw.includes("-v")) {
    console.log(packageInfo.version);
    return;
  }
  await execute(main, raw, "fsnd");
}
start().catch(fail);
