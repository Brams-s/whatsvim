import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("strict TypeScript sources emit the manifest runtime paths", async () => {
  const tsconfig = JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8"));
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.module, "none");
  assert.deepEqual(tsconfig.files, ["runtime-globals.d.ts", "keymap.ts", "content.ts"]);

  await Promise.all([
    access(path.join(root, "keymap.ts")),
    access(path.join(root, "content.ts")),
    access(path.join(root, "keymap.js")),
    access(path.join(root, "content.js")),
  ]);
  const keymap = await readFile(path.join(root, "keymap.js"), "utf8");
  assert.match(keymap, /globalThis\.WhatsVimKeymap/);
});
