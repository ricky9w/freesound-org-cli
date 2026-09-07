# Development

Stack: TypeScript, citty, native fetch, tsup, Clack and picocolors. Node.js 22+ is the runtime baseline; Bun is a compatibility target. Keep dependencies small; HTML parsing and scraping are unnecessary for the supported official API.

`src/command.ts` owns argument/help dispatch, `core.ts` owns output/errors/storage primitives, `auth.ts` owns authentication, `api.ts` owns API/download behavior, and `index.ts` wires commands. JSON data stays on stdout; progress and login instructions use stderr.

Run `npm run check` for strict TypeScript checks, offline tests and build. Test a package with `npm pack` and `npm exec --package ./ricky9w-fsnd-0.1.0.tgz -- fsnd --help`. Tests must never need live credentials. Keep real media, token caches and dotenv files outside the repository.

## Publishing

The public npm package is `@ricky9w/fsnd`. `.github/workflows/publish.yml` publishes when a `v*` tag is pushed. Normal branch pushes only run CI. The tag must equal `v` plus the package version; all checks and packaged Node/Bun smoke checks must pass before publication.

One-time setup after the initial package exists:

```sh
npm trust github @ricky9w/fsnd --repo ricky9w/freesound-org-cli --file publish.yml --allow-publish --yes
```

npm requires account 2FA for this setup. GitHub-hosted releases then authenticate through OIDC (`id-token: write`), with no npm write token stored in GitHub. `--provenance` binds the public package to its source commit and workflow. npm 12.0.2 is pinned in the release workflow.

For a release, update the version and lockfile, commit and push to `main`, wait for CI, then push the matching tag:

```sh
npm version patch --no-git-tag-version
# Review and commit package.json, package-lock.json and release changes.
git tag vX.Y.Z
git push origin vX.Y.Z
```

Inspect the Publish run and `npm view @ricky9w/fsnd@X.Y.Z dist.attestations --json`; install from the registry and run `npm audit signatures` to verify attestations. Published versions are immutable. If a run fails, inspect whether the registry already contains the version before retrying.

The first 0.1.0 publication bootstraps package ownership locally; 0.1.1 is the first planned OIDC/provenance release. Freesound service limitations are documented separately from package-release verification.
