# WhatsVim

A minimal Manifest V3 Chromium content extension for Vim-style navigation on
`https://web.whatsapp.com/*`. It has no background worker, build step, or
runtime dependency.

WhatsVim is unofficial and is not affiliated with, endorsed by, or sponsored
by WhatsApp or Meta.

## Install: load unpacked

1. Open `chrome://extensions` (or `chromium://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project directory.
4. Open or reload WhatsApp Web.

### Vimium compatibility

Vimium uses the same `h`, `j`, `k`, and `l` keys. In **Vimium Options** under
**Excluded URLs and keys**, add a rule with the pattern
`https://web.whatsapp.com/*` and leave **Keys to exclude** empty. This disables
Vimium on WhatsApp Web so WhatsVim can handle its navigation keys. Save the
rule, then reload WhatsApp Web.

The extension only runs on WhatsApp Web. Its on-page status indicator reports
`NORMAL` or `INSERT`; a selected message is a contextual command state while
the visible indicator remains Normal.

## Keymap

| Context | Keys | Action |
| --- | --- | --- |
| Normal | `h` / `l` | Select the chat list / message pane |
| Normal | `j` / `k` | Next / previous item in the active pane |
| Normal | `Shift+J` / `Shift+K` | Next / previous chat, regardless of active pane |
| Normal | `gg` / `G` | First / last chat |
| Normal | `Enter`, `i`, `a`, `o` | Focus the composer (Insert mode) |
| Normal | `I` | Jump to newest message, then focus composer |
| Normal | `/` / `?` | WhatsApp search / shortcut help |
| Selected message | `r`; `Shift+R`; `e` | Reply; react; edit |
| Selected message | `l` / `o` | Open selected media; `l` selects the message pane when no media is openable |
| Selected message | `Space` | Experimental: expand the selected message’s Read more control |
| Selected message | `h` | Select the chat list |
| Selected message | `i`, `a`, `Enter` | Focus composer; `Esc` returns to selection |
| Reaction picker | `h` / `j` / `k` / `l`, `Enter` / `Space` | Move / choose emoji |
| Full emoji picker | `Esc` / `/` | Enter grid / return to emoji search |
| Media viewer | `h` / `l` / `Esc` | Previous / next / close viewer |
| Insert | `Esc` or `Ctrl+[` | Leave Insert, cancel reply/edit, or close popup |

`Ctrl+V` in Normal mode focuses the composer first so Chromium can perform the
paste there. Clicking or focusing an editable element enters Insert mode.

## Compatibility

Target browser: Chromium-family browsers with Manifest V3 support. Target site:
the current WhatsApp Web UI. WhatsApp changes DOM structure frequently, so
chat, message, menu, reaction, and media commands may need updates after a UI
rollout. See [ARCHITECTURE.md](ARCHITECTURE.md) for the selector and fallback
strategy. Firefox packaging is deliberately deferred; see
[RELEASE.md](RELEASE.md).

## Known limitations

- Read more expansion currently fails in live WhatsApp Web. Investigation is
  deferred; fixture coverage does not establish live-site support.

## Development

Use Node 22 or later. Runtime packaging remains dependency-free; the checked-in
development dependency supports Changesets only:

```sh
npm ci
npm run version:check
npm test
npm run package
npm run verify:package
```

`package.json.version` is the source of truth. The version tool derives the
numeric `manifest.version`, exact `manifest.version_name`, and deterministic
artifact name. The ZIP is written as
`dist/whatsvim-<package-version>.zip` and contains the four runtime files plus
the manifest-referenced PNG icons. It exposes `manifest.json` at its archive
root (not in an enclosing project folder). See [DEVELOPMENT.md](DEVELOPMENT.md)
for commands, Changesets, and browser smoke testing.

## Project documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — DOM, accessibility, and churn approach
- [PRIVACY.md](PRIVACY.md) — data handling and permissions
- [DEVELOPMENT.md](DEVELOPMENT.md) — commands and test prerequisites
- [RELEASE.md](RELEASE.md) — release and store checklist
- [ATTRIBUTION.md](ATTRIBUTION.md) — local-source migration record
