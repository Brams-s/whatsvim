# Development

## Prerequisites

- Node.js 22 or later and npm; use `npm ci` for the checked-in lockfile.
- Chromium or Chrome for manual and CDP smoke tests.
- A separate test browser profile/page for the browser smoke test.

## Commands

```sh
npm run version:check       # read-only package/manifest/root-lockfile check
npm test                    # configuration, keymap, policy, version, and ZIP checks
npm run package             # synchronized deterministic ZIP in dist/
npm run verify:package      # inspect manifest and generated ZIP contents
npm run test:browser        # CDP fixture smoke test; browser setup required
```

`npm run package` refuses a version mismatch. The allowlist is the four runtime
files and the four manifest-referenced PNG icons only, so tests, docs, scripts,
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

Load this directory unpacked in a Chromium instance started with remote
debugging and a dedicated profile, for example from the project root:

```sh
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/whatsvim-cdp --load-extension="$PWD"
```

Open `https://web.whatsapp.com/` in that instance, then run:

```sh
CDP_ENDPOINT=http://127.0.0.1:9222 npm run test:browser
```

The smoke script expects the extension sentinel, temporarily stops page
loading, removes `#app`, and injects a test fixture. Run it only in a dedicated
test tab/window, never in a working WhatsApp session. It requires a Node
runtime that provides `fetch` and `WebSocket` globals (Node 22+).

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
WhatsApp session. The existing `npm run test:browser` CDP fixture test remains
separate and still requires the explicit port-9222 setup above.

After locally configuring optional tools, restart OpenCode so it discovers the
skills and MCP server; do not restart it as part of an automated test.

## Manual browser checks

After loading unpacked, validate on real WhatsApp Web: chat switching, message
selection, composing and escape return, reply/edit availability, reactions
including full picker search, media navigation/close, search popup, help, and
keyboard behavior in normal editable fields. Test a short and a long/virtualized
chat, and both narrow and wide browser widths.

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
