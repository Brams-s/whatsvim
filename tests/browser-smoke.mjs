"use strict";

import assert from "node:assert/strict";

const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.url.includes("web.whatsapp.com"));
assert.ok(page, "WhatsApp test page is available through CDP");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
let extensionContextId = null;
let mainFrameId = null;
const navigationWaiters = [];
const extensionContextWaiters = [];
socket.addEventListener("message", (message) => {
  const payload = JSON.parse(message.data);
  if (payload.method === "Page.frameNavigated" && !payload.params.frame.parentId) {
    mainFrameId = payload.params.frame.id;
    extensionContextId = null;
    for (const resolve of navigationWaiters.splice(0)) resolve(mainFrameId);
    return;
  }
  if (payload.method === "Runtime.executionContextCreated") {
    const context = payload.params.context;
    if (
      context.auxData?.type === "isolated" &&
      context.origin.startsWith("chrome-extension://") &&
      context.name === "WhatsVim" &&
      context.auxData.frameId === mainFrameId
    ) {
      extensionContextId = context.id;
      for (const resolve of extensionContextWaiters.splice(0)) resolve(extensionContextId);
    }
    return;
  }
  const handler = pending.get(payload.id);
  if (!handler) return;
  pending.delete(payload.id);
  if (payload.error) handler.reject(new Error(payload.error.message));
  else handler.resolve(payload.result);
});

function call(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function waitForEvent(waiters, description, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const waiter = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`Timed out waiting for: ${description}`));
    }, timeout);
    waiters.push(waiter);
  });
}

function waitForMainFrameNavigation() {
  return waitForEvent(navigationWaiters, "the reloaded WhatsApp main frame");
}

function waitForExtensionContext() {
  if (extensionContextId !== null) return Promise.resolve(extensionContextId);
  return waitForEvent(extensionContextWaiters, "the WhatsVim extension context for the reloaded target");
}

async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || "Runtime.evaluate failed");
  }
  return response.result.value;
}

async function evaluateInExtension(expression) {
  assert.notEqual(extensionContextId, null, "WhatsVim content-script execution context is available");
  const response = await call("Runtime.evaluate", {
    expression,
    contextId: extensionContextId,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || "Extension Runtime.evaluate failed");
  }
  return response.result.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function press({
  key,
  code,
  virtualKeyCode,
  modifiers = 0,
  text = "",
}) {
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
    text,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await delay(150);
}

async function pressWithDuplicateKeyDowns({
  key,
  code,
  virtualKeyCode,
  modifiers = 0,
  text = "",
  duplicateCount = 8,
}) {
  for (let index = 0; index < duplicateCount; index += 1) {
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
      text,
    });
  }
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await delay(150);
}

async function pressWithRepeatKeyDowns({
  key,
  code,
  virtualKeyCode,
  modifiers = 0,
  text = "",
  repeatCount = 1,
}) {
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
    text,
  });
  for (let index = 0; index < repeatCount; index += 1) {
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers,
      text,
      autoRepeat: true,
    });
  }
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    modifiers,
  });
  await delay(150);
}

