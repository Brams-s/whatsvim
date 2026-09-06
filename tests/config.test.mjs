import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Changesets config uses the privatePackages option", async () => {
  const config = JSON.parse(await readFile(path.join(root, ".changeset", "config.json"), "utf8"));
  assert.deepEqual(config.privatePackages, { version: true, tag: false });
  assert.equal("privatePakcs" in config, false);
});

test("Changesets starts in normal mode without retired alpha bookkeeping", async () => {
  await assert.rejects(access(path.join(root, ".changeset", "pre.json")), { code: "ENOENT" });
  await assert.rejects(access(path.join(root, ".changeset", "pre")), { code: "ENOENT" });
});
