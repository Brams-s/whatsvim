(() => {
  "use strict";

  if (globalThis.__whatsvimNavigationInstalled) return;
  globalThis.__whatsvimNavigationInstalled = true;

  const keymap = globalThis.WhatsVimKeymap;
  if (!keymap) return;
  const resolveKey = keymap.resolve;

  const extensionManifest = globalThis.chrome?.runtime?.getManifest?.();
  const buildVersion = extensionManifest?.version_name || extensionManifest?.version || "";
  const selectedMessageClass = "whatsvim-selected-message";
  const selectedChatClass = "whatsvim-selected-chat";
  const activePaneClass = "whatsvim-active-pane";
  const selectedReactionClass = "whatsvim-selected-reaction";

  const ids = Object.freeze({
    sentinel: "whatsvim-sentinel",
    mode: "whatsvim-mode",
    toast: "whatsvim-toast",
    help: "whatsvim-help",
    helpPanel: "whatsvim-help-panel",
    helpClose: "whatsvim-help-close",
  });

  // These are production selectors already used by the extension. Keep DOM
  // discovery confined to WhatsApp's two navigation roots; broad document
  // searches can otherwise select controls in an overlay or sidebar popup.
  const whatsappSelectors = Object.freeze({
    chat: Object.freeze({
      root: "#pane-side",
      primary: '[role="row"][data-testid^="list-item-"]',
      legacyCell: '[data-testid="cell-frame-container"]',
      legacyRow: '[role="row"], [role="listitem"]',
      cell: '[data-testid="cell-frame-container"]',
      title: '[data-testid="cell-frame-title"]',
    }),
    message: Object.freeze({
      root: "#main",
      row: '[role="row"]',
      container: '[data-testid="msg-container"]',
    }),
  });

  type HelpGroup = readonly [string, readonly (readonly [string, string])[]];
  type SelectionOptions = { mode?: boolean; scroll?: boolean };
  type FocusOptions = { focus?: boolean };
  type PaneOptions = { announce?: boolean };
  type MediaOptions = { intent?: number; selectMessagePaneWhenUnavailable?: boolean };
  type ComposerOptions = { announce?: boolean; intent?: number; retrying?: boolean };
  type WaitOptions = { poll?: boolean; root?: Node | null; timeout?: number };
  type Shortcut = { altKey?: boolean; code: string; ctrlKey?: boolean; key: string; shiftKey?: boolean };
  type MouseInit = MouseEventInit & { clientX: number; clientY: number; view: Window };
  type ReactionChoiceState = { index: number; key: string };

  const helpGroups: readonly HelpGroup[] = Object.freeze([
    ["Panes", [["h / l", "select chat list / message pane"], ["j / k", "move in the selected pane"], ["Shift+J / Shift+K", "move between chats"], ["gg / G", "first / last chat"]]],
    ["Messages", [["Enter / i / a", "focus the composer"], ["r", "reply to selected message"], ["Shift+R / e", "react / edit"], ["l / o", "open selected media (l otherwise selects the message pane)"], ["Space", "expand Read more on the selected message"], ["I", "compose at the newest message"]]],
    ["Overlays & search", [["h / j / k / l", "move in reaction or media overlays"], ["/", "focus WhatsApp search"], ["Esc / Ctrl+[", "close, clear selection, or leave Insert mode"], ["?", "toggle this reference"]]],
  ]);

  let mode: WhatsVimMode = "normal";
  let activePane: WhatsVimPane = "chat";
  let pendingG = false;
  let pendingGTimer = 0;
  let toastTimer = 0;
  let helpOpen = false;
  let helpReturnMode: WhatsVimMode = "normal";
  let helpReturnFocus: HTMLElement | null = null;
  let helpListenersInstalled = false;
  let sentinel!: HTMLDivElement;
  let modeBadge!: HTMLDivElement;
  let toast!: HTMLDivElement;
  let help!: HTMLDialogElement;
  let activeChatRow: HTMLElement | null = null;
  let activeMessageRow: HTMLElement | null = null;
  let activeMessageKey = "";
  let activeReactionChoice: HTMLElement | null = null;
  let activeReactionState: ReactionChoiceState = { key: "", index: -1 };
  let messageModeReturnRow: HTMLElement | null = null;
  let messageModeReturnKey = "";
  let messageReturnRestoreSerial = 0;
  let pendingMessageReturnRestore = 0;
  let mediaReturnRow: HTMLElement | null = null;
  let mediaReturnKey = "";
  let mediaReturnScroller: HTMLElement | null = null;
  let mediaReturnScrollTop: number | null = null;
  let mediaReturnScrollLeft: number | null = null;
  let mediaRestoreSerial = 0;
  let messageOverlayKind = "";
  let messageOverlayCloseSerial = 0;
  let reactionSearchFocusSerial = 0;
  let reactionSearchFocusUntil = 0;
  let normalModeLockUntil = 0;
  let messageModeLockUntil = 0;
  let pendingChatActivation: Promise<boolean> | null = null;
  let chatNavigationGeneration = 0;
  let commandIntentGeneration = 0;
  let ownedCompositionEnter = false;
  const heldPaneNavigationKeys = new Set();

  function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    attributes: Record<string, string> = {},
    text = ""
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "className") element.className = value;
      else element.setAttribute(name, value);
    }
    if (text) element.textContent = text;
    return element;
  }

  function mountUi() {
    if (!document.body) return false;

    const existingSentinel = document.getElementById(ids.sentinel);
    if (existingSentinel instanceof HTMLDivElement) {
      sentinel = existingSentinel;
    } else {
      // This is a programmatic command target, not an editor. The visible live
      // mode status communicates the current command state to assistive technology.
      sentinel = createElement("div", {
        id: ids.sentinel,
        tabindex: "-1",
      });
      document.body.append(sentinel);
    }

    const existingModeBadge = document.getElementById(ids.mode);
    if (existingModeBadge instanceof HTMLDivElement) {
      modeBadge = existingModeBadge;
    } else {
      modeBadge = createElement("div", {
        id: ids.mode,
        role: "status",
        "aria-live": "polite",
      }, "NORMAL");
      document.body.append(modeBadge);
    }

    const existingToast = document.getElementById(ids.toast);
    if (existingToast instanceof HTMLDivElement) {
      toast = existingToast;
    } else {
      toast = createElement("div", {
        id: ids.toast,
        role: "status",
        "aria-live": "polite",
      });
      document.body.append(toast);
    }

    const existingHelp = document.getElementById(ids.help);
    if (existingHelp instanceof HTMLDialogElement) {
      help = existingHelp;
    } else {
      help = createElement("dialog", {
        id: ids.help,
        "aria-labelledby": "whatsvim-help-title",
        "aria-describedby": "whatsvim-help-subtitle",
      });
      const panel = createElement("section", { id: ids.helpPanel });
      const header = createElement("header", { id: "whatsvim-help-header" });
      const title = createElement("h2", { id: "whatsvim-help-title" }, "Keyboard reference");
      const close = createElement("button", {
        id: ids.helpClose,
        type: "button",
        "aria-label": "Close keyboard shortcut help",
      }, "Close · Esc");
      header.append(title, close);

      const subtitle = createElement("p", { id: "whatsvim-help-subtitle" }, "Navigate WhatsApp without leaving the keyboard.");
      const groups = createElement("div", { id: "whatsvim-help-groups" });
      for (const [name, rows] of helpGroups) {
        const group = createElement("section", { className: "whatsvim-help-group", "aria-labelledby": `whatsvim-help-${name.toLowerCase().replaceAll(" ", "-")}` });
        group.append(createElement("h3", { id: `whatsvim-help-${name.toLowerCase().replaceAll(" ", "-")}` }, name));
        for (const [keys, description] of rows) {
          const row = createElement("div", { className: "whatsvim-help-row" });
          row.append(createElement("kbd", {}, keys), createElement("span", {}, description));
          group.append(row);
        }
        groups.append(group);
      }
      panel.append(
        header,
        subtitle,
        groups,
        createElement(
          "p",
          { id: "whatsvim-help-note" },
          "Mapped keys are handled in Normal mode. Editors use Insert mode; Ctrl+V in Normal mode first focuses the composer."
        )
      );
      help.append(panel);
      document.body.append(help);

    }

    if (!helpListenersInstalled) {
      help.addEventListener("keydown", onHelpKeyDown);
      help.addEventListener("click", (event) => {
        if (event.target === help) setHelpOpen(false);
      });
      help.addEventListener("cancel", (event) => {
        event.preventDefault();
        setHelpOpen(false);
      });
      help.addEventListener("close", finishHelpClose);
      help.querySelector(`#${ids.helpClose}`)?.addEventListener("click", () => setHelpOpen(false));
      helpListenersInstalled = true;
    }

    updateModeBadge();
    modeBadge.dataset.version = buildVersion;
    return true;
  }

  function updateModeBadge() {
    if (!modeBadge) return;
    const publicMode = mode === "insert" ? "insert" : "normal";
    modeBadge.dataset.mode = publicMode;
    modeBadge.dataset.context = mode;
    modeBadge.dataset.pane = activePane;
    modeBadge.textContent = `${publicMode.toUpperCase()} · ${activePane === "chat" ? "CHATS" : "MESSAGES"}`;
  }

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || target === sentinel) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return !target.disabled;
    }
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    const editor = target.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    return editor instanceof HTMLElement;
  }

  function isVisible(element: Element | null | undefined): boolean {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function focusSentinel() {
    if (mode === "insert" || helpOpen || !document.hasFocus()) return;
    if (mode === "message" && messageOverlayKind === "reaction" && reactionPicker()) return;
    if (!mountUi()) return;
    if (document.activeElement !== sentinel) {
      sentinel.focus({ preventScroll: true });
    }
  }

  function setMode(nextMode: WhatsVimMode, options: FocusOptions = {}) {
    mode = ["insert", "message"].includes(nextMode) ? nextMode : "normal";
    updateModeBadge();
    syncComposerInsertIndicator();
    if (mode !== "insert" && options.focus !== false) {
      setTimeout(focusSentinel, 0);
    }
  }

  function syncComposerInsertIndicator() {
    document.querySelectorAll(".whatsvim-insert-composer").forEach((element) => {
      element.classList.remove("whatsvim-insert-composer");
    });
    const editor = composer();
    if (mode === "insert" && editor && editor === document.activeElement) {
      editor.classList.add("whatsvim-insert-composer");
    }
  }

  function keepNormalFocus(duration = 500) {
    messageModeLockUntil = 0;
    normalModeLockUntil = performance.now() + duration;
    setMode("normal", { focus: false });
    for (const delay of [0, 80, 200, duration]) {
      setTimeout(() => {
        if (mode === "normal" && performance.now() <= normalModeLockUntil + 30) {
          focusSentinel();
        }
      }, delay);
    }
  }

  function keepMessageFocus(duration = 500) {
    normalModeLockUntil = 0;
    messageModeLockUntil = performance.now() + duration;
    setMode("message", { focus: false });
    for (const delay of [0, 80, 200, duration]) {
      setTimeout(() => {
        if (mode === "message" && performance.now() <= messageModeLockUntil + 30) {
          focusSentinel();
        }
      }, delay);
    }
  }

  function lockedCommandMode() {
    const now = performance.now();
    if (now < messageModeLockUntil) return "message";
    if (now < normalModeLockUntil) return "normal";
    return null;
  }

  function flash(message: string) {
    if (!mountUi()) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.visible = "true";
    toastTimer = setTimeout(() => {
      if (toast) toast.dataset.visible = "false";
    }, 1500);
  }

  function setHelpOpen(open: boolean) {
    if (open) cancelChatNavigation();
    if (!mountUi()) return;
    const close = help.querySelector<HTMLButtonElement>(`#${ids.helpClose}`);
    const dialogOpen = help.open === true;
    if (open) {
      if (!helpOpen) {
        helpOpen = true;
        help.dataset.open = "true";
        helpReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        helpReturnMode = mode === "message" ? "message" : "normal";
        setMode(helpReturnMode, { focus: false });
      }
      if (!help.open) {
        try {
          help.showModal();
          if (!help.open) {
            finishHelpClose();
            return;
          }
        } catch {
          finishHelpClose();
          return;
        }
      }
      close?.focus({ preventScroll: true });
    } else {
      if (!helpOpen && !dialogOpen) return;
      if (dialogOpen) {
        help.close();
        if (helpOpen) finishHelpClose();
      } else {
        finishHelpClose();
      }
    }
  }

  function finishHelpClose() {
    const wasOpen = helpOpen;
    helpOpen = false;
    help.dataset.open = "false";
    if (!wasOpen) return;
    setMode(helpReturnMode, { focus: false });
    const returnFocus = helpReturnFocus;
    helpReturnFocus = null;
    if (returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    } else {
      focusSentinel();
    }
  }

  function onHelpKeyDown(event: KeyboardEvent) {
    if (!helpOpen) return;
    if (event.key === "Escape") {
      consume(event);
      setHelpOpen(false);
      return;
    }
    if (event.key === "?" || (event.ctrlKey && event.key === "[")) {
      consume(event);
      setHelpOpen(false);
      return;
    }
    if (event.key === "Tab") {
      // The help currently has one control. Keeping Tab here makes this a
      // modal rather than allowing focus to escape into WhatsApp.
      consume(event);
      help.querySelector<HTMLButtonElement>(`#${ids.helpClose}`)?.focus({ preventScroll: true });
      return;
    }
    // The modal owns keyboard interaction while it is open; do not let
    // WhatsApp's page-level shortcuts receive keys from its close button.
    consume(event);
  }

  function consume(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function dispatchWhatsAppShortcut({ key, code, ctrlKey = false, altKey = false, shiftKey = false }: Shortcut) {
    const target = document.activeElement instanceof Element ? document.activeElement : document.body;
    if (!target) return false;
    const init = {
      key,
      code,
      ctrlKey,
      altKey,
      shiftKey,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return true;
  }

  function normalizedText(value: string | null | undefined) {
    return (value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function uniqueOutermost<T extends Element>(elements: T[], root: Element, marker: (element: T) => boolean): T[] {
    const unique = [...new Set(elements)].filter((element) => (
      element instanceof Element && root.contains(element) && isVisible(element)
    ));
    return unique.filter((element) => !unique.some((other) => (
      other !== element && other.contains(element) && marker(other)
    )));
  }

  function chatRows(): HTMLElement[] {
    const pane = document.querySelector(whatsappSelectors.chat.root);
    if (!pane) return [];

    const preferred = uniqueOutermost(
      [...pane.querySelectorAll(whatsappSelectors.chat.primary)]
        .filter((row): row is HTMLElement => row instanceof HTMLElement && Boolean(row.querySelector(whatsappSelectors.chat.cell))),
      pane,
      (row) => row.matches(whatsappSelectors.chat.primary)
    );
    if (preferred.length > 0) return preferred;

    const legacy = [...pane.querySelectorAll(whatsappSelectors.chat.legacyCell)]
      .map((cell) => cell.closest(whatsappSelectors.chat.legacyRow) || cell)
      .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && (Boolean(candidate.querySelector(whatsappSelectors.chat.cell)) || candidate.matches(whatsappSelectors.chat.legacyCell)));
    return uniqueOutermost(legacy, pane, (candidate) => (
      candidate.matches(whatsappSelectors.chat.legacyRow) || candidate.matches(whatsappSelectors.chat.legacyCell)
    ));
  }

  function paneRoot(pane: WhatsVimPane): HTMLElement | null {
    return document.querySelector(pane === "chat" ? "#side" : whatsappSelectors.message.root);
  }

  function suppressDuplicatePaneNavigation(event: KeyboardEvent, action: WhatsVimAction) {
    if (![
      "next-chat",
      "previous-chat",
      "next-message",
      "previous-message",
    ].includes(action)) return false;
    const key = event.code || event.key;
    // WhatsApp can receive duplicate keydowns for one physical hold. A keyup
    // releases this guard, so deliberate repeated presses still navigate.
    if (heldPaneNavigationKeys.has(key) && !event.repeat) return true;
    heldPaneNavigationKeys.add(key);
    return false;
  }

  function setActivePane(nextPane: WhatsVimPane, { announce = true }: PaneOptions = {}) {
    const pane = nextPane === "chat" ? "chat" : "message";
    if (pane === "message" && activePane === "chat") cancelChatNavigation();
    const root = paneRoot(pane);
    if (!(root instanceof HTMLElement) || !isVisible(root)) {
      if (announce) flash(pane === "chat" ? "Chat list is not available" : "Message pane is not available");
      return false;
    }
    document.querySelectorAll(`.${activePaneClass}`).forEach((element) => element.classList.remove(activePaneClass));
    root.classList.add(activePaneClass);
    activePane = pane;
    updateModeBadge();
    return true;
  }

  function selectChatRow(row: HTMLElement) {
    document.querySelectorAll(`.${selectedChatClass}`).forEach((selected) => {
      if (selected !== row) selected.classList.remove(selectedChatClass);
    });
    if (row instanceof HTMLElement) row.classList.add(selectedChatClass);
  }

  function clearChatSelection() {
    activeChatRow = null;
    document.querySelectorAll(`.${selectedChatClass}`).forEach((row) => row.classList.remove(selectedChatClass));
  }

  function chatRow(element: EventTarget | null): HTMLElement | null {
    if (!(element instanceof Element)) return null;
    const pane = document.querySelector(whatsappSelectors.chat.root);
    if (!pane?.contains(element)) return null;
    const row = element.closest(whatsappSelectors.chat.legacyRow);
    return row instanceof HTMLElement && pane.contains(row) && row.querySelector(whatsappSelectors.chat.cell)
      ? row
      : null;
  }

  function currentChatLabel() {
    const header = document.querySelector("#main header");
    if (!header) return "";

    const chatTitle = header.querySelector('[data-testid="conversation-info-header-chat-title"]');
    if (chatTitle) return normalizedText(chatTitle.textContent);

    const titled = [...header.querySelectorAll("[title]")].find(isVisible);
    return normalizedText(titled?.getAttribute("title") || titled?.textContent || header.textContent);
  }

  function rowLabels(row: HTMLElement): string[] {
    const primary = normalizedText(
      row.querySelector(whatsappSelectors.chat.title)?.textContent
    );
    const titled = [...row.querySelectorAll("[title]")]
      .map((element) => normalizedText(element.getAttribute("title") || element.textContent))
      .filter(Boolean);
    return [...new Set([primary, ...titled].filter(Boolean))];
  }

  function currentChatIndex(rows: HTMLElement[]): number {
    const trackedIndex = activeChatRow ? rows.indexOf(activeChatRow) : -1;
    if (trackedIndex >= 0) return trackedIndex;

    const selectedIndex = rows.findIndex((row) => {
      return (
        row.matches('[aria-selected="true"], [aria-current="true"], [data-selected="true"]') ||
        row.querySelector('[aria-selected="true"], [aria-current="true"], [data-selected="true"]')
      );
    });
    if (selectedIndex >= 0) return selectedIndex;

    const label = currentChatLabel();
    if (!label) return -1;
    // Text is only a legacy localization fallback. Ambiguous labels must not
    // advance an unrelated chat row.
    const matches = rows.filter((row) => rowLabels(row).includes(label));
    return matches.length === 1 ? rows.indexOf(matches[0]) : -1;
  }

  function chatActivationObserved(row: HTMLElement): boolean {
    if (!(row instanceof HTMLElement) || !row.isConnected) return false;
    if (row.matches('[aria-selected="true"], [aria-current="true"], [data-selected="true"]')) return true;
    if (row.querySelector('[aria-selected="true"], [aria-current="true"], [data-selected="true"]')) return true;
    const label = currentChatLabel();
    return Boolean(label && rowLabels(row).includes(label));
  }

  function cancelChatNavigation(): number {
    if (pendingChatActivation) activeChatRow = null;
    chatNavigationGeneration += 1;
    return chatNavigationGeneration;
  }

  function beginCommandIntent(): number {
    commandIntentGeneration += 1;
    return commandIntentGeneration;
  }

  function commandIntentIsCurrent(intent: number): boolean {
    return intent === commandIntentGeneration;
  }

  function chatNavigationIsCurrent(generation: number): boolean {
    return generation === chatNavigationGeneration;
  }

  function queueChatOperation(operation: () => Promise<boolean>): Promise<boolean> {
    const previous = pendingChatActivation;
    let task!: Promise<boolean>;
    task = (async () => {
      try {
        // Publishing this task happens before this first microtask. Each tap
        // therefore waits for its immediate predecessor, then rechecks state
        // and publishes its own activation without a fan-out window.
        if (previous) {
          try {
            await previous;
          } catch {
            // A failed predecessor does not poison a later explicit command.
          }
        } else {
          await Promise.resolve();
        }
        return await operation();
      } catch {
        return false;
      } finally {
        if (pendingChatActivation === task) pendingChatActivation = null;
      }
    })();
    pendingChatActivation = task;
    return task;
  }

  async function activateChat(row: HTMLElement, generation: number): Promise<boolean> {
    if (!(row instanceof HTMLElement)) return false;
    if (!chatNavigationIsCurrent(generation)) return false;

    const target = row.querySelector('[data-testid="cell-frame-container"]') || row;
    if (!(target instanceof HTMLElement)) return false;

    clearMessageSelection();
    clearMessageReturn();
    row.scrollIntoView({ block: "nearest" });
    keepNormalFocus();

    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    // Synthetic events are always untrusted. Do not equate dispatch success
    // with a WhatsApp action: require an observable selection/header change.
    if (await waitForPredicate(() => chatActivationObserved(row), { root: document.querySelector(whatsappSelectors.chat.root), timeout: 280 })) {
      if (!chatNavigationIsCurrent(generation)) return false;
      activeChatRow = row;
      selectChatRow(row);
      setActivePane("chat", { announce: false });
      return true;
    }

    // Some controls activate on click rather than mousedown. Do not send a
    // second mousedown; this bounded mouseup/click fallback avoids duplicate
    // activation when the primary event was merely slow to render.
    if (!chatNavigationIsCurrent(generation)) return false;
    const fallbackInit = mouseEventInit(target);
    for (const type of ["mouseup", "click"]) target.dispatchEvent(new MouseEvent(type, fallbackInit));
    if (await waitForPredicate(() => chatActivationObserved(row), { root: document.querySelector(whatsappSelectors.chat.root), timeout: 280 })) {
      if (!chatNavigationIsCurrent(generation)) return false;
      activeChatRow = row;
      selectChatRow(row);
      setActivePane("chat", { announce: false });
      return true;
    }
    return false;
  }

  async function navigateChat(direction: number): Promise<boolean> {
    const generation = chatNavigationGeneration;
    return queueChatOperation(async () => {
      if (!chatNavigationIsCurrent(generation)) return false;
      const rows = chatRows();
      const current = currentChatIndex(rows);
      const target = current >= 0
        ? rows[current + direction]
        : direction > 0
          ? rows[0]
          : rows.at(-1);
      if (target) {
        try {
          const activated = await activateChat(target, generation);
          if (!chatNavigationIsCurrent(generation)) return false;
          if (activated) return true;
          cancelChatNavigation();
        } catch {
          if (chatNavigationIsCurrent(generation)) cancelChatNavigation();
        }
      }
      if (chatNavigationIsCurrent(generation)) {
        flash(rows.length > 0 ? "End of chat list" : "Chat list is not available");
      }
      return false;
    });
  }

  async function selectBoundaryChat(edge: "first" | "last"): Promise<void> {
    const generation = cancelChatNavigation();
    await queueChatOperation(async () => {
      if (!chatNavigationIsCurrent(generation)) return false;
      try {
        const pane = document.querySelector(whatsappSelectors.chat.root);
        if (!(pane instanceof HTMLElement)) {
          flash("Chat list is not available");
          cancelChatNavigation();
          return false;
        }
        pane.scrollTo({ top: edge === "first" ? 0 : pane.scrollHeight, behavior: "auto" });
        const target = await waitForPredicate(() => {
          const rows = chatRows();
          return edge === "first" ? rows[0] : rows.at(-1);
        }, { root: pane, timeout: 700, poll: true });
        if (!chatNavigationIsCurrent(generation)) return false;
        if (!target) {
          flash("No visible chats found");
          cancelChatNavigation();
          return false;
        }
        const activated = await activateChat(target, generation);
        if (!activated && chatNavigationIsCurrent(generation)) {
          flash("No visible chats found");
          cancelChatNavigation();
        }
        return activated;
      } catch {
        if (chatNavigationIsCurrent(generation)) {
          flash("No visible chats found");
          cancelChatNavigation();
        }
        return false;
      }
    });
  }

  function messageRow(element: EventTarget | null): HTMLElement | null {
    if (!(element instanceof Element)) return null;
    const main = document.querySelector(whatsappSelectors.message.root);
    if (!main?.contains(element)) return null;
    const row = element.closest(whatsappSelectors.message.row);
    return row instanceof HTMLElement && main.contains(row) && row.querySelector(whatsappSelectors.message.container)
      ? row
      : null;
  }

  function messageRows(): HTMLElement[] {
    const main = document.querySelector(whatsappSelectors.message.root);
    if (!main) return [];
    return uniqueOutermost(
      [...main.querySelectorAll(whatsappSelectors.message.row)]
        .filter((row): row is HTMLElement => row instanceof HTMLElement && Boolean(row.querySelector(whatsappSelectors.message.container))),
      main,
      (row) => row.matches(whatsappSelectors.message.row) && Boolean(row.querySelector(whatsappSelectors.message.container))
    );
  }

  function messageContainer(row: HTMLElement | null | undefined): HTMLElement | null {
    const container = row?.querySelector?.(whatsappSelectors.message.container);
    return container instanceof HTMLElement ? container : null;
  }

  function messageKey(row: Element | null | undefined): string {
    if (!(row instanceof Element)) return "";
    const root = row.querySelector('[data-id], [data-testid^="conv-msg-"]');
    return root?.getAttribute("data-id") || root?.getAttribute("data-testid") || "";
  }

  function clearMessageSelection() {
    clearReactionFocus();
    clearMediaReturn();
    document.querySelectorAll(`.${selectedMessageClass}`).forEach((row) => {
      row.classList.remove(selectedMessageClass);
      row.removeAttribute("aria-current");
    });
    activeMessageRow = null;
    activeMessageKey = "";
    messageOverlayKind = "";
  }

  function clearMessageReturn() {
    messageReturnRestoreSerial += 1;
    messageModeReturnRow = null;
    messageModeReturnKey = "";
  }

  function captureMessageReturn(row: HTMLElement | null | undefined) {
    messageReturnRestoreSerial += 1;
    messageModeReturnRow = row instanceof HTMLElement ? row : null;
    messageModeReturnKey = messageKey(row);
  }

  function clearMediaReturn() {
    mediaRestoreSerial += 1;
    mediaReturnRow = null;
    mediaReturnKey = "";
    mediaReturnScroller = null;
    mediaReturnScrollTop = null;
    mediaReturnScrollLeft = null;
  }

  function selectMessage(row: HTMLElement | null | undefined, options: SelectionOptions = {}) {
    if (!(row instanceof HTMLElement) || !messageContainer(row)) return false;

    document.querySelectorAll(`.${selectedMessageClass}`).forEach((selected) => {
      if (selected !== row) {
        selected.classList.remove(selectedMessageClass);
        selected.removeAttribute("aria-current");
      }
    });
    activeMessageRow = row;
    activeMessageKey = messageKey(row);
    row.classList.add(selectedMessageClass);
    row.setAttribute("aria-current", "true");
    if (options.scroll !== false) row.scrollIntoView({ block: "center", inline: "nearest" });
    setActivePane("message", { announce: false });
    if (options.mode !== false) keepMessageFocus();
    return true;
  }

  function selectedMessageRow() {
    if (activeMessageRow?.isConnected && messageContainer(activeMessageRow)) return activeMessageRow;
    if (activeMessageKey) {
      const match = messageRows().find((row) => messageKey(row) === activeMessageKey);
      if (match) {
        activeMessageRow = match;
        match.classList.add(selectedMessageClass);
        match.setAttribute("aria-current", "true");
        return match;
      }
    }
    return null;
  }

  function enterMessageMode() {
    const rows = messageRows();
    const current = selectedMessageRow();
    const target = current && rows.includes(current) ? current : rows.at(-1);
    if (!target || !selectMessage(target)) {
      flash("Open a chat with messages before selecting a message");
    }
  }

  function initializeMessageCursor() {
    const current = selectedMessageRow();
    if (current) return true;
    const latest = messageRows().at(-1);
    if (!latest || !selectMessage(latest, { mode: false })) {
      flash("No messages are available");
      return false;
    }
    return true;
  }

  async function selectMessagePane(intent: number) {
    cancelChatNavigation();
    const normalContext = mode === "normal";
    const activation = pendingChatActivation;
    if (activation) await activation;
    if (!commandIntentIsCurrent(intent)) return false;
    if (!normalContext) return setActivePane("message");
    const ready = await waitForPredicate(() => {
      const root = paneRoot("message");
      return isVisible(root) && messageRows().length > 0 ? true : null;
    }, { root: document.body, timeout: 700, poll: true });
    if (!commandIntentIsCurrent(intent)) return false;
    if (!ready || !setActivePane("message", { announce: false }) || !initializeMessageCursor()) {
      flash("Message pane is not available");
      return false;
    }
    if (commandIntentIsCurrent(intent)) keepNormalFocus();
    return true;
  }

  function messageScroller(row: HTMLElement | null | undefined): HTMLElement | null {
    let node = row?.parentElement;
    while (node && node.id !== "main") {
      const style = getComputedStyle(node);
      if (
        node instanceof HTMLElement &&
        node.scrollHeight > node.clientHeight + 4 &&
        /(auto|scroll)/.test(style.overflowY)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function waitForPredicate<T>(read: () => T | null | false, { root = document.body, timeout = 900, poll = false }: WaitOptions = {}): Promise<T | null> {
    return new Promise((resolve) => {
      let finished = false;
      let observer: MutationObserver | null = null;
      let timer = 0;
      let pollTimer = 0;
      const finish = (value: T | null | false) => {
        if (finished) return;
        finished = true;
        observer?.disconnect();
        clearTimeout(timer);
        clearInterval(pollTimer);
        resolve(value || null);
      };
      const check = () => {
        try {
          const value = read();
          if (value) finish(value);
        } catch {
          // A virtualized root can be replaced while we are waiting. Treat it
          // as not-ready and allow the bounded timeout/poll to settle safely.
        }
      };
      check();
      if (finished) return;
      if (root instanceof Node && root.isConnected) {
        observer = new MutationObserver(check);
        observer.observe(root, { childList: true, subtree: true, attributes: true });
      }
      // Scrolling need not mutate the subtree, so virtual-list callers opt in
      // to this small polling fallback. It is always cleaned up on completion.
      if (poll) pollTimer = setInterval(check, 50);
      timer = setTimeout(() => finish(null), timeout);
    });
  }

  async function waitForValue<T>(read: () => T | null | false, timeout = 900): Promise<T | null> {
    return waitForPredicate(read, { timeout, poll: true });
  }

  async function navigateMessage(direction: number): Promise<void> {
    if (reactionPicker()) await closeReactionPicker();

    let rows = messageRows();
    let current = selectedMessageRow();
    if (!current) {
      const latest = rows.at(-1);
      if (latest && selectMessage(latest)) return;
      flash("No messages are available");
      return;
    }

    let index = rows.indexOf(current);
    let target: HTMLElement | null | undefined = index >= 0 ? rows[index + direction] : null;
    if (target && selectMessage(target)) return;

    const key = activeMessageKey;
    const scroller = messageScroller(current);
    if (scroller) {
      const renderedKeys = new Set(rows.map(messageKey).filter(Boolean));
      scroller.scrollBy({ top: direction * Math.max(120, scroller.clientHeight * 0.75), behavior: "auto" });
      await waitForPredicate(() => {
        const rendered = messageRows();
        return rendered.some((row) => {
          const candidateKey = messageKey(row);
          return candidateKey && candidateKey !== key && !renderedKeys.has(candidateKey);
        }) ? true : null;
      }, { root: scroller, timeout: 700, poll: true });
      rows = messageRows();
      index = rows.findIndex((row) => messageKey(row) === key);
      target = index >= 0
        ? rows[index + direction]
        : direction < 0
          ? rows.at(-1)
          : rows[0];
      if (target && messageKey(target) !== key && selectMessage(target)) return;
    }

    flash(direction > 0 ? "Newest message reached" : "Oldest loaded message reached");
    focusSentinel();
  }

  function mouseEventInit(element: Element): MouseInit {
    const rect = element.getBoundingClientRect();
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
  }

  function triggerMouse(element: Element | null | undefined): boolean {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const init = mouseEventInit(element);
    for (const type of ["mousedown", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, init));
    }
    return true;
  }

  async function revealMessageControls(row: HTMLElement | null = selectedMessageRow()): Promise<HTMLElement | null> {
    const message = messageContainer(row);
    if (!message || !row) return null;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    const init = mouseEventInit(message);
    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
      const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      message.dispatchEvent(new EventType(type, init));
    }
    await wait(80);
    return message;
  }

  function visibleMenuItem(action: string): Element | null {
    const expected = normalizedText(action);
    const matches = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].filter((item) => {
      if (!isVisible(item) || !item.closest('[role="menu"]')) return false;
      // Do not guess from a partially matching/localized text node. The
      // accessible name is the only legacy fallback and must be exact.
      const label = normalizedText(item.getAttribute("aria-label") || item.getAttribute("title") || "");
      return label === expected;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async function chooseMessageMenuAction(action: string, unavailableMessage: string, intent: number): Promise<boolean> {
    if (!commandIntentIsCurrent(intent)) return false;
    normalModeLockUntil = 0;
    messageModeLockUntil = performance.now() + 1100;
    const row = selectedMessageRow();
    const message = await revealMessageControls(row);
    if (!commandIntentIsCurrent(intent)) return false;
    const menuButton = message?.querySelector('[data-testid="icon-down-context"]');
    if (!(menuButton instanceof HTMLElement) || !triggerMouse(menuButton)) {
      flash("Message actions are not available");
      keepMessageFocus();
      return false;
    }

    const item = await waitForValue(() => visibleMenuItem(action));
    if (!commandIntentIsCurrent(intent)) return false;
    if (!item) {
      triggerMouse(menuButton);
      flash(unavailableMessage);
      keepMessageFocus();
      return false;
    }

    messageModeLockUntil = 0;
    if (!commandIntentIsCurrent(intent)) return false;
    triggerMouse(item);
    return true;
  }

  function replyComposerOpen() {
    return [...document.querySelectorAll('#main [data-testid="quoted-message"]')]
      .some((quoted) => isVisible(quoted) && !quoted.closest('[data-testid="msg-container"]'));
  }

  function editMessageComposer() {
    const editor = document.querySelector('[data-testid="edit-message-composer"][contenteditable="true"]');
    return editor instanceof HTMLElement && isVisible(editor) ? editor : null;
  }

  async function replyToSelectedMessage(intent: number) {
    const row = selectedMessageRow();
    if (!row) {
      flash("Select a message first");
      return;
    }
    captureMessageReturn(row);
    if (!await chooseMessageMenuAction("reply", "This message cannot be replied to", intent)) {
      if (commandIntentIsCurrent(intent)) clearMessageReturn();
      return;
    }
    if (!await waitForValue(replyComposerOpen)) {
      if (commandIntentIsCurrent(intent)) {
        clearMessageReturn();
        flash("WhatsApp did not open the reply composer");
      }
      return;
    }
    if (commandIntentIsCurrent(intent)) focusComposer({ intent });
  }

  async function editSelectedMessage(intent: number) {
    const row = selectedMessageRow();
    if (!row) {
      flash("Select a message first");
      return;
    }
    captureMessageReturn(row);
    if (!await chooseMessageMenuAction("edit", "Only recent editable messages can be edited", intent)) {
      if (commandIntentIsCurrent(intent)) clearMessageReturn();
      return;
    }
    const editor = await waitForValue(editMessageComposer);
    if (!commandIntentIsCurrent(intent)) return;
    if (!editor) {
      clearMessageReturn();
      flash("WhatsApp did not open the message editor");
      return;
    }
    messageModeLockUntil = 0;
    editor.focus({ preventScroll: true });
    setMode("insert", { focus: false });
  }

  function reactionPicker() {
    return [...document.querySelectorAll('[role="dialog"]')].find((dialog) => {
      if (dialog.id === ids.help || !isVisible(dialog)) return false;
      if (dialog.querySelector('[role="grid"]')) return true;
      if (dialog.querySelector('[data-emoji], [data-testid*="emoji" i]')) return true;
      return [...dialog.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
        .some((button) => /^react(?:\s|$)/i.test(button.getAttribute("aria-label") || ""));
    }) || null;
  }

  function reactionSearchEditor(picker: Element | null = reactionPicker()): HTMLElement | null {
    if (!(picker instanceof Element)) return null;
    const editors = [...picker.querySelectorAll([
      'input:not([disabled])',
      'textarea:not([disabled])',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-tab]',
    ].join(", "))].filter((editor): editor is HTMLElement => editor instanceof HTMLElement && isVisible(editor));
    const labelled = editors.find((editor) => /search|emoji/i.test([
      editor.getAttribute("aria-label"),
      editor.getAttribute("placeholder"),
      editor.getAttribute("data-testid"),
    ].filter(Boolean).join(" ")));
    return labelled || editors[0] || null;
  }

  function isReactionSearchContext(element: EventTarget | null): boolean {
    if (!(element instanceof Element)) return false;
    const editor = reactionSearchEditor();
    return editor instanceof Element && (element === editor || editor.contains(element));
  }

  function reactionChoiceCandidates(scope: Element | null): HTMLElement[] {
    if (!(scope instanceof Element)) return [];
    const candidates = [...scope.querySelectorAll([
      "button:not([disabled])",
      '[role="button"]:not([aria-disabled="true"])',
      '[role="gridcell"]:not([aria-disabled="true"])',
      '[role="option"]:not([aria-disabled="true"])',
      '[role="tab"]:not([aria-disabled="true"])',
      "[data-emoji]",
      '[data-testid*="emoji" i]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(", "))].filter((choice): choice is HTMLElement => (
      choice instanceof HTMLElement && isVisible(choice) && !isEditable(choice)
    ));

    // WhatsApp sometimes nests a role=button/gridcell around the actual
    // button. Keep the deepest actionable node so one emoji is one stop.
    return candidates.filter((choice) => !candidates.some((other) => (
      other !== choice && choice.contains(other)
    )));
  }

  function reactionChoices(picker: Element | null = reactionPicker()): HTMLElement[] {
    if (!(picker instanceof Element)) return [];
    const groups = [...picker.querySelectorAll([
      '[role="grid"]',
      '[role="listbox"]',
      '[role="toolbar"]',
      '[role="tablist"]',
    ].join(", "))].filter(isVisible);
    const groupedChoices = groups.flatMap(reactionChoiceCandidates);
    return groupedChoices.length
      ? [...new Set(groupedChoices)]
      : reactionChoiceCandidates(picker);
  }

  function reactionChoiceKey(choice: HTMLElement): string {
    const emoji = choice.getAttribute("data-emoji")?.trim();
    if (emoji) return `emoji:${emoji}`;
    const label = choice.getAttribute("aria-label")?.trim();
    return label ? `label:${label}` : "";
  }

  function rememberReactionChoice(choice: HTMLElement, choices: readonly HTMLElement[]) {
    activeReactionChoice = choice;
    activeReactionState = {
      key: reactionChoiceKey(choice),
      index: choices.indexOf(choice),
    };
  }

  function clearReactionMarker() {
    document.querySelectorAll(`.${selectedReactionClass}`).forEach((choice) => {
      choice.classList.remove(selectedReactionClass);
    });
  }

  function clearReactionFocus() {
    clearReactionMarker();
    activeReactionChoice = null;
    activeReactionState = { key: "", index: -1 };
  }

  // WhatsApp regularly replaces picker subtrees as emoji data loads. Keep the
  // live node as a fast path, but recover its logical choice when it has been
  // detached before a subsequent navigation or activation.
  function currentReactionChoice(choices: readonly HTMLElement[]): HTMLElement | null {
    if (!choices.length) return null;
    if (activeReactionChoice && choices.includes(activeReactionChoice)) return activeReactionChoice;

    const indexedChoice = activeReactionState.index >= 0
      ? choices[activeReactionState.index]
      : undefined;
    if (activeReactionState.key) {
      // Labels can repeat in a picker. When its previous slot still has the
      // same semantic key, it is the least ambiguous replacement for the
      // detached node; otherwise prefer any semantic match over host focus.
      const keyedChoice = indexedChoice && reactionChoiceKey(indexedChoice) === activeReactionState.key
        ? indexedChoice
        : choices.find((choice) => reactionChoiceKey(choice) === activeReactionState.key);
      if (keyedChoice) {
        rememberReactionChoice(keyedChoice, choices);
        return keyedChoice;
      }
    }
    if (indexedChoice) {
      rememberReactionChoice(indexedChoice, choices);
      return indexedChoice;
    }

    const marked = choices.find((choice) => choice.classList.contains(selectedReactionClass));
    const focused = document.activeElement;
    const focusedChoice = choices.find((choice) => choice === focused || choice.contains(focused));
    const choice = marked || focusedChoice || choices[0];
    rememberReactionChoice(choice, choices);
    return choice;
  }

  function cancelReactionSearchFocus() {
    reactionSearchFocusSerial += 1;
    reactionSearchFocusUntil = 0;
  }

  function focusReactionChoice(choice: HTMLElement | null | undefined): boolean {
    if (!(choice instanceof HTMLElement) || !choice.isConnected) return false;
    cancelReactionSearchFocus();
    clearReactionMarker();
    rememberReactionChoice(choice, reactionChoices(reactionPicker()));
    messageOverlayKind = "reaction";
    choice.classList.add(selectedReactionClass);
    if (!choice.matches("button, input, select, textarea, [tabindex]")) {
      choice.setAttribute("tabindex", "-1");
    }
    choice.scrollIntoView({ block: "nearest", inline: "nearest" });
    choice.focus({ preventScroll: true });
    setMode("message", { focus: false });
    return true;
  }

  function focusReactionSearch(picker: Element | null = reactionPicker()): boolean {
    const editor = reactionSearchEditor(picker);
    if (!(editor instanceof HTMLElement)) {
      flash("The full emoji search is not available");
      return false;
    }
    clearReactionFocus();
    normalModeLockUntil = 0;
    messageModeLockUntil = 0;
    messageOverlayKind = "reaction";
    setMode("insert", { focus: false });
    const focusSerial = ++reactionSearchFocusSerial;
    reactionSearchFocusUntil = performance.now() + 900;
    const restoreSearchFocus = () => {
      if (
        focusSerial !== reactionSearchFocusSerial ||
        messageOverlayKind !== "reaction" ||
        performance.now() > reactionSearchFocusUntil
      ) return;
      const currentPicker = reactionPicker();
      const currentEditor = reactionSearchEditor(currentPicker);
      if (!(currentEditor instanceof HTMLElement)) return;
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      if (document.activeElement !== currentEditor) {
        currentEditor.focus({ preventScroll: true });
      }
      setMode("insert", { focus: false });
    };
    restoreSearchFocus();
    for (const delay of [60, 160, 320, 640]) {
      setTimeout(restoreSearchFocus, delay);
    }
    return true;
  }

  function focusReactionGrid(picker: Element | null = reactionPicker()): boolean {
    const choices = reactionChoices(picker);
    const choice = currentReactionChoice(choices);
    if (focusReactionChoice(choice)) return true;
    flash("No emoji results are available");
    setMode("message", { focus: false });
    return false;
  }

  function reactionChoiceCenter(choice: HTMLElement) {
    const rect = choice.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function moveReactionFocus(direction: "left" | "right" | "up" | "down") {
    const picker = reactionPicker();
    const choices = reactionChoices(picker);
    if (!choices.length) {
      flash("No reaction choices are available");
      return;
    }

    const current = currentReactionChoice(choices);
    if (!current) return;
    const origin = reactionChoiceCenter(current);
    const horizontal = direction === "left" || direction === "right";
    const sign = direction === "left" || direction === "up" ? -1 : 1;

    const ranked = choices
      .filter((choice) => choice !== current)
      .map((choice) => {
        const center = reactionChoiceCenter(choice);
        const primaryDelta = horizontal ? center.x - origin.x : center.y - origin.y;
        const crossDelta = horizontal ? center.y - origin.y : center.x - origin.x;
        return {
          choice,
          primary: primaryDelta * sign,
          score: Math.abs(primaryDelta) + Math.abs(crossDelta) * 2,
        };
      })
      .filter(({ primary }) => primary > 1)
      .sort((left, right) => left.score - right.score);

    let target = ranked[0]?.choice;
    if (!target && !horizontal) {
      // WhatsApp's quick reactions form one horizontal row. Let j/k remain
      // useful there while retaining true vertical movement in the full grid.
      const index = choices.indexOf(current);
      target = choices[index + sign];
    }
    if (target) focusReactionChoice(target);
  }

  async function chooseFocusedReaction() {
    const picker = reactionPicker();
    const choices = reactionChoices(picker);
    const choice = currentReactionChoice(choices);
    if (!(choice instanceof HTMLElement) || !triggerMouse(choice)) {
      flash("No reaction choice is selected");
      return;
    }

    const expectsFullPicker = choices.length <= 12 && choice === choices.at(-1);
    const transitionStarted = performance.now();
    const outcome = await waitForValue(() => {
      const nextPicker = reactionPicker();
      if (!nextPicker) {
        if (expectsFullPicker && performance.now() - transitionStarted < 500) return null;
        return { closed: true };
      }
      const search = reactionSearchEditor(nextPicker);
      return search ? { picker: nextPicker, search } : null;
    }, 650);
    if (outcome?.search) {
      focusReactionSearch(outcome.picker);
      flash("Type to search; Esc enters the emoji grid; / returns to search");
      return;
    }

    const nextPicker = reactionPicker();
    if (outcome?.closed || !nextPicker) {
      clearReactionFocus();
      messageOverlayKind = "";
      keepMessageFocus();
      return;
    }

    const nextChoices = reactionChoices(nextPicker);
    const nextChoice = currentReactionChoice(nextChoices);
    if (nextChoice) focusReactionChoice(nextChoice);
  }

  async function closeReactionPicker() {
    const closeSerial = ++messageOverlayCloseSerial;
    const picker = reactionPicker();
    messageOverlayKind = "";
    cancelReactionSearchFocus();
    clearReactionFocus();
    if (!picker) {
      keepMessageFocus();
      return;
    }
    const row = selectedMessageRow();
    const message = await revealMessageControls(row);
    const button = message?.querySelector('[data-testid="reaction-entry-point"]');
    if (button instanceof HTMLElement) triggerMouse(button);
    await wait(80);
    if (closeSerial === messageOverlayCloseSerial) keepMessageFocus();
  }

  async function reactToSelectedMessage(intent: number) {
    const row = selectedMessageRow();
    const message = await revealMessageControls(row);
    if (!message) {
      flash("Select a message first");
      return;
    }

    const direct = message.querySelector('[data-testid="reaction-entry-point"]');
    if (direct instanceof HTMLElement) triggerMouse(direct);
    else if (!await chooseMessageMenuAction("react", "This message cannot be reacted to", intent)) return;

    const picker = await waitForValue(reactionPicker);
    if (!picker) {
      flash("WhatsApp did not open the reaction picker");
      return;
    }
    messageOverlayKind = "reaction";
    const firstChoice = reactionChoices(picker)[0];
    if (!focusReactionChoice(firstChoice)) setMode("message", { focus: false });
  }

  function messageMediaTarget(message: HTMLElement): HTMLElement | null {
    const labelled = [...message.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
      .find((element) => {
        const label = element.getAttribute("aria-label") || "";
        return isVisible(element) && /(open|view|play).*(image|photo|video|gif|audio|voice|document|media)|^(play|open|view)\b/i.test(label);
      });
    if (labelled instanceof HTMLElement) return labelled;

    const visual = [...message.querySelectorAll("video, img")].find((element) => {
      if (element.closest('[data-testid="selectable-text"], [data-testid="quoted-message"]')) return false;
      const rect = element.getBoundingClientRect();
      return isVisible(element) && rect.width >= 48 && rect.height >= 48;
    });
    if (visual instanceof HTMLElement) return visual;

    const tested = [...message.querySelectorAll("[data-testid]")].find((element) => {
      const testid = element.getAttribute("data-testid") || "";
      return isVisible(element) && /(image|photo|video|gif|audio|document|sticker|media|view-once)/i.test(testid);
    });
    return tested instanceof HTMLElement ? tested : null;
  }

  function messageReadMoreControl(message: Element | null): Element | null {
    if (!(message instanceof Element)) return null;
    const candidates = [...message.querySelectorAll([
      '[data-testid*="read-more" i]',
      '[data-testid*="expand" i]',
      "button",
      '[role="button"]',
    ].join(", "))];
    return candidates.find((control) => {
      if (!isVisible(control)) return false;
      const testid = control.getAttribute("data-testid") || "";
      if (/(?:read[-_]?more|expand)/i.test(testid)) return true;
      const label = normalizedText(control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent);
      return /^(?:read|show) more$|^expand(?:\s|$)/.test(label);
    }) || null;
  }

  function expandSelectedMessage() {
    const control = messageReadMoreControl(messageContainer(selectedMessageRow()));
    return control instanceof HTMLElement && triggerMouse(control);
  }

  async function openSelectedMessageMedia(options: MediaOptions = {}): Promise<boolean> {
    if (options.intent !== undefined && !commandIntentIsCurrent(options.intent)) return false;
    const selectMessagePaneWhenUnavailable = options.selectMessagePaneWhenUnavailable === true;
    const row = selectedMessageRow();
    captureMediaReturn(row);
    const message = await revealMessageControls(row);
    if (options.intent !== undefined && !commandIntentIsCurrent(options.intent)) return false;
    const target = message && messageMediaTarget(message);
    if (!target) {
      finishMediaClose();
      if (selectMessagePaneWhenUnavailable && options.intent !== undefined) return selectMessagePane(options.intent);
      flash("The selected message has no openable media");
      return false;
    }
    if (!triggerMouse(target)) {
      finishMediaClose();
      if (selectMessagePaneWhenUnavailable && options.intent !== undefined) return selectMessagePane(options.intent);
      flash("The selected message has no openable media");
      return false;
    }
    if (options.intent !== undefined && !commandIntentIsCurrent(options.intent)) return false;
    messageOverlayKind = "media";
    setMode("message", { focus: false });
    return true;
  }

  function captureMediaReturn(row: HTMLElement | null = selectedMessageRow()) {
    clearMediaReturn();
    if (!(row instanceof HTMLElement)) return;
    const scroller = messageScroller(row);
    mediaReturnRow = row;
    mediaReturnKey = messageKey(row);
    mediaReturnScroller = scroller;
    mediaReturnScrollTop = scroller?.scrollTop ?? null;
    mediaReturnScrollLeft = scroller?.scrollLeft ?? null;
  }

  function mediaReturnMessageRow() {
    if (mediaReturnRow?.isConnected && messageContainer(mediaReturnRow)) return mediaReturnRow;
    if (mediaReturnKey) {
      return messageRows().find((row) => messageKey(row) === mediaReturnKey) || null;
    }
    return null;
  }

  function finishMediaClose() {
    messageOverlayKind = "";
    const restored = mediaReturnMessageRow() || selectedMessageRow();
    const returnKey = mediaReturnKey || messageKey(restored);
    const scroller = mediaReturnScroller?.isConnected
      ? mediaReturnScroller
      : messageScroller(restored);
    const scrollTop = mediaReturnScrollTop;
    const scrollLeft = mediaReturnScrollLeft;
    const restoreSerial = ++mediaRestoreSerial;

    mediaReturnRow = null;
    mediaReturnKey = "";
    mediaReturnScroller = null;
    mediaReturnScrollTop = null;
    mediaReturnScrollLeft = null;

    if (restored && !restored.classList.contains(selectedMessageClass)) {
      selectMessage(restored, { scroll: false });
    } else {
      keepMessageFocus();
    }

    if (!(scroller instanceof HTMLElement) || scrollTop === null) return;
    const restoreScroll = () => {
      if (
        mediaRestoreSerial !== restoreSerial ||
        mode !== "message" ||
        mediaViewer() ||
        (returnKey && activeMessageKey !== returnKey)
      ) return;
      scroller.scrollTop = scrollTop;
      if (scrollLeft !== null) scroller.scrollLeft = scrollLeft;
    };
    for (const delay of [0, 80, 200]) setTimeout(restoreScroll, delay);
  }

  function mediaViewer() {
    const explicit = [...document.querySelectorAll([
      '[data-testid="media-viewer-modal"]',
      '[data-testid="media-viewer"]',
    ].join(", "))].find(isVisible);
    if (explicit instanceof HTMLElement) return explicit;

    const media = [...document.querySelectorAll([
      '[data-testid="media-zoomable"]',
      '[data-testid="media-image"]',
    ].join(", "))].find(isVisible);
    const fallback = media?.closest('[data-testid*="media-viewer" i], [role="dialog"]');
    return fallback instanceof HTMLElement && isVisible(fallback) ? fallback : null;
  }

  function mediaViewerCloseControl(viewer: Element | null): HTMLElement | null {
    if (!(viewer instanceof Element)) return null;
    const labelled = [...viewer.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
      .find((button) => (
        isVisible(button) && /^(close|cancel)(?:\s|$)/i.test(button.getAttribute("aria-label") || "")
      ));
    if (labelled instanceof HTMLElement) return labelled;

    const icon = [...viewer.querySelectorAll([
      '[data-testid*="close" i]',
      '[data-icon="x"]',
      '[data-icon*="close" i]',
    ].join(", "))].find(isVisible);
    const control = icon?.closest("button, [role=\"button\"]") || icon;
    return control instanceof HTMLElement && isVisible(control) ? control : null;
  }

  function mediaViewerNavigationControl(viewer: Element | null, direction: number): HTMLElement | null {
    if (!(viewer instanceof Element)) return null;
    const expression = direction < 0
      ? /(?:^|[\s_-])(?:previous|prev)(?:[\s_-]|$)|(?:arrow|chevron)[\s_-]*left|left[\s_-]*(?:arrow|chevron)/i
      : /(?:^|[\s_-])next(?:[\s_-]|$)|(?:arrow|chevron)[\s_-]*right|right[\s_-]*(?:arrow|chevron)/i;
    return [...viewer.querySelectorAll<HTMLElement>([
      "button:not([disabled])",
      '[role="button"]:not([aria-disabled="true"])',
    ].join(", "))].find((control) => {
      if (!(control instanceof HTMLElement) || !isVisible(control)) return false;
      const descendants = [...control.querySelectorAll("[data-icon], [data-testid]")];
      const signature = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.getAttribute("data-icon"),
        control.getAttribute("data-testid"),
        ...descendants.flatMap((element) => [
          element.getAttribute("data-icon"),
          element.getAttribute("data-testid"),
        ]),
      ].filter(Boolean).join(" ");
      return expression.test(signature);
    }) || null;
  }

  function dispatchMediaArrow(viewer: Element | null, direction: number): boolean {
    if (!(viewer instanceof Element)) return false;
    const key = direction < 0 ? "ArrowLeft" : "ArrowRight";
    const init = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    viewer.dispatchEvent(new KeyboardEvent("keydown", init));
    viewer.dispatchEvent(new KeyboardEvent("keyup", init));
    return true;
  }

  async function navigateMediaOverlay(direction: number): Promise<boolean> {
    normalModeLockUntil = 0;
    messageModeLockUntil = performance.now() + 500;
    messageOverlayKind = "media";
    setMode("message", { focus: false });

    const viewer = mediaViewer() || await waitForValue(mediaViewer, 500);
    if (!viewer) {
      finishMediaClose();
      flash("WhatsApp's media viewer is no longer open");
      return false;
    }

    const control = mediaViewerNavigationControl(viewer, direction);
    if (control instanceof HTMLElement && triggerMouse(control)) return true;
    return dispatchMediaArrow(viewer, direction);
  }

  async function closeMediaOverlay() {
    const viewer = mediaViewer();
    if (!viewer) {
      finishMediaClose();
      return true;
    }

    const close = mediaViewerCloseControl(viewer);
    if (!close || !triggerMouse(close)) {
      flash("WhatsApp's media viewer could not be closed");
      keepMessageFocus();
      return false;
    }

    const closed = await waitForValue(() => mediaViewer() ? null : true, 700);
    if (!closed) {
      messageOverlayKind = "media";
      flash("WhatsApp's media viewer is still open");
      keepMessageFocus();
      return false;
    }

    finishMediaClose();
    return true;
  }

  function composer() {
    const selectors = [
      '#main footer [contenteditable="true"][role="textbox"]',
      '#main [contenteditable="true"][role="textbox"]',
      '#main [contenteditable="true"][data-tab]',
      "#main textarea",
    ];
    for (const selector of selectors) {
      const match = [...document.querySelectorAll(selector)].find(isVisible);
      if (match instanceof HTMLElement) return match;
    }
    return null;
  }

  function focusComposer(options: ComposerOptions = {}): HTMLElement | null {
    cancelChatNavigation();
    if (options.intent !== undefined && !commandIntentIsCurrent(options.intent)) return null;
    const editor = composer();
    if (!editor) {
      if (pendingChatActivation && !options.retrying) {
        pendingChatActivation.then(() => {
          if (options.intent !== undefined && !commandIntentIsCurrent(options.intent)) return;
          if (!focusComposer({ ...options, retrying: true, announce: false }) && options.announce !== false) {
            flash("Open a chat before entering Insert mode");
          }
        });
        return null;
      }
      if (options.announce !== false) flash("Open a chat before entering Insert mode");
      return null;
    }
    normalModeLockUntil = 0;
    messageModeLockUntil = 0;
    editor.focus({ preventScroll: true });
    setMode("insert", { focus: false });
    return editor;
  }

  function composeFromMessageMode(intent: number) {
    const row = selectedMessageRow();
    if (!row) {
      focusComposer({ intent });
      return;
    }

    captureMessageReturn(row);
    if (!focusComposer({ intent }) && commandIntentIsCurrent(intent)) clearMessageReturn();
  }

  async function composeAtLatestMessage() {
    const rows = messageRows();
    const current = selectedMessageRow() || rows.at(-1);
    const initialScroller = messageScroller(current);

    // WhatsApp virtualizes long chats. Wait for the scroll boundary instead of
    // assuming a fixed render delay, then perform one bounded second pass.
    if (initialScroller) {
      initialScroller.scrollTop = initialScroller.scrollHeight;
      await waitForPredicate(() => (
        initialScroller.scrollTop >= initialScroller.scrollHeight - initialScroller.clientHeight - 1
      ) ? true : null, { root: initialScroller, timeout: 700, poll: true });
      const renderedLatest = messageRows().at(-1);
      const latestScroller = messageScroller(renderedLatest) || initialScroller;
      latestScroller.scrollTop = latestScroller.scrollHeight;
      await waitForPredicate(() => (
        latestScroller.scrollTop >= latestScroller.scrollHeight - latestScroller.clientHeight - 1
      ) ? true : null, { root: latestScroller, timeout: 700, poll: true });
    }

    const latest = messageRows().at(-1) || current;
    if (!latest || !selectMessage(latest, { scroll: false, mode: false })) {
      clearMessageReturn();
      focusComposer();
      return;
    }

    captureMessageReturn(latest);
    if (!focusComposer()) clearMessageReturn();
  }

  function popupSearchEditor() {
    const selectors = [
      '[role="dialog"] [data-testid="chat-list-search-container"] input[role="textbox"]',
      '[role="dialog"] [data-testid="chat-list-search-container"] input[aria-label]',
      '[role="dialog"] [data-testid="chat-list-search-container"] input[placeholder]',
      '[role="dialog"] [data-testid="chat-list-search-container"] [contenteditable="true"][role="textbox"]',
    ];
    for (const selector of selectors) {
      const match = [...document.querySelectorAll(selector)].find(isVisible);
      if (match instanceof HTMLElement) return match;
    }
    return null;
  }

  function popupSearchDialog() {
    const editor = popupSearchEditor();
    if (!isPopupSearchEditor(editor)) return null;
    const dialog = editor.closest('[role="dialog"]');
    return dialog instanceof HTMLElement && isVisible(dialog) ? dialog : null;
  }

  function isPopupSearchContext(element: EventTarget | null): boolean {
    const dialog = popupSearchDialog();
    return element instanceof Element && Boolean(dialog?.contains(element));
  }

  function focusSearch(intent: number) {
    cancelChatNavigation();
    if (!commandIntentIsCurrent(intent)) return;
    normalModeLockUntil = 0;

    // Run WhatsApp's own extended-search shortcut after the `/` keydown has
    // finished. This preserves its popup UI without inserting `/` into it.
    setTimeout(() => {
      if (!commandIntentIsCurrent(intent)) return;
      dispatchWhatsAppShortcut({ key: "k", code: "KeyK", altKey: true });

      const focusWhenReady = (attempt = 0) => {
        if (!commandIntentIsCurrent(intent)) return;
        if (isPopupSearchEditor(document.activeElement)) {
          setMode("insert", { focus: false });
          return;
        }

        const editor = popupSearchEditor();
        if (editor) {
          editor.focus({ preventScroll: true });
          setMode("insert", { focus: false });
          return;
        }

        if (attempt < 30) {
          setTimeout(() => focusWhenReady(attempt + 1), 50);
          return;
        }

        flash("WhatsApp search is not available");
        setMode("normal");
      };

      focusWhenReady();
    }, 0);
  }

  function isPopupSearchEditor(element: EventTarget | null): element is Element {
    return Boolean(
      element instanceof Element &&
      isEditable(element) &&
      element.closest('[role="dialog"]') &&
      element.closest('[data-testid="chat-list-search-container"]')
    );
  }

  function isSidebarSearchEditor(element: EventTarget | null): element is Element {
    return Boolean(
      element instanceof Element &&
      isEditable(element) &&
      element.closest("#side") &&
      element.closest('[data-testid="chat-list-search-container"]')
    );
  }

  function clearSearchEditor(editor: HTMLElement | null | undefined) {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      const prototype = editor instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter && editor.value) {
        setter.call(editor, "");
        editor.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
          data: null,
          inputType: "deleteContentBackward",
        }));
      }
      return;
    }

    if (editor instanceof HTMLElement && editor.isContentEditable && editor.textContent) {
      editor.textContent = "";
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
        data: null,
        inputType: "deleteContentBackward",
      }));
    }
  }

  function messageReturnRow(row: HTMLElement | null = messageModeReturnRow, key = messageModeReturnKey): HTMLElement | null {
    if (row?.isConnected && messageContainer(row)) {
      return row;
    }
    if (key) {
      return messageRows().find((candidate) => messageKey(candidate) === key) || null;
    }
    return null;
  }

  async function cancelMessageComposerAction() {
    const editModal = [...document.querySelectorAll('[data-testid="edit-message-modal"]')].find(isVisible);
    if (editModal) {
      const close = [...editModal.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
        .find((button) => /^(close|cancel)(?:\s|$)/i.test(button.getAttribute("aria-label") || ""));
      if (close instanceof HTMLElement) triggerMouse(close);
    } else if (replyComposerOpen()) {
      const cancel = [...document.querySelectorAll('#main button[aria-label], #main [role="button"][aria-label]')]
        .find((button) => isVisible(button) && /cancel/i.test(button.getAttribute("aria-label") || ""));
      if (cancel instanceof HTMLElement) triggerMouse(cancel);
    }
    await wait(100);
  }

  async function restoreMessageMode() {
    const editor = document.activeElement;
    const returnRow = messageModeReturnRow;
    const returnKey = messageModeReturnKey;
    const restoreSerial = ++messageReturnRestoreSerial;
    pendingMessageReturnRestore = restoreSerial;
    await cancelMessageComposerAction();
    if (restoreSerial !== messageReturnRestoreSerial) {
      if (pendingMessageReturnRestore === restoreSerial) pendingMessageReturnRestore = 0;
      return;
    }
    if (isEditable(editor) && editor instanceof HTMLElement && editor.isConnected && document.activeElement === editor) editor.blur();
    const row = await waitForPredicate(() => (
      restoreSerial === messageReturnRestoreSerial
        ? messageReturnRow(returnRow, returnKey)
        : null
    ), { root: document.body, timeout: 700, poll: true });
    if (restoreSerial !== messageReturnRestoreSerial) {
      if (pendingMessageReturnRestore === restoreSerial) pendingMessageReturnRestore = 0;
      return;
    }
    if (pendingMessageReturnRestore === restoreSerial) pendingMessageReturnRestore = 0;
    clearMessageReturn();
    if (row && selectMessage(row)) {
      keepMessageFocus();
      return;
    }
    enterMessageMode();
    if (mode === "message") keepMessageFocus();
  }

  async function leaveInsertOrClosePane() {
    if (messageModeReturnRow || messageModeReturnKey) {
      await restoreMessageMode();
      return;
    }

    if (isEditable(document.activeElement) && document.activeElement instanceof HTMLElement) {
      const editor = document.activeElement;
      const popupSearch = isPopupSearchEditor(editor);
      if (isSidebarSearchEditor(editor)) clearSearchEditor(editor);
      editor.blur();
      if (popupSearch) dispatchWhatsAppShortcut({ key: "Escape", code: "Escape" });
      setMode("normal");
      return;
    }
    clearChatSelection();
    clearMessageSelection();
    clearMessageReturn();
    dispatchWhatsAppShortcut({ key: "Escape", code: "Escape" });
    setMode("normal");
  }

  async function leaveMessageModeOrCloseOverlay() {
    if (mediaViewer() || messageOverlayKind === "media") {
      await closeMediaOverlay();
      return;
    }
    if (reactionPicker() || messageOverlayKind === "reaction") {
      await closeReactionPicker();
      return;
    }
    messageOverlayCloseSerial += 1;
    clearMessageSelection();
    clearMessageReturn();
    setMode("normal");
  }

  function execute(action: WhatsVimAction, intent: number) {
    switch (action) {
      case "next-chat":
        setActivePane("chat", { announce: false });
        navigateChat(1);
        break;
      case "previous-chat":
        setActivePane("chat", { announce: false });
        navigateChat(-1);
        break;
      case "first-chat":
        setActivePane("chat", { announce: false });
        selectBoundaryChat("first");
        break;
      case "last-chat":
        setActivePane("chat", { announce: false });
        selectBoundaryChat("last");
        break;
      case "select-chat-pane":
        if (setActivePane("chat") && mode === "message") keepNormalFocus();
        break;
      case "select-message-pane":
        selectMessagePane(intent);
        break;
      case "open-message-media-or-select-message-pane":
        openSelectedMessageMedia({ intent, selectMessagePaneWhenUnavailable: true });
        break;
      case "escape":
        cancelChatNavigation();
        if (mode === "message") leaveMessageModeOrCloseOverlay();
        else leaveInsertOrClosePane();
        break;
      case "compose":
        focusComposer({ intent });
        break;
      case "next-message":
        setActivePane("message", { announce: false });
        navigateMessage(1);
        break;
      case "previous-message":
        setActivePane("message", { announce: false });
        navigateMessage(-1);
        break;
      case "reply-message":
        replyToSelectedMessage(intent);
        break;
      case "edit-message":
        editSelectedMessage(intent);
        break;
      case "compose-from-message":
        composeFromMessageMode(intent);
        break;
      case "compose-at-latest-message":
        composeAtLatestMessage();
        break;
      case "react-message":
        reactToSelectedMessage(intent);
        break;
      case "reaction-left":
        moveReactionFocus("left");
        break;
      case "reaction-down":
        moveReactionFocus("down");
        break;
      case "reaction-up":
        moveReactionFocus("up");
        break;
      case "reaction-right":
        moveReactionFocus("right");
        break;
      case "choose-reaction":
        chooseFocusedReaction();
        break;
      case "reaction-search":
        focusReactionSearch();
        break;
      case "media-previous":
        navigateMediaOverlay(-1);
        break;
      case "media-next":
        navigateMediaOverlay(1);
        break;
      case "open-message-media":
        openSelectedMessageMedia({ intent });
        break;
      case "expand-message":
        expandSelectedMessage();
        break;
      case "search":
        focusSearch(intent);
        break;
      case "help":
        setHelpOpen(!helpOpen);
        break;
      default:
        break;
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!event.isTrusted) return;

    if (ownedCompositionEnter && event.key === "Enter") {
      consume(event);
      return;
    }

    if (helpOpen) {
      const closeHelpShortcut =
        event.key === "Escape" ||
        (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "[");
      if (closeHelpShortcut) {
        consume(event);
        setHelpOpen(false);
      }
      return;
    }

    const pasteShortcut =
      mode === "normal" &&
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key.toLowerCase() === "v";
    if (pasteShortcut) {
      const intent = beginCommandIntent();
      if (focusComposer({ announce: false, intent })) {
        // Leave the trusted event untouched. Chromium performs the paste after
        // keydown, using the composer we focused synchronously above.
        return;
      }
    }

    const targetIsEditable = isEditable(event.target);
    const targetInPopupSearch = isPopupSearchContext(event.target);
    const targetInReactionSearch = isReactionSearchContext(event.target);
    const targetInReactionPicker = event.target instanceof Node && reactionPicker()?.contains(event.target) === true;
    const lockedMode = targetInPopupSearch || targetInReactionSearch
      ? null
      : lockedCommandMode();
    if (targetInReactionSearch) {
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      messageOverlayKind = "reaction";
      if (mode !== "insert") setMode("insert", { focus: false });
    } else if (targetInPopupSearch && mode !== "insert") {
      setMode("insert", { focus: false });
    } else if (targetIsEditable && lockedMode) {
      // WhatsApp can synchronously reclaim the composer while j/k is moving
      // through chats or messages. A second queued keydown must stay in the
      // command mode that initiated navigation instead of becoming text.
      setMode(lockedMode, { focus: false });
      setTimeout(focusSentinel, 0);
    } else if (targetIsEditable && mode !== "insert") {
      setMode("insert", { focus: false });
    }
    if (!targetIsEditable && targetInReactionPicker && mode === "insert") {
      setMode("message", { focus: false });
    } else if (
      !targetIsEditable &&
      !targetInPopupSearch &&
      document.activeElement !== sentinel &&
      mode === "insert"
    ) {
      setMode("normal", { focus: false });
    }

    const decision = resolveKey(event, {
      mode,
      pendingG,
      activePane,
      reactionOpen: mode === "message" && Boolean(reactionPicker()),
      mediaOpen: mode === "message" && (messageOverlayKind === "media" || Boolean(mediaViewer())),
    });
    pendingG = decision.pendingG;
    clearTimeout(pendingGTimer);
    if (pendingG) {
      pendingGTimer = setTimeout(() => {
        pendingG = false;
      }, 700);
    }

    if (!decision.action) return;

    if (suppressDuplicatePaneNavigation(event, decision.action)) {
      consume(event);
      return;
    }

    if (
      decision.action === "escape" &&
      mode === "insert" &&
      targetInReactionSearch
    ) {
      // In the full picker, Escape changes from search/typing to Vim grid
      // navigation. A subsequent Escape in Normal mode closes the picker.
      beginCommandIntent();
      consume(event);
      focusReactionGrid();
      return;
    }

    if (
      decision.action === "escape" &&
      mode === "insert" &&
      isPopupSearchContext(event.target)
    ) {
      // Close the popup while it still owns focus, then stop the physical key
      // before Vimium can consume it or WhatsApp can also collapse the sidebar.
      beginCommandIntent();
      consume(event);
      dispatchWhatsAppShortcut({ key: "Escape", code: "Escape" });
      setMode("normal", { focus: false });
      setTimeout(focusSentinel, 100);
      return;
    }

    consume(event);
    if (decision.action !== "await-g") {
      const intent = beginCommandIntent();
      if (event.key === "Enter" && (decision.action === "compose" || decision.action === "compose-from-message")) {
        ownedCompositionEnter = true;
      }
      execute(decision.action, intent);
    }
  }

  function onPointerUp(event: PointerEvent) {
    // A user pointer action during the bounded cancellation wait has chosen a
    // new context. Do not let the delayed keyed restore steal focus back.
    if (pendingMessageReturnRestore) {
      clearMessageReturn();
      pendingMessageReturnRestore = 0;
    }
    const target = event.composedPath?.()[0] || event.target;
    beginCommandIntent();
    const row = chatRow(target);
    if (row) {
      cancelChatNavigation();
      activeChatRow = row;
      selectChatRow(row);
      setActivePane("chat", { announce: false });
      clearMessageSelection();
      clearMessageReturn();
      keepNormalFocus();
      return;
    }
    if (isReactionSearchContext(target)) {
      cancelChatNavigation();
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      messageOverlayKind = "reaction";
      setMode("insert", { focus: false });
      return;
    }
    if (isEditable(target)) {
      cancelChatNavigation();
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      if (mode === "message") {
        captureMessageReturn(selectedMessageRow());
      }
      setMode("insert", { focus: false });
      return;
    }
    if (target instanceof Element && target.closest(`#${ids.helpPanel}`)) return;
    if (mode === "message" && target instanceof Element) {
      const viewer = mediaViewer();
      if (viewer?.contains(target)) {
        if (!mediaReturnRow && !mediaReturnKey) captureMediaReturn();
        messageOverlayKind = "media";
        setMode("message", { focus: false });
        setTimeout(() => {
          if (!mediaViewer() && messageOverlayKind === "media") {
            finishMediaClose();
          }
        }, 100);
        return;
      }
      const row = messageRow(target);
      if (row) {
        selectMessage(row, { mode: false, scroll: false });
        setMode("message", { focus: false });
        return;
      }
      if (target.closest('[role="dialog"], [role="menu"], [role="grid"]')) {
        setMode("message", { focus: false });
        setTimeout(() => {
          if (!reactionPicker() && messageOverlayKind === "reaction") {
            clearReactionFocus();
            messageOverlayKind = "";
            keepMessageFocus();
          }
        }, 100);
        return;
      }
    }
    if (mode === "message") {
      clearMessageSelection();
      clearMessageReturn();
    }
    setMode("normal");
  }

  function onKeyUp(event: KeyboardEvent) {
    if (ownedCompositionEnter && event.key === "Enter") {
      ownedCompositionEnter = false;
      consume(event);
    }
    heldPaneNavigationKeys.delete(event.code || event.key);
  }

  function initialize() {
    if (!mountUi()) return;
    setActivePane("chat", { announce: false }) || setActivePane("message", { announce: false });
    setMode(isEditable(document.activeElement) ? "insert" : "normal");
  }

  globalThis.addEventListener("keydown", onKeyDown, true);
  globalThis.addEventListener("keyup", onKeyUp, true);
  globalThis.addEventListener("blur", () => {
    heldPaneNavigationKeys.clear();
    ownedCompositionEnter = false;
    cancelChatNavigation();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      heldPaneNavigationKeys.clear();
      ownedCompositionEnter = false;
      cancelChatNavigation();
    }
  });
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("focusin", (event) => {
    if (event.target === sentinel) {
      setMode(mode === "message" ? "message" : "normal", { focus: false });
    } else if (isReactionSearchContext(event.target)) {
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      messageOverlayKind = "reaction";
      setMode("insert", { focus: false });
    } else if (isPopupSearchContext(event.target)) {
      normalModeLockUntil = 0;
      messageModeLockUntil = 0;
      setMode("insert", { focus: false });
    } else if (event.target instanceof Node && reactionPicker()?.contains(event.target)) {
      setMode("message", { focus: false });
    } else if (isEditable(event.target)) {
      if (performance.now() < messageModeLockUntil) {
        setMode("message", { focus: false });
        setTimeout(focusSentinel, 0);
      } else if (performance.now() < normalModeLockUntil) {
        setMode("normal", { focus: false });
        setTimeout(focusSentinel, 0);
      } else {
        setMode("insert", { focus: false });
      }
    }
  }, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const preservingReactionSearch =
        messageOverlayKind === "reaction" &&
        Boolean(reactionPicker()) &&
        performance.now() <= reactionSearchFocusUntil;
      if (
        mode === "insert" &&
        !preservingReactionSearch &&
        !isEditable(document.activeElement) &&
        !isPopupSearchContext(document.activeElement)
      ) {
        setMode("normal");
      }
    }, 0);
  }, true);
  globalThis.addEventListener("focus", () => {
    if (mode !== "insert") setTimeout(focusSentinel, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