await call("Runtime.enable");
await call("Page.enable");
await call("Page.bringToFront");
// Runtime.enable can report an already-loaded target's execution contexts
// before this listener is ready. Reload this dedicated smoke target after both
// domains are enabled, then require the extension context for that document.
const navigation = waitForMainFrameNavigation();
await call("Page.reload", { ignoreCache: true });
await navigation;
await waitForExtensionContext();
assert.notEqual(extensionContextId, null, "WhatsVim content script is loaded for the reloaded target");
await waitFor('document.querySelector("#whatsvim-sentinel") !== null', 10000);
await call("Page.stopLoading");
await evaluate(`(() => {
  document.querySelector("#app")?.remove();
  document.querySelector("#whatsvim-test-fixture")?.remove();

  const fixture = document.createElement("div");
  fixture.id = "whatsvim-test-fixture";
  fixture.innerHTML = \`
    <section id="side" style="display:block;width:320px;height:500px">
      <input id="test-search" type="search" style="display:block;width:200px;height:30px">
      <div id="pane-side" style="display:block;width:300px;height:400px;overflow:auto">
        <div id="chat-alpha" role="row" data-testid="list-item-0" style="display:block;width:280px;height:50px"><div role="gridcell"><div data-testid="cell-frame-container"><span data-testid="cell-frame-title">Alpha</span></div></div></div>
        <div id="chat-bravo" role="row" data-testid="list-item-1" style="display:block;width:280px;height:50px"><div role="gridcell"><div data-testid="cell-frame-container"><span data-testid="cell-frame-title">Bravo</span></div></div></div>
        <div id="chat-charlie" role="row" data-testid="list-item-2" style="display:block;width:280px;height:50px"><div role="gridcell"><div data-testid="cell-frame-container"><span data-testid="cell-frame-title">Charlie</span></div></div></div>
      </div>
    </section>
    <section id="main" style="display:none;width:500px;height:500px">
      <header><span id="test-chat-title" data-testid="conversation-info-header-chat-title"></span></header>
      <div id="test-message-list" role="grid" style="display:block;width:480px;height:180px;overflow:auto">
        <div id="message-one" role="row" tabindex="-1" style="display:block;width:460px;height:70px"><div data-id="message-one"><div data-testid="msg-container" style="display:block;width:220px;height:50px">One</div></div></div>
        <div id="message-two" role="row" tabindex="-1" style="display:block;width:460px;height:70px"><div data-id="message-two"><div data-testid="msg-container" style="display:block;width:220px;height:50px">Two</div></div></div>
        <div id="message-media" role="row" tabindex="-1" style="display:block;width:460px;height:130px"><div data-id="message-media"><div data-testid="msg-container" style="display:block;width:220px;height:110px"><img id="test-media" alt="fixture" style="display:block;width:120px;height:90px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%238bd5ca'/%3E%3C/svg%3E"><button id="test-read-more" data-testid="read-more" aria-label="Read more" type="button">Read more</button></div></div></div>
      </div>
      <div id="test-reply-preview" data-testid="quoted-message" style="display:none;width:300px;height:30px"></div>
      <footer><div id="test-composer" role="textbox" contenteditable="true" style="display:block;width:300px;height:40px"></div></footer>
    </section>
    <section id="test-search-popup" role="dialog" style="display:none;width:300px;height:120px">
      <div data-testid="chat-list-search-container">
        <input id="test-popup-search" role="textbox" aria-label="Search chats" style="display:block;width:240px;height:30px">
      </div>
      <div id="test-popup-results" role="listbox">
        <button id="test-popup-result-one" type="button" role="option" tabindex="-1">Result one</button>
        <button id="test-popup-result-two" type="button" role="option" tabindex="-1">Result two</button>
      </div>
    </section>
    <div id="test-neutral" style="display:block;width:40px;height:40px">Neutral</div>
  \`;
  document.body.prepend(fixture);

  for (const row of fixture.querySelectorAll('[role="row"]')) {
    if (!row.querySelector('[data-testid="cell-frame-container"]')) continue;
    const cell = row.querySelector('[data-testid="cell-frame-container"]');
    cell.addEventListener("mousedown", () => {
      row.dataset.clicked = "true";
      row.dataset.clickCount = String(Number(row.dataset.clickCount || 0) + 1);
      const label = row.querySelector('[data-testid="cell-frame-title"]').textContent;
      const title = fixture.querySelector("#test-chat-title");
      title.textContent = label;
      fixture.querySelector("#main").style.display = "block";
      fixture.querySelector("#test-composer").focus();
    });
  }

  function mouseActionButton(attributes, label) {
    const button = document.createElement("div");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value);
    button.textContent = label;
    button.style.cssText = "display:inline-block;width:70px;height:24px";
    return button;
  }

  function closeMessageMenus() {
    document.querySelectorAll(".test-message-menu").forEach((menu) => menu.remove());
  }

  function openEditModal() {
    closeMessageMenus();
    const modal = document.createElement("div");
    modal.dataset.testid = "edit-message-modal";
    modal.setAttribute("role", "dialog");
    modal.style.cssText = "position:fixed;left:100px;top:100px;width:320px;height:160px;display:block";
    const close = document.createElement("button");
    close.setAttribute("aria-label", "Close");
    close.textContent = "Close";
    const editor = document.createElement("div");
    editor.dataset.testid = "edit-message-composer";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("contenteditable", "true");
    editor.style.cssText = "display:block;width:280px;height:60px";
    close.addEventListener("click", () => {
      modal.remove();
      fixture.querySelector("#test-composer").focus();
    });
    modal.append(close, editor);
    document.body.append(modal);
    editor.focus();
  }

  function openExpandedReactionPicker() {
    document.querySelector("#test-reaction-picker")?.remove();
    const dialog = document.createElement("div");
    dialog.id = "test-reaction-picker";
    dialog.setAttribute("role", "dialog");
    dialog.style.cssText = "position:fixed;left:100px;top:100px;width:220px;height:290px;display:block";
    const search = document.createElement("input");
    search.id = "test-reaction-search";
    search.setAttribute("role", "textbox");
    search.setAttribute("aria-label", "Search emoji");
    search.style.cssText = "display:block;width:200px;height:30px";
    const reactionRow = document.createElement("div");
    reactionRow.setAttribute("role", "toolbar");
    reactionRow.setAttribute("aria-label", "Reaction row");
    reactionRow.style.cssText = "display:grid;grid-template-columns:48px 48px 48px;gap:8px;width:160px;height:48px";
    for (let index = 0; index < 3; index += 1) {
      const choice = document.createElement("button");
      choice.id = \`test-reaction-row-\${index}\`;
      choice.setAttribute("aria-label", \`Reaction row emoji \${index + 1}\`);
      choice.textContent = \`row emoji \${index + 1}\`;
      choice.style.cssText = "display:block;width:48px;height:48px";
      choice.addEventListener("click", () => {
        fixture.dataset.selectedReaction = \`row-\${index}\`;
        dialog.remove();
      });
      reactionRow.append(choice);
    }
    const grid = document.createElement("div");
    grid.setAttribute("role", "grid");
    grid.style.cssText = "display:grid;grid-template-columns:48px 48px 48px;gap:8px;width:160px;height:104px";
    for (let index = 0; index < 6; index += 1) {
      const choice = document.createElement("button");
      choice.id = \`test-expanded-reaction-\${index}\`;
      choice.setAttribute("aria-label", \`Expanded emoji \${index + 1}\`);
      choice.textContent = \`emoji \${index + 1}\`;
      choice.style.cssText = "display:block;width:48px;height:48px";
      choice.addEventListener("click", () => {
        fixture.dataset.selectedReaction = \`expanded-\${index}\`;
        dialog.remove();
      });
      grid.append(choice);
    }
    dialog.append(search, reactionRow, grid);
    document.body.append(dialog);
    // WhatsApp replaces the search node while expanding the picker. Recreate
    // that focus race so the extension must follow the live replacement.
    setTimeout(() => {
      const current = dialog.querySelector("#test-reaction-search");
      if (!(current instanceof HTMLInputElement) || !dialog.isConnected) return;
      current.replaceWith(current.cloneNode(true));
    }, 40);
  }

  function toggleReactionPicker() {
    const existing = document.querySelector("#test-reaction-picker");
    if (existing) {
      existing.remove();
      return;
    }
    const dialog = document.createElement("div");
    dialog.id = "test-reaction-picker";
    dialog.setAttribute("role", "dialog");
    dialog.style.cssText = "position:fixed;left:100px;top:100px;width:140px;height:190px;display:block";
    const grid = document.createElement("div");
    grid.setAttribute("role", "grid");
    grid.style.cssText = "display:grid;grid-template-columns:48px 48px;gap:8px;width:104px;height:160px";
    for (let index = 0; index < 5; index += 1) {
      const choice = document.createElement("button");
      choice.id = \`test-reaction-\${index}\`;
      const more = index === 4;
      choice.setAttribute("aria-label", more ? "More reactions" : \`React with option \${index + 1}\`);
      choice.textContent = more ? "+" : \`emoji \${index + 1}\`;
      choice.style.cssText = "display:block;width:48px;height:48px";
      choice.addEventListener("click", () => {
        if (more) {
          openExpandedReactionPicker();
          return;
        }
        fixture.dataset.selectedReaction = String(index);
        dialog.remove();
      });
      grid.append(choice);
    }
    dialog.append(grid);
    document.body.append(dialog);
  }

  function openMessageMenu(container) {
    const existing = document.querySelector(".test-message-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const menu = document.createElement("div");
    menu.className = "test-message-menu";
    menu.setAttribute("role", "menu");
    menu.style.cssText = "position:fixed;left:360px;top:120px;width:160px;height:120px;display:block";
    const actions = container.closest('[role="row"]')?.id === "message-one"
      ? ["Reply", "React"]
      : ["Reply", "Edit", "React"];
    for (const action of actions) {
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-label", action);
      item.textContent = action;
      item.style.cssText = "display:block;width:150px;height:32px";
      item.addEventListener("click", () => {
        if (action === "Reply") {
          closeMessageMenus();
          fixture.querySelector("#test-reply-preview").style.display = "block";
          fixture.querySelector("#test-composer").focus();
        } else if (action === "Edit") {
          openEditModal();
        } else {
          closeMessageMenus();
          toggleReactionPicker();
        }
      });
      menu.append(item);
    }
    document.body.append(menu);
  }

  for (const container of fixture.querySelectorAll('[data-testid="msg-container"]')) {
    container.addEventListener("mouseover", () => {
      if (container.querySelector('[data-testid="icon-down-context"]')) return;
      const menu = mouseActionButton({ "data-testid": "icon-down-context", "aria-label": "Menu" }, "Menu");
      const reaction = mouseActionButton({ "data-testid": "reaction-entry-point", "aria-label": "React" }, "React");
      menu.addEventListener("click", () => openMessageMenu(container));
      reaction.addEventListener("click", toggleReactionPicker);
      container.append(menu, reaction);
    });
  }

  fixture.querySelector("#test-read-more").addEventListener("click", () => {
    fixture.dataset.readMoreExpanded = "true";
  });

  fixture.querySelector("#test-media").addEventListener("click", () => {
    fixture.querySelector("#test-media").dataset.opened = "true";
    const viewer = document.createElement("div");
    viewer.id = "test-media-viewer";
    viewer.dataset.testid = "media-viewer-modal";
    viewer.dataset.mediaIndex = "1";
    viewer.style.cssText = "position:fixed;left:80px;top:80px;width:360px;height:220px;display:block";
    const previous = document.createElement("button");
    previous.dataset.testid = "media-viewer-previous";
    previous.setAttribute("aria-label", "Previous media");
    previous.textContent = "Previous";
    previous.addEventListener("click", () => {
      viewer.dataset.mediaIndex = String(Number(viewer.dataset.mediaIndex) - 1);
    });
    const close = document.createElement("button");
    close.setAttribute("aria-label", "Close");
    close.textContent = "Close";
    close.addEventListener("click", () => {
      viewer.remove();
      fixture.querySelector("#test-message-list").scrollTop = 0;
      fixture.querySelector("#test-composer").focus();
    });
    const next = document.createElement("button");
    next.dataset.testid = "media-viewer-next";
    next.setAttribute("aria-label", "Next media");
    next.textContent = "Next";
    next.addEventListener("click", () => {
      viewer.dataset.mediaIndex = String(Number(viewer.dataset.mediaIndex) + 1);
    });
    viewer.append(previous, close, next);
    document.body.append(viewer);
  });

  const cancelReply = document.createElement("button");
  cancelReply.id = "test-cancel-reply";
  cancelReply.setAttribute("aria-label", "Cancel reply");
  cancelReply.style.cssText = "display:block;width:100px;height:30px";
  cancelReply.addEventListener("click", () => {
    fixture.querySelector("#test-reply-preview").style.display = "none";
    if (fixture.dataset.delayedReplyReplacement !== "true") return;
    const row = fixture.querySelector("#message-two");
    row?.remove();
    setTimeout(() => {
      const replacement = document.createElement("div");
      replacement.id = "message-two-replacement";
      replacement.setAttribute("role", "row");
      replacement.setAttribute("tabindex", "-1");
      replacement.style.cssText = "display:block;width:460px;height:70px";
      replacement.innerHTML = '<div data-id="message-two"><div data-testid="msg-container" style="display:block;width:220px;height:50px">Two (replaced)</div></div>';
      fixture.querySelector("#test-message-list").prepend(replacement);
    }, 240);
  });
  fixture.querySelector("#main").append(cancelReply);

  // WhatsApp sometimes refocuses the composer shortly after a message row
  // scrolls or virtualizes. Reproduce that delayed focus race so rapid j/k
  // navigation cannot accidentally fall into Insert mode.
  const selectionObserver = new MutationObserver((records) => {
    for (const record of records) {
      const row = record.target;
      if (!(row instanceof Element) || !row.classList.contains("whatsvim-selected-message")) continue;
      setTimeout(() => {
        if (row.classList.contains("whatsvim-selected-message")) {
          fixture.querySelector("#test-composer").focus();
        }
      }, 30);
    }
  });
  selectionObserver.observe(fixture.querySelector("#test-message-list"), {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  globalThis.addEventListener("keydown", (event) => {
    const popup = fixture.querySelector("#test-search-popup");
    const editor = fixture.querySelector("#test-popup-search");
    if (event.altKey && event.key.toLowerCase() === "k") {
      popup.style.display = "block";
      editor.focus();
    } else if (event.key === "ArrowDown" && popup.contains(document.activeElement)) {
      popup.tabIndex = -1;
      popup.focus();
      popup.dataset.arrowDownCount = String(Number(popup.dataset.arrowDownCount || 0) + 1);
    } else if (event.key === "ArrowUp" && popup.contains(document.activeElement)) {
      popup.tabIndex = -1;
      popup.focus();
      popup.dataset.arrowUpCount = String(Number(popup.dataset.arrowUpCount || 0) + 1);
    } else if (event.key === "Escape" && popup.contains(document.activeElement)) {
      popup.style.display = "none";
      editor.blur();
    } else if (event.key === "Escape") {
      fixture.dataset.hostEscapeCount = String(Number(fixture.dataset.hostEscapeCount || 0) + 1);
      fixture.querySelector("#main").style.display = "none";
    }
  });
})()`);

