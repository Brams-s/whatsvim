# WhatsVim

## 0.4.0

### Minor Changes

- First stable, unpublished release of the standalone WhatsVim extension, with
  version synchronization, deterministic packaging, and release preparation.
- Add a subtle, no-layout-shift border around the active chat composer in
  Insert mode, including light, dark, and forced-colors support.
- Restore the selected message after Escape cancels a reply, including bounded
  handling for delayed virtualized rows.

### Known limitations

- Read more expansion currently fails in live WhatsApp Web; fixture coverage
  does not establish live-site support, and investigation is deferred.
