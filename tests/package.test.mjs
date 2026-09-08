import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, parseArchive, verifyArchive } from "../scripts/verify-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const archivePath = path.join(root, "dist", `whatsvim-${packageVersion}.zip`);

async function freshArchive() {
  execFileSync(process.execPath, ["scripts/package.mjs"], { cwd: root, stdio: "inherit" });
  return readFile(archivePath);
}

function rewriteCrc(bytes, entry) {
  const crc = crc32(bytes.subarray(entry.payloadOffset, entry.payloadOffset + entry.compressedSize));
  bytes.writeUInt32LE(crc, entry.localOffset + 14);
  bytes.writeUInt32LE(crc, entry.centralOffset + 16);
}

test("package includes the MIT notice, valid deterministic timestamps, and no development files", () => {
  execFileSync(process.execPath, ["scripts/package.mjs"], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/verify-package.mjs"], { cwd: root, stdio: "inherit" });
});

test("package verifier rejects a central directory entry without its local entry", async () => {
  const archive = Buffer.from(await freshArchive());
  archive.writeUInt32LE(0, 0);
  assert.throws(() => parseArchive(archive), /local entry .*missing|invalid signature/);
});

test("package verifier rejects a corrupt local payload", async () => {
  const archive = Buffer.from(await freshArchive());
  const entry = parseArchive(archive).find(({ name }) => name === "content.js");
  archive[entry.payloadOffset] ^= 0x01;
  assert.throws(() => parseArchive(archive), /payload CRC32/);
});

test("package verifier rejects stale content.js with self-consistent ZIP metadata", async () => {
  const archive = Buffer.from(await freshArchive());
  const entry = parseArchive(archive).find(({ name }) => name === "content.js");
  archive[entry.payloadOffset] ^= 0x01;
  rewriteCrc(archive, entry);
  await assert.rejects(() => verifyArchive(archive, root), /content\.js payload matches the freshly built working tree/);
});

test("package verifier rejects a mismatched manifest with self-consistent ZIP metadata", async () => {
  const archive = Buffer.from(await freshArchive());
  const entry = parseArchive(archive).find(({ name }) => name === "manifest.json");
  archive[entry.payloadOffset] ^= 0x01;
  rewriteCrc(archive, entry);
  await assert.rejects(() => verifyArchive(archive, root), /manifest\.json payload matches the freshly built working tree/);
});

test("package verifier rejects duplicate local and central filenames", async () => {
  const archive = Buffer.from(await freshArchive());
  const source = parseArchive(archive).find(({ name }) => name === "icons/whatsvim-16.png");
  const target = Buffer.from("icons/whatsvim-32.png");
  assert.equal(target.length, Buffer.byteLength(source.name));
  target.copy(archive, source.localOffset + 30);
  target.copy(archive, source.centralOffset + 46);
  assert.throws(() => parseArchive(archive), /duplicate archive entry/);
});

test("package verifier rejects a symlink-only central metadata mutation", async () => {
  const archive = Buffer.from(await freshArchive());
  const entry = parseArchive(archive).find(({ name }) => name === "content.js");
  archive.writeUInt16LE(0x0314, entry.centralOffset + 4);
  archive.writeUInt32LE(0o120777 * 2 ** 16, entry.centralOffset + 38);
  assert.throws(() => parseArchive(archive), /generated regular-file metadata/);
});
