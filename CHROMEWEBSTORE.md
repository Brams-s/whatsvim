# Chrome Web Store listing material

**Last Updated:** 2026-09-06

## Proposed listing copy

**Name:** WhatsVim

**Short description:** Unofficial Vim-style keyboard navigation for WhatsApp Web.

**Detailed description:** WhatsVim is an unofficial Vim-style keyboard workflow
for WhatsApp Web. Use `h` and `l` to select the chat list or message pane, and
`j` and `k` to move through the active pane. Commands can open WhatsApp reply,
reaction, edit, search, and media controls where WhatsApp exposes them. It is
designed for people who prefer keyboard navigation while using WhatsApp Web.

WhatsVim is unofficial and is not affiliated with, endorsed by, or sponsored
by WhatsApp or Meta.

## Current unpublished 0.4.0 preparation

Insert mode now adds a subtle border around the active chat composer. Escape
returns to the selected message after cancelling a reply, and rapid chat
navigation avoids stale commands reclaiming a newer context.

## Single purpose, site access, and privacy disclosure

**Single purpose:** provide Vim-style keyboard navigation and editing-mode
assistance on WhatsApp Web.

**Why site access is needed:** the content-script match grants the extension
access to `https://web.whatsapp.com/*` so it can receive keyboard events and
interact with the visible WhatsApp Web interface. It cannot run on other sites.
The manifest declares no API `permissions`, no `host_permissions` field, and no
background worker.

**Privacy disclosure:** WhatsVim transiently handles keyboard commands and the
visible page interface in browser memory for core functionality. It does not
send that information to the developer or third parties, persist it in extension
storage or files, share or sell it, or use it for analytics, advertising, or
profiling. It has no extension-initiated network requests, storage, background
worker, remote configuration, or remotely hosted code. WhatsApp Web traffic is
outside the extension. See [PRIVACY.md](PRIVACY.md) for the full statement.

**Dashboard disclosure gate:** review the live dashboard definitions and
conservatively select applicable categories for personal communications, website
content/resources, and user activity or command input. Select PII/contact-label
categories too if the offered definitions cover visible labels. State that use is
for core functionality only, with no sale, ads, transmission, or persistence.

**Planned policy and support URLs:** use
<https://brams-s.github.io/whatsvim/> only after GitHub Pages is enabled and the
page is anonymously checked without login or JavaScript. Support is planned at
<https://github.com/Brams-s/whatsvim/issues>. The repository privacy-policy link
is public; external Pages and dashboard status are not established here.

## Submission checklist

- [ ] Confirm the final package version and that its numeric `manifest.version`
  is higher than every prior Chrome Web Store upload.
- [ ] Run `npm run typecheck`, `npm run version:check`, `npm test`, `npm run
  test:browser`, `npm run package`, and `npm run verify:package`; complete
  manual real-WhatsApp smoke testing.
- [ ] Create a Chrome Web Store dashboard item and enter the listing copy above.
- [ ] Enable and anonymously verify the planned privacy URL before entering it
  in the dashboard; do not present it as live before then.
- [ ] Supply the public Issues support URL and warn users not to post sensitive data.
- [ ] Upload the included 128×128 extension icon.
- [ ] Review and upload the corrected, dimension-verified 440x280 promotional tile:
  `store-assets/whatsvim-small-promo-440x280.png`.
- [ ] Capture 1–5 truthful screenshots at 1280x800 preferred or 640x400 using a
  safe dedicated or synthetic account. Exclude private chats, contact details,
  QR codes, authentication prompts, and other sensitive information.
- [ ] Upload the reviewed ZIP as a dashboard draft and resolve all dashboard
  validation findings before publication.

## Status

**Not submitted by this repository.** Account, dashboard, listing, and external
publication status are unknown here. This document is preparation material only
and does not authorize publication.
