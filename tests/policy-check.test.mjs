import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  runtimeFiles,
  validateArchiveNames,
  validateManifestPolicy,
  validateProjectPolicy,
  validateRuntimeSource,
} from "../scripts/policy-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = {
  manifest_version: 3,
  minimum_chrome_version: "105",
  icons: {
    "16": "icons/whatsvim-16.png",
    "32": "icons/whatsvim-32.png",
    "48": "icons/whatsvim-48.png",
    "128": "icons/whatsvim-128.png",
  },
  content_scripts: [{
    matches: ["https://web.whatsapp.com/*"],
    css: ["content.css"],
    js: ["keymap.js", "content.js"],
    run_at: "document_start",
  }],
};

test("policy checker accepts a minimal temporary MV3 fixture", async () => {
  validateManifestPolicy(manifest);
  validateRuntimeSource("fixture.js", "document.body.textContent = 'safe';");
  validateArchiveNames([...runtimeFiles]);
  const root = await mkdtemp(path.join(os.tmpdir(), "whatsvim-policy-"));
  try {
    await mkdir(path.join(root, "icons"));
    await Promise.all([
      writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest)),
      writeFile(path.join(root, "content.css"), "#fixture { display: block; }"),
      writeFile(path.join(root, "keymap.js"), "globalThis.fixtureKeymap = true;"),
      writeFile(path.join(root, "content.js"), "document.body.textContent = 'safe';"),
      writeFile(path.join(root, "icons", "whatsvim-16.png"), ""),
      writeFile(path.join(root, "icons", "whatsvim-32.png"), ""),
      writeFile(path.join(root, "icons", "whatsvim-48.png"), ""),
      writeFile(path.join(root, "icons", "whatsvim-128.png"), ""),
    ]);
    await validateProjectPolicy(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("policy checker rejects manifest and runtime violations", () => {
  assert.throws(() => validateManifestPolicy({ ...manifest, permissions: ["storage"] }), /API permissions/);
  assert.throws(() => validateManifestPolicy({ ...manifest, background: {} }), /background worker/);
  assert.throws(() => validateRuntimeSource("fixture.js", "fetch('https://example.test')"), /network access/);
  assert.throws(() => validateRuntimeSource("fixture.js", "node.innerHTML = value"), /unsafe HTML sink/);
  assert.throws(() => validateRuntimeSource("fixture.js", "node.innerHTML += value"), /unsafe HTML sink/);
  assert.throws(() => validateArchiveNames(["nested/content.js"]), /approved runtime files and icons/);
});

test("policy checker rejects additional executable and exfiltration sinks", () => {
  const prohibited = [
    ["navigator.sendBeacon('/collect', data)", /network access/],
    ["Function('return globalThis')()", /remote or dynamic code/],
    ["setTimeout('runPayload()', 0)", /string timer execution/],
    ["window.setInterval(\"runPayload()\", 0)", /string timer execution/],
    ["document.write('<script>runPayload()</script>')", /unsafe document write/],
    ["globalThis.document.writeln('payload')", /unsafe document write/],
    ["document.createElement('script')", /script source loading/],
    ["const remoteScript = {}; remoteScript.src = 'https://example.test/payload.js'", /script source loading/],
    ["document.querySelector('script').src = 'https://example.test/payload.js'", /script source loading/],
    ["const image = {}; image.src = 'https://example.test/collect'", /network-like image source/],
    ["const image = {}; image.src = endpoint", /network-like image source/],
  ];
  for (const [source, message] of prohibited) {
    assert.throws(() => validateRuntimeSource("fixture.js", source), message, source);
  }
});

test("policy checker permits non-executable counterparts", () => {
  const permitted = [
    "navigator.userAgent",
    "Function.prototype.call",
    "setTimeout(callback, 0)",
    "setInterval(() => callback(), 0)",
    "document.createTextNode('write')",
    "const image = {}; image.src = chrome.runtime.getURL('icons/whatsvim-16.png')",
    "document.createElement('div')",
  ];
  for (const source of permitted) validateRuntimeSource("fixture.js", source);
});

test("runtime command and help regressions remain guarded", async () => {
  const [content, keymap] = await Promise.all([
    readFile(path.join(root, "content.js"), "utf8"),
    readFile(path.join(root, "keymap.js"), "utf8"),
  ]);
  assert.match(keymap, /globalThis\.WhatsVimKeymap/);
  assert.doesNotMatch(keymap, /toLocaleLowerCase|close-pane/);
  assert.match(content, /globalThis\.WhatsVimKeymap/);
  assert.doesNotMatch(content, /case "close-pane"|event\.key\.toLocaleLowerCase\(\) === "v"/);
  assert.match(content, /Mapped keys are handled in Normal mode/);
  assert.match(content, /if \(!help\.open\) \{\s*try \{\s*help\.showModal\(\);[\s\S]*?catch \{\s*finishHelpClose\(\);/);
  assert.match(content, /if \(mode === "message"\) \{\s*clearMessageSelection\(\);\s*clearMessageReturn\(\);\s*\}\s*setMode\("normal"\);/);
});
