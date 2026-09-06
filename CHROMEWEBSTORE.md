# Chrome Web Store listing material

**Last Updated:** 2026-09-06

## Proposed listing copy

**Name:** WhatsVim

**Short description:** Vim-style keyboard navigation for WhatsApp Web.

**Detailed description:** WhatsVim adds a focused Vim-style keyboard workflow
to WhatsApp Web. Use `h` and `l` to select the chat list or message pane, `j`
and `k` to move through the active pane, and message commands to reply, react,
edit, or open media. It is designed for people who prefer keyboard navigation
while using WhatsApp Web.

WhatsVim is unofficial and is not affiliated with, endorsed by, or sponsored
by WhatsApp or Meta.

## Current unpublished 0.4.0 update

Insert mode now adds a subtle border around the active chat composer. Escape
also returns to the selected message after cancelling a reply.

## Single purpose, site access, and privacy disclosure

**Single purpose:** provide Vim-style keyboard navigation and editing-mode
assistance on WhatsApp Web.

**Why site access is needed:** the extension runs a local content script only
at `https://web.whatsapp.com/*` so it can receive keyboard events and interact
with the visible WhatsApp Web interface. It cannot run on other sites. The
manifest declares no `permissions`, `host_permissions`, or background worker.

**Privacy disclosure:** WhatsVim processes keyboard events and the visible page
DOM locally to provide navigation. It does not collect, store, transmit, sell,
or share message content, contacts, search terms, keystrokes, or usage data. It
has no analytics, telemetry, remote configuration, external network requests,
or remotely hosted code. See [PRIVACY.md](PRIVACY.md) for the repository's full
data-handling statement.

## Submission checklist

- [ ] Confirm the final package version and that its numeric `manifest.version`
  is higher than every prior Chrome Web Store upload.
- [ ] Run `npm run version:check`, `npm test`, `npm run package`, and `npm run
  verify:package`; complete manual real-WhatsApp smoke testing.
- [ ] Create a Chrome Web Store dashboard item and enter the listing copy above.
- [ ] Supply a real support URL or contact. **User action required:** no support
  URL or contact is defined by this repository.
- [ ] Enter the privacy disclosure accurately. **User action required:** no live
  privacy-policy URL is defined by this repository; do not invent one.
- [ ] Upload the included 128×128 extension icon.
- [ ] Review and upload the existing truthful 440×280 promotional tile:
  `store-assets/whatsvim-small-promo-440x280.png`.
- [ ] Capture and upload at least one truthful screenshot of the shipped
  extension. **Pending:** no screenshots are provided here; capture the new
  Insert-mode composer border in the shipped extension.
- [ ] Upload the reviewed ZIP as a dashboard draft and resolve all dashboard
  validation findings before publication.

## Status

**Not submitted.** No Chrome Web Store developer account, dashboard item, or
listing has been created for this project. This document is preparation material
only and does not authorize publication.
