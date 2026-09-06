(() => {
  "use strict";

  function result(action = null, pendingG = false) {
    return Object.freeze({ action, pendingG });
  }

  function resolve(event, state = {}) {
    const mode = ["insert", "message"].includes(state.mode) ? state.mode : "normal";
    const pendingG = state.pendingG === true;
    const reactionOpen = state.reactionOpen === true;
    const mediaOpen = state.mediaOpen === true;
    const activePane = state.activePane === "chat" ? "chat" : "message";
    const key = event.key;

    if (event.isComposing || key === "Process" || key === "Dead") {
      return result(null, pendingG);
    }

    const controlBracket =
      event.ctrlKey === true &&
      event.altKey !== true &&
      event.metaKey !== true &&
      key === "[";

    if (key === "Escape" || controlBracket) {
      return result("escape");
    }

    if (mode === "insert") {
      return result();
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
      return result();
    }

    if (mode === "message") {
      if (mediaOpen) {
        switch (key) {
          case "h":
            return result("media-previous");
          case "l":
            return result("media-next");
          default:
            return result();
        }
      }
      if (reactionOpen) {
        switch (key) {
          case "h":
            return result("reaction-left");
          case "j":
            return result("reaction-down");
          case "k":
            return result("reaction-up");
          case "l":
            return result("reaction-right");
          case "Enter":
          case " ":
            return result("choose-reaction");
          case "/":
            return result("reaction-search");
          default:
            return result();
        }
      }
      if (key === "h") return result("select-chat-pane");
      if (key === "l") return result("open-message-media-or-select-message-pane");
    }

    if (key.toLowerCase() === "j" && event.shiftKey) return result("next-chat");
    if (key.toLowerCase() === "k" && event.shiftKey) return result("previous-chat");

    if (key === "g") {
      if (event.repeat) {
        return result("await-g", true);
      }
      return pendingG ? result("first-chat") : result("await-g", true);
    }

    if (key === "G" && event.shiftKey) {
      return result("last-chat");
    }

    if (key === "I" && event.shiftKey) {
      return result("compose-at-latest-message");
    }

    if (mode === "message") {
      switch (key) {
        case "j":
          return result("next-message");
        case "k":
          return result("previous-message");
        case "r":
          return result("reply-message");
        case "e":
          return result("edit-message");
        case "R":
          return event.shiftKey ? result("react-message") : result();
        case "o":
          return result("open-message-media");
        case " ":
          return result("expand-message");
        case "i":
          return result("compose-from-message");
        case "a":
        case "Enter":
          return result("compose-from-message");
        case "/":
          return result("search");
        case "?":
          return result("help");
        default:
          return result();
      }
    }

    switch (key) {
      case "j":
        return result(activePane === "chat" ? "next-chat" : "next-message");
      case "k":
        return result(activePane === "chat" ? "previous-chat" : "previous-message");
      case "h":
        return result("select-chat-pane");
      case "l":
        return result("select-message-pane");
      case "Enter":
      case "i":
      case "a":
      case "o":
        return result("compose");
      case "/":
        return result("search");
      case "?":
        return result("help");
      default:
        return result();
    }
  }

  globalThis.WhatsVimKeymap = Object.freeze({ resolve });
})();