await evaluate('document.querySelector("#whatsvim-sentinel")?.focus()');
await waitFor('document.activeElement?.id === "whatsvim-sentinel"');
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "chat");

await pressWithDuplicateKeyDowns({
  key: "j",
  code: "KeyJ",
  virtualKeyCode: 74,
  text: "j",
});
const firstNavigation = await evaluate(`({
  alpha: document.querySelector("#chat-alpha")?.dataset.clicked,
  bravo: document.querySelector("#chat-bravo")?.dataset.clicked,
  charlie: document.querySelector("#chat-charlie")?.dataset.clicked,
  mode: document.querySelector("#whatsvim-mode")?.dataset.mode,
  activeId: document.activeElement?.id,
  toast: document.querySelector("#whatsvim-toast")?.textContent,
  rowCount: document.querySelectorAll('#pane-side [role="row"][data-testid^="list-item-"]').length,
})`);
assert.equal(firstNavigation.alpha, "true", JSON.stringify(firstNavigation));
assert.equal(firstNavigation.bravo, undefined, JSON.stringify(firstNavigation));
assert.equal(firstNavigation.charlie, undefined, JSON.stringify(firstNavigation));
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");

await pressWithRepeatKeyDowns({
  key: "j",
  code: "KeyJ",
  virtualKeyCode: 74,
  text: "j",
});
assert.equal(await evaluate('document.querySelector("#chat-bravo")?.dataset.clicked'), "true");
assert.equal(await evaluate('document.querySelector("#chat-charlie")?.dataset.clicked'), "true");
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");

