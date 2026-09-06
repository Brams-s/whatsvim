"use strict";

const assert = require("node:assert/strict");
require("../keymap.js");

const { resolve } = globalThis.WhatsVimKeymap;
const event = (key, extra = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...extra,
});

assert.equal(resolve(event("j"), { mode: "normal", activePane: "chat" }).action, "next-chat");
assert.equal(resolve(event("k"), { mode: "normal", activePane: "chat" }).action, "previous-chat");
assert.equal(resolve(event("j"), { mode: "normal", activePane: "message" }).action, "next-message");
assert.equal(resolve(event("k"), { mode: "normal", activePane: "message" }).action, "previous-message");
assert.equal(resolve(event("J", { shiftKey: true }), { mode: "normal", activePane: "chat" }).action, "next-chat");
assert.equal(resolve(event("K", { shiftKey: true }), { mode: "normal", activePane: "message" }).action, "previous-chat");
assert.equal(resolve(event("j", { repeat: true }), { mode: "normal", activePane: "chat" }).action, "next-chat");
assert.equal(resolve(event("k", { repeat: true }), { mode: "message" }).action, "previous-message");
assert.equal(resolve(event("J", { shiftKey: true, repeat: true }), { mode: "normal", activePane: "chat" }).action, "next-chat");
assert.equal(resolve(event("K", { shiftKey: true, repeat: true }), { mode: "message" }).action, "previous-chat");
assert.equal(resolve(event("j", { repeat: true }), { mode: "insert" }).action, null);
assert.equal(resolve(event("j"), { mode: "insert", activePane: "chat" }).action, null);
assert.equal(resolve(event("Escape"), { mode: "insert" }).action, "escape");
assert.equal(resolve(event("[", { ctrlKey: true }), { mode: "insert" }).action, "escape");
assert.equal(resolve(event("j", { ctrlKey: true }), { mode: "normal" }).action, null);

const firstG = resolve(event("g"), { mode: "normal", pendingG: false });
assert.deepEqual(firstG, { action: "await-g", pendingG: true });
assert.deepEqual(resolve(event("g"), { mode: "normal", pendingG: true }), {
  action: "first-chat",
  pendingG: false,
});
assert.equal(resolve(event("G", { shiftKey: true }), { mode: "normal" }).action, "last-chat");
assert.equal(resolve(event("?", { shiftKey: true }), { mode: "normal" }).action, "help");
assert.equal(resolve(event("m"), { mode: "normal" }).action, null);
assert.equal(resolve(event("I", { shiftKey: true }), { mode: "normal" }).action, "compose-at-latest-message");
assert.equal(resolve(event("h"), { mode: "normal" }).action, "select-chat-pane");
assert.equal(resolve(event("l"), { mode: "normal" }).action, "select-message-pane");
assert.equal(resolve(event("j"), { mode: "message" }).action, "next-message");
assert.equal(resolve(event("k"), { mode: "message" }).action, "previous-message");
assert.equal(resolve(event("J", { shiftKey: true }), { mode: "message" }).action, "next-chat");
assert.equal(resolve(event("K", { shiftKey: true }), { mode: "message" }).action, "previous-chat");
assert.equal(resolve(event("r"), { mode: "message" }).action, "reply-message");
assert.equal(resolve(event("h"), { mode: "message" }).action, "select-chat-pane");
assert.equal(resolve(event("l"), { mode: "message" }).action, "open-message-media-or-select-message-pane");
assert.equal(resolve(event("e"), { mode: "message" }).action, "edit-message");
assert.equal(resolve(event("a"), { mode: "message" }).action, "compose-from-message");
assert.equal(resolve(event("Enter"), { mode: "message" }).action, "compose-from-message");
assert.equal(resolve(event("/"), { mode: "message" }).action, "search");
assert.equal(resolve(event("R", { shiftKey: true }), { mode: "message" }).action, "react-message");
assert.equal(resolve(event("R"), { mode: "message" }).action, null);
assert.equal(resolve(event("o"), { mode: "message" }).action, "open-message-media");
assert.equal(resolve(event(" "), { mode: "message" }).action, "expand-message");
assert.equal(resolve(event(" "), { mode: "normal" }).action, null);
assert.equal(resolve(event(" "), { mode: "insert" }).action, null);
assert.equal(resolve(event("i"), { mode: "message" }).action, "compose-from-message");
assert.equal(resolve(event("I", { shiftKey: true }), { mode: "message" }).action, "compose-at-latest-message");
assert.equal(resolve(event("I"), { mode: "message" }).action, null);
assert.equal(resolve(event("Escape"), { mode: "message" }).action, "escape");
assert.equal(resolve(event("j", { ctrlKey: true }), { mode: "message" }).action, null);
for (const key of ["h", "l", "j", "k", " "]) {
  assert.equal(resolve(event(key, { isComposing: true }), { mode: "normal" }).action, null);
  assert.equal(resolve(event(key, { isComposing: true }), { mode: "message" }).action, null);
}
assert.equal(resolve(event("h"), { mode: "message", mediaOpen: true }).action, "media-previous");
assert.equal(resolve(event("l"), { mode: "message", mediaOpen: true }).action, "media-next");
assert.equal(resolve(event("j"), { mode: "message", mediaOpen: true }).action, null);
assert.equal(resolve(event("r"), { mode: "message", mediaOpen: true }).action, null);
assert.equal(resolve(event("h"), { mode: "message", reactionOpen: true }).action, "reaction-left");
assert.equal(resolve(event("j"), { mode: "message", reactionOpen: true }).action, "reaction-down");
assert.equal(resolve(event("k"), { mode: "message", reactionOpen: true }).action, "reaction-up");
assert.equal(resolve(event("l"), { mode: "message", reactionOpen: true }).action, "reaction-right");
assert.equal(resolve(event("Enter"), { mode: "message", reactionOpen: true }).action, "choose-reaction");
assert.equal(resolve(event(" "), { mode: "message", reactionOpen: true }).action, "choose-reaction");
assert.equal(resolve(event("/"), { mode: "message", reactionOpen: true }).action, "reaction-search");
assert.equal(resolve(event("a"), { mode: "message", reactionOpen: true }).action, null);

console.log("WhatsVim keymap tests passed");
