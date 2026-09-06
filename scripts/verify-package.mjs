import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectVersions } from "./version-sync.mjs";
import { validateArchiveNames, validateProjectPolicy } from "./policy-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { packageVersion } = await checkProjectVersions(root);

function archiveEntries(bytes) {
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  assert.notEqual(end, -1, "ZIP end-of-central-directory record is present");
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, "ZIP central-directory entry is valid");
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    entries.push({
      name: bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      dosTime: bytes.readUInt16LE(cursor + 12),
      dosDate: bytes.readUInt16LE(cursor + 14),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

await validateProjectPolicy(root);

const archive = path.join(root, "dist", `whatsvim-${packageVersion}.zip`);
const entries = archiveEntries(await readFile(archive));
const names = entries.map(({ name }) => name);
assert.equal(names.filter((name) => name === "LICENSE").length, 1,
  "package includes one MIT LICENSE notice at the ZIP root");
validateArchiveNames(names.filter((name) => name !== "LICENSE"));
for (const entry of entries) {
  assert.equal(entry.dosTime, 0, `${entry.name} has deterministic DOS midnight time`);
  assert.equal(entry.dosDate, 0x0021, `${entry.name} has deterministic DOS date 1980-01-01`);
}
for (const name of names) {
  assert.doesNotMatch(name, /^(tests|scripts|node_modules|\.git)\/|(^|\/)\.(?:git|DS_Store)$|\.md$/,
    "package excludes development and documentation files");
}

console.log("Manifest and package verification passed");