const charlieClickCountBeforeInsert = await evaluate(
  'document.querySelector("#chat-charlie")?.dataset.clickCount',
);
const composerGeometryBeforeInsert = await evaluate(`(() => {
  const rect = document.querySelector("#test-composer")?.getBoundingClientRect();
  return rect && { width: rect.width, height: rect.height };
})()`);
await press({ key: "i", code: "KeyI", virtualKeyCode: 73, text: "i" });
assert.equal(await evaluate('document.activeElement?.id'), "test-composer");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
const insertComposerRing = await evaluate(`(() => {
  const composer = document.querySelector("#test-composer");
  const search = document.querySelector("#test-search");
  const rect = composer?.getBoundingClientRect();
  const style = composer && getComputedStyle(composer);
  return {
    active: composer?.classList.contains("whatsvim-insert-composer"),
    boxShadow: style?.boxShadow,
    width: rect?.width,
    height: rect?.height,
    searchActive: search?.classList.contains("whatsvim-insert-composer"),
    searchShadow: search && getComputedStyle(search).boxShadow,
  };
})()`);
assert.equal(insertComposerRing.active, true, JSON.stringify(insertComposerRing));
assert.notEqual(insertComposerRing.boxShadow, "none", JSON.stringify(insertComposerRing));
assert.equal(insertComposerRing.width, composerGeometryBeforeInsert.width, JSON.stringify(insertComposerRing));
assert.equal(insertComposerRing.height, composerGeometryBeforeInsert.height, JSON.stringify(insertComposerRing));
assert.equal(insertComposerRing.searchActive, false, JSON.stringify(insertComposerRing));
assert.equal(insertComposerRing.searchShadow, "none", JSON.stringify(insertComposerRing));

