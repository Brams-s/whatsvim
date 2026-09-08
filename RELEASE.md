# Release process

## Versioning

`package.json.version` is the sole source of truth. It must be `x.y.z` or
`x.y.z-alpha.N`, with numeric components 0 through 65535. This is not a claim
that Chrome's manifest version is Semantic Versioning: Chrome compares numeric
manifest components. `npm run version:sync` derives `manifest.version` as the
numeric `x.y.z` core and `manifest.version_name` as the exact package version;
the runtime reads that manifest metadata rather than a source literal. The
checked-in root lockfile's `version` and `packages[""]` version must exactly
match `package.json.version`.

Every Chrome Web Store upload needs a strictly higher numeric
`manifest.version` than the last store upload. Check with `npm run
version:check`; do not hand-edit generated manifest version fields after a
Changesets version operation. `0.0.0` (including `0.0.0-alpha.N`) is rejected
as Chrome-invalid.

## Stable release and prereleases

The current release is stable `0.4.0`. A prerelease, if intentionally created,
uses `-alpha.N` in the package version, `manifest.version_name`, ZIP filename,
and GitHub Release prerelease flag; its `manifest.version` remains
numeric-only. Alpha ZIPs are for review/testing and **must never be uploaded to
the Chrome Web Store**. Any later CWS candidate needs a strictly higher numeric
manifest version and passing automated and manual checks.

`0.4.0` is the first stable, unpublished release. The prior alpha pre-mode
bookkeeping and consumed alpha changeset were deliberately retired without
running `changeset pre exit`, so future changesets begin in normal mode and
cannot reapply that prior release material.

## Package and validation

1. Review the canonical TypeScript runtime sources and update docs/privacy disclosures.
2. Run `npm run typecheck`, `npm run version:check`, `npm test`, `npm run package`, and `npm run
   verify:package`.
3. Confirm a repeated `npm run package` produces the same ZIP checksum. The
   verifier checks ZIP local and central headers, payload CRCs, and byte equality
   with the freshly built allowlisted working-tree files; do not verify a stale ZIP.
4. Run `npm ci && npm run build`, load the generated root directory unpacked,
   and complete the manual real
   WhatsApp Web validation in [DEVELOPMENT.md](DEVELOPMENT.md).
5. Inspect the ZIP listing: it must contain `manifest.json`, `LICENSE`,
   `content.css`, `keymap.js`, `content.js`, and the four manifest-referenced
   PNGs under `icons/`, with `manifest.json` and `LICENSE` at the ZIP root (no
   enclosing directory).
6. Confirm the live Pages privacy and public Issues URLs below remain available
   before using them in a store dashboard.
7. For a stable, CWS-eligible version only, upload that ZIP as a dashboard
   **draft**. The Chrome Web Store dashboard's upload/validation outcome is the
   final authoritative packaging validation; resolve its findings before any
   publication decision.
8. Record the version, validation browser/version, date, package checksum, and
   dashboard validation result in the release notes maintained by the release
   owner.

## Pages and Issues gate

GitHub Pages and the repository's public Issues were enabled and anonymously
verified on 2026-09-08. Before entering the privacy URL in a dashboard, confirm
<https://brams-s.github.io/whatsvim/> remains publicly available without a
logged-in GitHub session or JavaScript dependence, and confirm the privacy and
support links and policy text remain correct. No workflow in this repository
uploads to the Chrome Web Store or publishes a store listing.

## Chrome Web Store checklist

Before submission, complete the current official guidance:

- [Prepare](https://developer.chrome.com/docs/webstore/prepare/),
  [publish](https://developer.chrome.com/docs/webstore/publish/), and create a
  draft upload before review.
- [Store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/):
  provide the required 128×128 icon and at least one truthful screenshot; add
  promotional images only when they meet the dashboard's current format and
  dimension rules.
- [Privacy / User Data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data/)
  and [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/user-data/#limited-use):
  make accurate disclosures and retain only the data necessary for the stated
  single purpose. The current extension transiently handles visible interface
  content and command input locally, without extension transmission or persistence.

The listing must accurately state the extension's single purpose, permissions,
support contact, and privacy practices. All executable code must ship in the
reviewed ZIP: do not use remotely hosted code or runtime-downloaded executable
logic. Store assets must represent the shipped extension. Follow
[`store-assets/README.md`](store-assets/README.md) and its metadata template;
there are intentionally no placeholder images.

The prior local v0.3.3 runtime is first-party work by Brams and this repository
is MIT licensed; see [ATTRIBUTION.md](ATTRIBUTION.md) and [LICENSE](LICENSE).
This does not establish rights for any future third-party contribution, which
must have documented provenance before release.

## Changesets and GitHub automation

Until the first `0.4.0` tag and publication, candidate-preparation changes may
remain part of the still-unpublished `0.4.0`; `changeset status` therefore
reports that no changesets exist. After that first release, create a changeset
for each user-facing release change, then run `npm run version:changesets`.
The repository's Changesets config versions private
packages, never commits, and never tags or publishes. Its wrapper synchronizes
the manifest first and then only the root lockfile version fields. The
immutable Changesets action workflow is version-PR-only: it uses
`version-script`, has no publish command, and has no npm publishing token. Use
`npx changeset status` to inspect future normal-mode changesets before versioning.

The manual **Promote approved release** workflow accepts only a full 40-hex
approved commit SHA. A read-only validation job checks that SHA is an ancestor
of `origin/main` before the write-capable release job checks out or runs its
candidate code. The release job uses only that verified SHA, disables persisted
checkout credentials, rejects an existing `v<package-version>` tag before
scripts run, then rebuilds/verifies and creates a GitHub Release with ZIP and
checksum. It detects prerelease status from the package version and has no
Chrome Web Store action.

Before any remote release action, manually review the Chrome Web Store account
owner/trader status, version history, two-step verification, dashboard draft,
and whether publication is deferred or immediate. These are external account
decisions; neither the workflow nor this repository uploads to the Chrome Web
Store.

The GitHub `release` environment now exists with required reviewer approval, and
the `promote` job declares that environment. An approved GitHub remote, verified
branch protection for `main`, and Actions permission settings remain
prerequisites before enabling publication. This repository does not create or
change those remote settings.

## Firefox path (deferred)

Firefox distribution is not part of this release. A future Firefox lane must:

1. verify the MV3 manifest and APIs against the target Firefox release;
2. load a temporary unsigned build for WhatsApp Web testing, then run
   `web-ext lint` and `web-ext build`;
3. test the CSS `:has()` use on Firefox 121 or later, or add and test a
   selector fallback for earlier support;
4. complete AMO listing requirements and submit the artifact for AMO signing;
5. maintain Firefox-specific smoke/manual validation and release notes.

Do not represent the current Chromium ZIP as Firefox-ready or signed.
