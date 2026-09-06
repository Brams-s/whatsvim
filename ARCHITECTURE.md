# Architecture

## Runtime shape

`manifest.json` registers one document-start content-script bundle, in this
order: `keymap.js`, then `content.js`, with `content.css`. There is no service
worker, popup, network client, storage use, or build output required for the
extension to run.

`keymap.js` is deliberately small and pure: it resolves a trusted keyboard
event plus state into an action. `content.js` owns mode, focus, DOM discovery,
WhatsApp interaction, and the small injected UI. `content.css` contains only
the extension's focus, status, help, and narrow-layout rules.

Release metadata is read at runtime from `chrome.runtime.getManifest()`:
`version_name` is preferred so an alpha label is exposed exactly, with numeric
`version` as fallback. `package.json.version` is canonical; the version-sync
tool derives the two manifest fields before packaging.

## Selector and UI-churn strategy

WhatsApp Web virtualizes long lists and changes implementation details often.
The content script prefers stable semantics and test IDs where available, then
uses bounded fallbacks:

- chat rows are scoped to `#pane-side` and prefer `role=row` plus list-item and
  cell-frame test IDs;
- messages are scoped to `#main`, require `role=row`, and are accepted only
  when they contain `data-testid="msg-container"`;
- current chat discovery uses selected/current ARIA state before normalized
  labels from the visible header and row title;
- actions locate visible menu items by accessible label/text and media controls
  by visible labels or test-ID signatures;
- reaction movement ranks visible, actionable controls geometrically instead of
  assuming fixed grid dimensions.

Every selector is scoped and visibility-filtered before interaction. The script
stores both element references and stable-ish message keys so it can recover
after a virtualized row is replaced. Delayed re-querying after scrolls and
picker transitions handles asynchronous UI rendering. Failure paths show a
toast rather than guessing at hidden or unrelated elements.

When WhatsApp changes, first reproduce with the browser smoke fixture, then
inspect the live accessibility tree and update the narrowest selector or
fallback. Do not broaden selectors globally just to make one variant work.

## Accessibility and focus

The injected status and toast use polite live regions. The help overlay is a
labelled modal dialog and its close control has an accessible name. Selected
messages receive `aria-current`; reaction choices receive real focus and a
visible outline. The off-screen read-only sentinel is labelled as command mode
and retains keyboard focus outside editable contexts.

Insert mode protects text fields, contenteditable editors, WhatsApp search,
and emoji search from command interception. Command-mode locks briefly recover
focus after WhatsApp itself re-focuses a composer during navigation. All event
handling is capture-phase and only responds to trusted user events.
