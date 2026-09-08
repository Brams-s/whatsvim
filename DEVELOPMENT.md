# Development

## Prerequisites

- Node.js `^22.11 || ^24 || >=26` and npm `>=10.9`; use `npm ci` for the checked-in lockfile.
- Chromium on `PATH` for the disposable browser smoke test.

## Commands

```sh
npm run version:check       # read-only package/manifest/root-lockfile check
npm run build               # emit root keymap.js and content.js from TypeScript
npm run typecheck           # strict TypeScript check without emitting files
npm test                    # builds, then runs configuration, runtime, policy, version, and ZIP checks
npm run package             # builds and writes a synchronized deterministic ZIP in dist/
npm run verify:package      # validate ZIP headers, payload CRCs, and working-tree bytes
npm run test:browser        # launches and removes a dedicated fixture Chromium profile
```

`content.ts` and `keymap.ts` are the source of truth. Root `keymap.js` and
`content.js` are ignored build artifacts because the manifest, unpacked loading,
and ZIP retain those historical paths. Before loading this directory unpacked,
run `npm ci && npm run build`. `npm run package` builds first and refuses a
version mismatch. The allowlist is the manifest, license, three runtime files,
and the four manifest-referenced PNG icons only, so tests, docs, scripts,
`node_modules`, and `.git` cannot enter the archive.

## Version and Changesets workflow

`package.json.version` is canonical and is accepted only as `x.y.z` or
`x.y.z-alpha.N`, with numeric components from 0 through 65535. The current
release is stable `0.4.0`. Run
`npm run version:check` before tests or packaging; it writes nothing and checks
the manifest plus both root version fields in `package-lock.json`. Run `npm run
version:sync` only after an intentional package-version update; it sets
`manifest.version` to the numeric `x.y.z` core, `manifest.version_name` to the
exact package version, then updates only `package-lock.json.version` and
`package-lock.json.packages[""].version` without resolving dependencies.

Create a release note with `npx changeset`, then apply it with:

```sh
npm run version:changesets
```

That supported Changesets wrapper versions `package.json`, synchronizes the
manifest, then synchronizes the checked-in root lockfile version fields. If a
future alpha is used, its identity appears in `package.json.version`,
`manifest.version_name`, the ZIP filename, and the GitHub prerelease flag;
`manifest.version` remains numeric-only. Do not upload alpha artifacts to the
Chrome Web Store.

## Browser smoke prerequisites

`npm run test:browser` creates a temporary Chromium profile, starts a dedicated
debugging endpoint, opens a token-designated WhatsApp fixture target, and removes
only that owned browser/profile after the test. The harness refuses an
undesignated target, a non-WhatsApp origin, or a manually supplied default CDP
endpoint before it reloads or mutates anything. It stops fixture loading,
removes `#app`, and injects test DOM only in that disposable target. It requires
a runtime in the supported Node range above that provides `fetch` and `WebSocket` globals.

## Optional local agent tooling

If using OpenCode locally, you may install project guidance skills under
`.agents/skills/` and add an `opencode.json` configuration for a local
`chrome-devtools` MCP server. These machine-local files are optional setup, are
not required to develop or test the extension, and are intentionally excluded
from the repository.

The extension MCP tools run through an MCP-launched stdio/pipe session. They do
not auto-connect to an existing Chrome: `--autoConnect` is intentionally absent
because current Chrome does not support it with extension tools. Use a dedicated
test browser/profile and approve any Chrome DevTools permission prompts only
after confirming the target tab/profile; do not grant access to a working
WhatsApp session. The existing `npm run test:browser` fixture test remains
separate and creates its own dedicated debugging endpoint.

After locally configuring optional tools, restart OpenCode so it discovers the
skills and MCP server; do not restart it as part of an automated test.

## Manual browser checks

After loading unpacked, validate on real WhatsApp Web: chat switching, message
selection, composing and escape return, reply/edit availability, reactions
including full picker search, media navigation/close, search popup, help, and
keyboard behavior in normal editable fields. Verify `Space` on a real collapsed
Read more message. Test a short and a long/virtualized chat, and both narrow and
wide browser widths.

## Store-release preflight

The local ZIP is a preflight artifact, not final store validation. Keep all
executable code in the ZIP; do not add remotely hosted code, remote scripts, or
runtime-downloaded executable logic. Upload the ZIP as a draft in the Chrome
Web Store dashboard and treat that dashboard's upload and validation result as
the authoritative packaging check before publishing. See
[RELEASE.md](RELEASE.md) for the release sequence and asset requirements.

## Automation prerequisites

The checked-in GitHub workflows are source files only; this task did not run
them. Before enabling automation, configure an approved upstream GitHub remote,
`main` as the intended base branch, and Actions with the documented permissions.
The promotion workflow accepts only a full 40-hex commit SHA that its read-only
validation job proves is an ancestor of `origin/main`; it never runs an
arbitrary input ref with a write token. Do not create a remote or publish as
part of local release preparation.