await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(
  await evaluate('document.querySelector("#chat-charlie")?.dataset.clickCount'),
  charlieClickCountBeforeInsert,
);
assert.equal(await evaluate('document.querySelector("#test-composer")?.textContent'), "jhlk");
await press({ key: " ", code: "Space", virtualKeyCode: 32, text: " " });
assert.match(await evaluate('document.querySelector("#test-composer")?.textContent'), /^jhlk\s$/);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");

await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#test-composer")?.classList.contains("whatsvim-insert-composer")'), false);

await press({ key: "?", code: "Slash", virtualKeyCode: 191, modifiers: 8, text: "?" });
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.dataset.open'), "true");
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.tagName'), "DIALOG");
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.open'), true);
assert.equal(
  await evaluate('document.querySelector("#whatsvim-help-note")?.textContent'),
  "Mapped keys are handled in Normal mode. Editors use Insert mode; Ctrl+V in Normal mode first focuses the composer."
);
assert.equal(await evaluate('document.querySelector("#whatsvim-sentinel")?.hasAttribute("role")'), false);
assert.equal(await evaluate('document.querySelector("#whatsvim-sentinel")?.hasAttribute("aria-label")'), false);
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-help-close");
await evaluate('document.querySelector("#test-search")?.focus()');
await delay(20);
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-help-close");
await press({ key: "Tab", code: "Tab", virtualKeyCode: 9 });
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-help-close");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.dataset.open'), "false");
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.open'), false);
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");

