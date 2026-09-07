# Development

Stack: TypeScript, citty, native fetch, tsup, Clack and picocolors. Node.js 22+ is the runtime baseline; Bun is a compatibility target. Keep dependencies small; HTML parsing and scraping are unnecessary for the supported official API.

`src/command.ts` owns argument/help dispatch, `core.ts` owns output/errors/storage primitives, `auth.ts` owns authentication, `api.ts` owns API/download behavior, and `index.ts` wires commands. JSON data stays on stdout; progress and login instructions use stderr.

Run `npm run check` for strict TypeScript checks, offline tests and build. Test a package with `npm pack` and `npm exec --package ./fsnd-0.1.0.tgz -- fsnd --help`. Tests must never need live credentials. Keep real media, token caches and dotenv files outside the repository.

Release: verify tests, Node/Bun package entrypoints and the tarball contents; then publish deliberately using npm credentials or configured trusted publishing. GitHub repository visibility is public. A GitHub push is not an npm release. Authentication service limitations are documented rather than hidden.
