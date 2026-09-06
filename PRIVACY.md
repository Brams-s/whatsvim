# Privacy

## Data handling

WhatsVim processes keyboard events and the visible WhatsApp Web
DOM locally in the browser to provide navigation. It does not send, collect,
store, transmit, sell, or share message content, contacts, search terms,
keystrokes, or usage data.

The extension has no background worker, external network requests, analytics,
remote configuration, or storage API use. It does not execute remotely hosted
code.

WhatsVim is an unofficial extension and is not affiliated with, endorsed by,
or sponsored by WhatsApp or Meta.

## Permissions and site access

The manifest requests no `permissions` or `host_permissions`. Its only site
access is the content-script match:

`https://web.whatsapp.com/*`

That match is necessary to inject the local keyboard handler and styles into
WhatsApp Web. The extension cannot run on other sites under the current
manifest.

If the implementation or manifest gains data handling, storage, telemetry,
network access, or additional site matches, update this document and the store
disclosures before release.