// An already-open native dialog must not make the extension call showModal()
// again, and a failed call from the extension's isolated world must restore the
// normal command state.
await evaluate('document.querySelector("#whatsvim-help")?.showModal()');
await press({ key: "?", code: "Slash", virtualKeyCode: 191, modifiers: 8, text: "?" });
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.dataset.open'), "true");
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.open'), true);
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.dataset.open'), "false");
assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.open'), false);
await evaluateInExtension(`(() => {
  const dialog = document.querySelector("#whatsvim-help");
  dialog.__testShowModal = dialog.showModal;
  dialog.showModal = () => { throw new DOMException("blocked", "InvalidStateError"); };
})()`);
try {
  await press({ key: "?", code: "Slash", virtualKeyCode: 191, modifiers: 8, text: "?" });
  assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.dataset.open'), "false");
  assert.equal(await evaluate('document.querySelector("#whatsvim-help")?.open'), false);
  assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
} finally {
  await evaluateInExtension(`(() => {
    const dialog = document.querySelector("#whatsvim-help");
    dialog.showModal = dialog.__testShowModal;
    delete dialog.__testShowModal;
  })()`);
}

await call("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "v",
  code: "KeyV",
  windowsVirtualKeyCode: 86,
  nativeVirtualKeyCode: 86,
  modifiers: 2,
});
assert.equal(await evaluate('document.activeElement?.id'), "test-composer");
await call("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "v",
  code: "KeyV",
  windowsVirtualKeyCode: 86,
  nativeVirtualKeyCode: 86,
  modifiers: 2,
});

await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await press({ key: "/", code: "Slash", virtualKeyCode: 191, text: "/" });
assert.equal(await evaluate('document.activeElement?.id'), "test-popup-search");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.querySelector("#test-popup-search")?.value'), "");

await press({ key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 });
assert.equal(await evaluate('document.activeElement?.id'), "test-search-popup");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.querySelector("#test-search-popup")?.dataset.arrowDownCount'), "1");
await press({ key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 });
assert.equal(await evaluate('document.activeElement?.id'), "test-search-popup");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.querySelector("#test-search-popup")?.dataset.arrowDownCount'), "2");
await press({ key: "ArrowUp", code: "ArrowUp", virtualKeyCode: 38 });
assert.equal(await evaluate('document.activeElement?.id'), "test-search-popup");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.querySelector("#test-search-popup")?.dataset.arrowUpCount'), "1");

await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.activeElement?.id === "whatsvim-sentinel"');
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('getComputedStyle(document.querySelector("#test-search-popup")).display'), "none");

await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "message");
assert.equal(await evaluate('document.querySelector("#main")?.classList.contains("whatsvim-active-pane")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
const composerTextBeforePaneFocusRecovery = await evaluate('document.querySelector("#test-composer")?.textContent');
await evaluate('setTimeout(() => document.querySelector("#test-composer")?.focus(), 0)');
await delay(120);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#test-composer")?.textContent'), composerTextBeforePaneFocusRecovery);
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.textContent'), "NORMAL · MESSAGES");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#test-composer")?.textContent'), composerTextBeforePaneFocusRecovery);
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.querySelector("#test-media-viewer")'), null);
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "message");
await press({ key: " ", code: "Space", virtualKeyCode: 32, text: " " });
assert.equal(await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.readMoreExpanded'), undefined);
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "chat");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");
await evaluate('setTimeout(() => document.querySelector("#test-composer")?.focus(), 0)');
await delay(120);
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");

await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
const bravoClickCountBeforePaneNavigation = Number(await evaluate(
  'document.querySelector("#chat-bravo")?.dataset.clickCount || 0',
));
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "chat");
assert.equal(await evaluate('document.querySelector("#side")?.classList.contains("whatsvim-active-pane")'), true);
assert.equal(await evaluate('document.querySelector("#pane-side")?.classList.contains("whatsvim-active-pane")'), false);
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(Number(await evaluate('document.querySelector("#chat-bravo")?.dataset.clickCount || 0')), bravoClickCountBeforePaneNavigation + 1);
const charlieClickCountBeforeShiftNavigation = Number(await evaluate(
  'document.querySelector("#chat-charlie")?.dataset.clickCount || 0',
));
await press({ key: "J", code: "KeyJ", virtualKeyCode: 74, modifiers: 8, text: "J" });
assert.equal(Number(await evaluate('document.querySelector("#chat-charlie")?.dataset.clickCount || 0')), charlieClickCountBeforeShiftNavigation + 1);
await evaluate('document.querySelector("#main").style.display = "none"');
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.pane'), "chat");
await waitFor('document.querySelector("#whatsvim-toast")?.textContent === "Message pane is not available"', 1200);
assert.equal(await evaluate('document.querySelector("#whatsvim-toast")?.textContent'), "Message pane is not available");
await evaluate('document.querySelector("#main").style.display = "block"');
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });

const composerTextBeforeRapidNavigation = await evaluate(
  'document.querySelector("#test-composer")?.textContent',
);
await pressWithDuplicateKeyDowns({
  key: "k",
  code: "KeyK",
  virtualKeyCode: 75,
  text: "k",
  duplicateCount: 2,
});
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(
  await evaluate('document.querySelector("#test-composer")?.textContent'),
  composerTextBeforeRapidNavigation,
);
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);

