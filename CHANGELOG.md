# WhatsVim

## 0.4.0

### Preparation changes

- Unpublished 0.4.0 release preparation for the standalone WhatsVim extension.
- Add a subtle, no-layout-shift border around the active chat composer in
  Insert mode, including light, dark, and forced-colors support.
- Restore the selected message after Escape cancels a reply, including bounded
  handling for delayed virtualized rows.
- Improve rapid chat navigation and prevent stale asynchronous commands from
  reclaiming a newer keyboard or pointer context.
- Preserve the selected quick or expanded reaction when WhatsApp refreshes the
  emoji picker, including keyboard access to more reactions.
- `Space` expands the selected message's visible Read more control.

### Engineering and release preparation

- Compile strict TypeScript sources before loading or packaging; harden Enter
  repeat handling and the disposable browser smoke harness.
- Verify deterministic ZIP payloads and metadata against freshly built files,
  and pin workflow actions used for release preparation.
