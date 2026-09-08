# Privacy

## Data handling and single purpose

WhatsVim transiently handles keyboard command input and the visible WhatsApp Web
interface in browser memory to provide its single purpose: Vim-style keyboard
navigation and editing-mode assistance. This can include visible chat labels,
message rows, controls for reply, reaction, edit, media, or Read more, and the
composer when a command needs them.

Keyboard command input is handled transiently for the current action. Limited
navigation state—selected DOM elements, a message identity or key, and return
focus or scroll state—may remain in page or content-script memory between
commands until replaced or cleared, or until the page unloads or the extension
context is destroyed. This state supports navigation targets and position; it
is not a separately stored archive of raw message content.

WhatsVim does not send this information to the developer or third parties; save
it in extension storage or files; share or sell it; or use it for analytics,
advertising, profiling, or unrelated purposes. It does not record usage or
diagnostics.

The extension has no background worker, extension-initiated network requests,
analytics, remote configuration, storage API use, or remotely hosted runtime
code. WhatsApp Web makes its own network requests for messaging and account
features; that traffic is outside WhatsVim's behavior.

## Limited Use

WhatsVim does not use Google APIs or receive Google user data. Information it
transiently handles on WhatsApp Web is used only for the user-facing keyboard
function described above, not for advertising, profiling, credit, lending, or
any unrelated purpose.

WhatsVim is an unofficial extension and is not affiliated with, endorsed by,
or sponsored by WhatsApp or Meta.

## Permissions and site access

The manifest requests no `permissions` or `host_permissions`. Its content-script
match grants the extension site access only at:

`https://web.whatsapp.com/*`

That match is necessary to inject the local keyboard handler and styles into
WhatsApp Web. The extension cannot run on other sites under the current manifest.

## Support

For help, bugs, or privacy questions, use the public issue tracker:
<https://github.com/Brams-s/whatsvim/issues>. Do not include private messages,
contact details, screenshots of personal chats, or other sensitive information
in a public issue.

If the implementation or manifest gains data handling, storage, telemetry,
network access, or additional site matches, update this document and the store
disclosures before release.