await press({ key: "i", code: "KeyI", virtualKeyCode: 73, text: "i" });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.activeElement?.id'), "test-composer");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.context === "message"');
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);

await evaluate('document.querySelector("#test-message-list").scrollTop = 0');
await press({ key: "I", code: "KeyI", virtualKeyCode: 73, modifiers: 8, text: "I" });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.mode === "insert"');
assert.equal(await evaluate('document.activeElement?.id'), "test-composer");
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
assert.ok(await evaluate('document.querySelector("#test-message-list")?.scrollTop > 0'));
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.context === "message"');
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);

await evaluate('document.querySelector("#whatsvim-test-fixture").dataset.hostEscapeCount = "0"');
await press({ key: "r", code: "KeyR", virtualKeyCode: 82, text: "r" });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.mode === "insert"');
assert.equal(await evaluate('getComputedStyle(document.querySelector("#test-reply-preview")).display'), "block");
assert.equal(await evaluate('document.activeElement?.id'), "test-composer");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.context === "message"');
assert.equal(await evaluate('getComputedStyle(document.querySelector("#test-reply-preview")).display'), "none");
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.hostEscapeCount'), "0");
assert.equal(await evaluate('getComputedStyle(document.querySelector("#main")).display'), "block");

await press({ key: "e", code: "KeyE", virtualKeyCode: 69, text: "e" });
await waitFor('document.querySelector("[data-testid=edit-message-composer]") !== null');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("[data-testid=edit-message-modal]") === null');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");

await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
await press({ key: "e", code: "KeyE", virtualKeyCode: 69, text: "e" });
await delay(1100);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.querySelector(".test-message-menu") === null'), true);

await press({ key: "a", code: "KeyA", virtualKeyCode: 65, text: "a" });
assert.equal(await evaluate('document.querySelector("#test-reaction-picker") === null'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.context === "message"');

await press({ key: "R", code: "KeyR", virtualKeyCode: 82, modifiers: 8, text: "R" });
await waitFor('document.querySelector("#test-reaction-picker") !== null');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-0");
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-1");
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-0");
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-2");
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-0");
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
await press({ key: "Enter", code: "Enter", virtualKeyCode: 13 });
await waitFor('document.querySelector("#test-reaction-picker") === null');
assert.equal(await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.selectedReaction'), "1");
await waitFor('document.activeElement?.id === "whatsvim-sentinel"');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");

await press({ key: "R", code: "KeyR", virtualKeyCode: 82, modifiers: 8, text: "R" });
await waitFor('document.querySelector("#test-reaction-picker") !== null');
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-2");
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-4");
await press({ key: "Enter", code: "Enter", virtualKeyCode: 13 });
await waitFor('document.activeElement?.id === "test-reaction-search"');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
await press({ key: "s", code: "KeyS", virtualKeyCode: 83, text: "s" });
assert.equal(await evaluate('document.querySelector("#test-reaction-search")?.value'), "s");

await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-row-0");
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.activeElement?.id'), "test-expanded-reaction-0");
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.activeElement?.id'), "test-expanded-reaction-1");
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-row-1");
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
assert.equal(await evaluate('document.activeElement?.id'), "test-expanded-reaction-1");
await press({ key: "/", code: "Slash", virtualKeyCode: 191, text: "/" });
assert.equal(await evaluate('document.activeElement?.id'), "test-reaction-search");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "insert");
assert.equal(await evaluate('document.querySelector("#test-reaction-search")?.value'), "s");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, text: "j" });
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
await press({ key: "Enter", code: "Enter", virtualKeyCode: 13 });
await waitFor('document.querySelector("#test-reaction-picker") === null');
assert.equal(
  await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.selectedReaction'),
  "expanded-1",
);
await waitFor('document.activeElement?.id === "whatsvim-sentinel"');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");

await press({ key: "R", code: "KeyR", virtualKeyCode: 82, modifiers: 8, text: "R" });
await waitFor('document.querySelector("#test-reaction-picker") !== null');
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#test-reaction-picker") === null');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");

