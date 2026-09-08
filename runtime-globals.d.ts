type WhatsVimMode = "normal" | "insert" | "message";
type WhatsVimPane = "chat" | "message";
type WhatsVimAction =
  | "await-g"
  | "choose-reaction"
  | "compose"
  | "compose-at-latest-message"
  | "compose-from-message"
  | "edit-message"
  | "escape"
  | "expand-message"
  | "first-chat"
  | "help"
  | "last-chat"
  | "media-next"
  | "media-previous"
  | "next-chat"
  | "next-message"
  | "open-message-media"
  | "open-message-media-or-select-message-pane"
  | "previous-chat"
  | "previous-message"
  | "react-message"
  | "reaction-down"
  | "reaction-left"
  | "reaction-right"
  | "reaction-search"
  | "reaction-up"
  | "reply-message"
  | "search"
  | "select-chat-pane"
  | "select-message-pane";

interface WhatsVimKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
}

interface WhatsVimKeymapState {
  activePane?: WhatsVimPane;
  mediaOpen?: boolean;
  mode?: WhatsVimMode;
  pendingG?: boolean;
  reactionOpen?: boolean;
}

interface WhatsVimKeymap {
  resolve(event: WhatsVimKeyEvent, state?: WhatsVimKeymapState): Readonly<{
    action: WhatsVimAction | null;
    pendingG: boolean;
  }>;
}

interface ChromeRuntimeManifest {
  version?: string;
  version_name?: string;
}

declare var __whatsvimNavigationInstalled: boolean | undefined;
declare var WhatsVimKeymap: WhatsVimKeymap | undefined;
declare var chrome: { runtime?: { getManifest?: () => ChromeRuntimeManifest } } | undefined;
