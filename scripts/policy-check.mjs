import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const iconFiles = Object.freeze([
  "icons/whatsvim-16.png",
  "icons/whatsvim-32.png",
  "icons/whatsvim-48.png",
  "icons/whatsvim-128.png",
]);
export const runtimeFiles = Object.freeze(["manifest.json", "content.css", "keymap.js", "content.js", ...iconFiles]);
const sourceFiles = Object.freeze(["content.css", "keymap.js", "content.js"]);
const prohibitedRuntimePatterns = Object.freeze([
  ["network access", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|\b(?:(?:globalThis|window|self)\s*(?:\.|\?\.)\s*)?navigator\s*(?:\.|\?\.)\s*sendBeacon\s*\(/],
  ["storage access", /\b(?:chrome|browser)\.storage\b|\b(?:local|session)Storage\b|\bindexedDB\b/],
  ["remote or dynamic code", /\beval\s*\(|\bnew\s+Function\b|\b(?:(?:globalThis|window|self)\s*(?:\.|\?\.)\s*)?Function\s*\(|\bimport\s*\(/],
  ["string timer execution", /\b(?:(?:globalThis|window|self)\s*(?:\.|\?\.)\s*)?set(?:Timeout|Interval)\s*\(\s*["'`]/],
  ["unsafe HTML sink", /\b(?:innerHTML|outerHTML)\s*(?:=|\+=)|\binsertAdjacentHTML\s*\(/],
  ["unsafe document write", /\b(?:(?:globalThis|window|self)\s*(?:\.|\?\.)\s*)?document\s*(?:\.|\?\.)\s*write(?:ln)?\s*\(/],
  ["script source loading", /\b(?:(?:globalThis|window|self)\s*(?:\.|\?\.)\s*)?document\s*(?:\.|\?\.)\s*createElement\s*\(\s*["'`]script["'`]\s*\)|\b(?:HTMLScriptElement|[A-Za-z_$][\w$]*script[\w$]*)\s*(?:\.|\?\.)\s*(?:src\s*=|setAttribute\s*\(\s*["'`]src["'`])|\bdocument\s*(?:\.|\?\.)\s*querySelector(?:All)?\s*\(\s*["'`][^"'`]*\bscript\b[^"'`]*["'`]\s*\)\s*(?:\.|\?\.)\s*src\s*=/i],
]);

const imageSourceAssignment = /\b[A-Za-z_$][\w$]*\s*(?:\.|\?\.)\s*src\s*=\s*([^;\n]+)/g;

function isLocalExtensionImageSource(value) {
  return /^chrome\.runtime\.getURL\(\s*["']icons\/whatsvim-(?:16|32|48|128)\.png["']\s*\)$/.test(value.trim()) ||
    /^["'](?:data:image\/|blob:)/.test(value.trim()) ||
    /^URL\.createObjectURL\(/.test(value.trim());
}

export function validateManifestPolicy(manifest) {
  assert.equal(manifest.manifest_version, 3, "manifest is MV3");
  assert.equal("permissions" in manifest, false, "manifest has no API permissions");
  assert.equal("host_permissions" in manifest, false, "content-script match supplies host access");
  assert.equal("background" in manifest, false, "manifest has no background worker");
  assert.equal(manifest.minimum_chrome_version, "105", "manifest declares Chrome 105 for CSS :has() support");
  assert.deepEqual(manifest.icons, {
    "16": "icons/whatsvim-16.png",
    "32": "icons/whatsvim-32.png",
    "48": "icons/whatsvim-48.png",
    "128": "icons/whatsvim-128.png",
  }, "manifest icon registration is canonical");
  assert.deepEqual(manifest.content_scripts, [{
    matches: ["https://web.whatsapp.com/*"],
    css: ["content.css"],
    js: ["keymap.js", "content.js"],
    run_at: "document_start",
  }], "content script registration is canonical");
}

export function validateRuntimeSource(name, source) {
  for (const [description, pattern] of prohibitedRuntimePatterns) {
    assert.doesNotMatch(source, pattern, `${name} contains prohibited ${description}`);
  }
  for (const match of source.matchAll(imageSourceAssignment)) {
    assert.equal(isLocalExtensionImageSource(match[1]), true,
      `${name} contains prohibited network-like image source`);
  }
}

export function validateArchiveNames(names) {
  assert.deepEqual(names, runtimeFiles, "package contains only approved runtime files and icons");
  for (const name of names) {
    assert.equal(name.includes("/"), name.startsWith("icons/"), `${name} is at the ZIP root or icons directory`);
  }
}

export async function validateProjectPolicy(root) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  validateManifestPolicy(manifest);
  await Promise.all(sourceFiles.map(async (name) => {
    validateRuntimeSource(name, await readFile(path.join(root, name), "utf8"));
  }));
  await Promise.all(iconFiles.map((name) => readFile(path.join(root, name))));
  return manifest;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await validateProjectPolicy(root);
  console.log("Extension policy validation passed");
}