await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
await evaluate(`document.querySelector("#test-neutral")?.dispatchEvent(new PointerEvent("pointerup", {
  bubbles: true,
  cancelable: true,
  composed: true,
}))`);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");
assert.equal(await evaluate('document.querySelector(".whatsvim-selected-message")'), null);
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
await evaluate('document.querySelector("#test-message-list").scrollTop = 43');
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
await press({ key: " ", code: "Space", virtualKeyCode: 32, text: " " });
assert.equal(await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.readMoreExpanded'), "true");
assert.equal(await evaluate('document.querySelector("#test-media-viewer")'), null);
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
await waitFor('document.querySelector("#test-media")?.dataset.opened === "true"');
assert.equal(await evaluate('document.querySelector("#test-media-viewer") !== null'), true);
await evaluate(`document.querySelector("#test-media-viewer")?.dispatchEvent(new PointerEvent("pointerup", {
  bubbles: true,
  cancelable: true,
  composed: true,
}))`);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.querySelector("#test-media-viewer")?.dataset.mediaIndex'), "1");
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
assert.equal(await evaluate('document.querySelector("#test-media-viewer")?.dataset.mediaIndex'), "2");
assert.equal(await evaluate('document.querySelector("#test-media-viewer") !== null'), true);
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('getComputedStyle(document.querySelector("#test-reply-preview")).display'), "none");
await press({ key: "h", code: "KeyH", virtualKeyCode: 72, text: "h" });
assert.equal(await evaluate('document.querySelector("#test-media-viewer")?.dataset.mediaIndex'), "1");
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#test-media-viewer") === null');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('document.querySelector("#message-media")?.classList.contains("whatsvim-selected-message")'), true);
assert.equal(await evaluate('document.activeElement?.id'), "whatsvim-sentinel");
await waitFor('document.querySelector("#test-message-list")?.scrollTop === 43');
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.mode'), "normal");
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "normal");

// Reply cancellation can virtualize the selected row before the keyed
// replacement is committed. Escape must wait for that replacement rather than
// falling back to the newest rendered row, and the physical Escape must not
// reach WhatsApp's chat-closing handler.
await press({ key: "l", code: "KeyL", virtualKeyCode: 76, text: "l" });
await press({ key: "k", code: "KeyK", virtualKeyCode: 75, text: "k" });
assert.equal(await evaluate('document.querySelector("#message-two")?.classList.contains("whatsvim-selected-message")'), true);
await evaluate(`(() => {
  const fixture = document.querySelector("#whatsvim-test-fixture");
  fixture.dataset.delayedReplyReplacement = "true";
  fixture.dataset.hostEscapeCount = "0";
})()`);
await press({ key: "r", code: "KeyR", virtualKeyCode: 82, text: "r" });
await waitFor('document.querySelector("#whatsvim-mode")?.dataset.mode === "insert"');
await press({ key: "Escape", code: "Escape", virtualKeyCode: 27 });
await waitFor('document.querySelector("#message-two-replacement")?.classList.contains("whatsvim-selected-message")');
assert.equal(await evaluate('document.querySelector("#whatsvim-mode")?.dataset.context'), "message");
assert.equal(await evaluate('getComputedStyle(document.querySelector("#test-reply-preview")).display'), "none");
assert.equal(await evaluate('document.querySelector("#whatsvim-test-fixture")?.dataset.hostEscapeCount'), "0");
assert.equal(await evaluate('getComputedStyle(document.querySelector("#main")).display'), "block");

// Virtualized chat lists can mutate for unrelated reasons before the requested
// edge row materializes. The observer wait must ignore that mutation, retain
// the boundary command, and use the scoped legacy listitem fallback (not the
// nested row) once the row is available.
await evaluate(`(() => {
  const pane = document.querySelector("#pane-side");
  pane.replaceChildren();
  document.querySelector("#main").style.display = "none";
  document.querySelector("#test-chat-title").textContent = "";
  setTimeout(() => pane.append(document.createElement("div")), 40);
  setTimeout(() => {
    const outer = document.createElement("div");
    outer.id = "delayed-legacy-outer";
    outer.setAttribute("role", "listitem");
    outer.style.cssText = "display:block;width:280px;height:100px";
    outer.innerHTML = '<div data-testid="cell-frame-container"><span data-testid="cell-frame-title">Delayed outer</span></div><div id="delayed-legacy-inner" role="row" style="display:block;width:260px;height:40px"><div data-testid="cell-frame-container"><span data-testid="cell-frame-title">Delayed inner</span></div></div>';
    outer.querySelector(':scope > [data-testid="cell-frame-container"]').addEventListener("mousedown", () => {
      outer.dataset.clicked = "true";
      document.querySelector("#test-chat-title").textContent = "Delayed outer";
      document.querySelector("#main").style.display = "block";
    });
    outer.querySelector("#delayed-legacy-inner [data-testid=cell-frame-container]").addEventListener("mousedown", () => {
      outer.querySelector("#delayed-legacy-inner").dataset.clicked = "true";
    });
    pane.append(outer);
  }, 180);
})()`);
await press({ key: "G", code: "KeyG", virtualKeyCode: 71, modifiers: 8, text: "G" });
assert.notEqual(await evaluate('document.querySelector("#whatsvim-toast")?.textContent'), "No visible chats found");
await waitFor('document.querySelector("#delayed-legacy-outer")?.dataset.clicked === "true"');
assert.equal(await evaluate('document.querySelector("#delayed-legacy-inner")?.dataset.clicked'), undefined);

socket.close();
console.log("WhatsVim browser smoke tests passed");
