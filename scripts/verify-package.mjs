import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectVersions } from "./version-sync.mjs";
import { validateArchiveNames, validateProjectPolicy } from "./policy-check.mjs";

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const endSignature = 0x06054b50;
const utf8Flag = 0x0800;
const deterministicTime = 0;
const deterministicDate = 0x0021;
const generatedCentralVersion = 20;
const generatedInternalAttributes = 0;
const generatedRegularFileAttributes = 0o100644 * 2 ** 16;

function fail(message) {
  throw new Error(`Invalid WhatsVim package: ${message}`);
}

function within(bytes, offset, length, description) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    fail(`${description} is outside archive bounds`);
  }
}

function uint16(bytes, offset, description) {
  within(bytes, offset, 2, description);
  return bytes.readUInt16LE(offset);
}

function uint32(bytes, offset, description) {
  within(bytes, offset, 4, description);
  return bytes.readUInt32LE(offset);
}

function utf8Name(bytes, offset, length, description) {
  within(bytes, offset, length, description);
  const encoded = bytes.subarray(offset, offset + length);
  const name = encoded.toString("utf8");
  if (!Buffer.from(name, "utf8").equals(encoded) || !name || name.includes("\0")) {
    fail(`${description} is not a valid UTF-8 filename`);
  }
  return { encoded, name };
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const start = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (uint32(bytes, offset, "ZIP end-of-central-directory signature") !== endSignature) continue;
    const commentLength = uint16(bytes, offset + 20, "ZIP end-of-central-directory comment length");
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  fail("ZIP end-of-central-directory record is missing or has trailing data");
}

export function parseArchive(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const end = findEndOfCentralDirectory(bytes);
  if (uint16(bytes, end + 4, "ZIP disk number") !== 0 || uint16(bytes, end + 6, "ZIP central-directory disk") !== 0) {
    fail("multi-disk ZIP archives are not supported");
  }
  const diskEntries = uint16(bytes, end + 8, "ZIP disk entry count");
  const count = uint16(bytes, end + 10, "ZIP total entry count");
  const centralSize = uint32(bytes, end + 12, "ZIP central-directory size");
  const centralOffset = uint32(bytes, end + 16, "ZIP central-directory offset");
  if (diskEntries !== count || count === 0 || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("ZIP64, empty, or inconsistent central-directory metadata is not supported");
  }
  within(bytes, centralOffset, centralSize, "ZIP central directory");
  if (centralOffset + centralSize !== end) fail("ZIP central directory does not end at the end-of-central-directory record");

  const entries = [];
  const seenNames = new Set();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (uint32(bytes, cursor, `central entry ${index} signature`) !== centralSignature) fail(`central entry ${index} has an invalid signature`);
    within(bytes, cursor, 46, `central entry ${index} header`);
    const versionMadeBy = uint16(bytes, cursor + 4, `central entry ${index} version made by`);
    const versionNeeded = uint16(bytes, cursor + 6, `central entry ${index} version needed`);
    const flags = uint16(bytes, cursor + 8, `central entry ${index} flags`);
    const method = uint16(bytes, cursor + 10, `central entry ${index} method`);
    const dosTime = uint16(bytes, cursor + 12, `central entry ${index} time`);
    const dosDate = uint16(bytes, cursor + 14, `central entry ${index} date`);
    const crc = uint32(bytes, cursor + 16, `central entry ${index} CRC32`);
    const compressedSize = uint32(bytes, cursor + 20, `central entry ${index} compressed size`);
    const uncompressedSize = uint32(bytes, cursor + 24, `central entry ${index} uncompressed size`);
    const nameLength = uint16(bytes, cursor + 28, `central entry ${index} filename length`);
    const extraLength = uint16(bytes, cursor + 30, `central entry ${index} extra length`);
    const commentLength = uint16(bytes, cursor + 32, `central entry ${index} comment length`);
    const internalAttributes = uint16(bytes, cursor + 36, `central entry ${index} internal attributes`);
    const externalAttributes = uint32(bytes, cursor + 38, `central entry ${index} external attributes`);
    const localOffset = uint32(bytes, cursor + 42, `central entry ${index} local offset`);
    const size = 46 + nameLength + extraLength + commentLength;
    within(bytes, cursor, size, `central entry ${index}`);
    if (cursor + size > centralOffset + centralSize) fail(`central entry ${index} extends beyond the central directory`);
    if (flags !== utf8Flag || method !== 0 || extraLength !== 0 || commentLength !== 0) {
      fail(`central entry ${index} uses unsupported flags, compression, extra data, or comment`);
    }
    if (
      versionMadeBy !== generatedCentralVersion ||
      versionNeeded !== generatedCentralVersion ||
      internalAttributes !== generatedInternalAttributes ||
      externalAttributes !== generatedRegularFileAttributes
    ) {
      fail(`central entry ${index} does not have generated regular-file metadata`);
    }
    if (compressedSize !== uncompressedSize) fail(`central entry ${index} has inconsistent stored sizes`);
    const { encoded: centralNameBytes, name } = utf8Name(bytes, cursor + 46, nameLength, `central entry ${index} filename`);
    if (seenNames.has(name)) fail(`duplicate archive entry ${name}`);
    seenNames.add(name);
    entries.push({ name, dosTime, dosDate, crc, compressedSize, uncompressedSize, localOffset, centralOffset: cursor, centralNameBytes });
    cursor += size;
  }
  if (cursor !== centralOffset + centralSize) fail("central directory has unparsed or trailing entry data");

  let expectedLocalOffset = 0;
  for (const [index, entry] of entries.entries()) {
    if (entry.localOffset !== expectedLocalOffset) fail(`local entry ${entry.name} is overlapping, reordered, or leaves a gap`);
    if (entry.localOffset >= centralOffset || uint32(bytes, entry.localOffset, `local entry ${entry.name} signature`) !== localSignature) {
      fail(`local entry ${entry.name} is missing or has an invalid signature`);
    }
    within(bytes, entry.localOffset, 30, `local entry ${entry.name} header`);
    const version = uint16(bytes, entry.localOffset + 4, `local entry ${entry.name} version`);
    const flags = uint16(bytes, entry.localOffset + 6, `local entry ${entry.name} flags`);
    const method = uint16(bytes, entry.localOffset + 8, `local entry ${entry.name} method`);
    const dosTime = uint16(bytes, entry.localOffset + 10, `local entry ${entry.name} time`);
    const dosDate = uint16(bytes, entry.localOffset + 12, `local entry ${entry.name} date`);
    const crc = uint32(bytes, entry.localOffset + 14, `local entry ${entry.name} CRC32`);
    const compressedSize = uint32(bytes, entry.localOffset + 18, `local entry ${entry.name} compressed size`);
    const uncompressedSize = uint32(bytes, entry.localOffset + 22, `local entry ${entry.name} uncompressed size`);
    const nameLength = uint16(bytes, entry.localOffset + 26, `local entry ${entry.name} filename length`);
    const extraLength = uint16(bytes, entry.localOffset + 28, `local entry ${entry.name} extra length`);
    if (version !== 20 || flags !== utf8Flag || method !== 0 || extraLength !== 0) fail(`local entry ${entry.name} uses unsupported header fields`);
    if (dosTime !== entry.dosTime || dosDate !== entry.dosDate || crc !== entry.crc || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize) {
      fail(`local entry ${entry.name} does not match its central-directory metadata`);
    }
    const { encoded: localNameBytes } = utf8Name(bytes, entry.localOffset + 30, nameLength, `local entry ${entry.name} filename`);
    if (!localNameBytes.equals(entry.centralNameBytes)) fail(`local entry ${entry.name} filename does not match its central-directory filename`);
    const payloadOffset = entry.localOffset + 30 + nameLength;
    within(bytes, payloadOffset, compressedSize, `local entry ${entry.name} payload`);
    const data = bytes.subarray(payloadOffset, payloadOffset + compressedSize);
    if (crc32(data) !== entry.crc) fail(`local entry ${entry.name} payload CRC32 does not match`);
    expectedLocalOffset = payloadOffset + compressedSize;
    entries[index] = { ...entry, payloadOffset, data: Buffer.from(data) };
  }
  if (expectedLocalOffset !== centralOffset) fail("local entry region has trailing or unreferenced data");
  return entries;
}

export async function verifyArchive(bytes, root) {
  const entries = parseArchive(bytes);
  const names = entries.map(({ name }) => name);
  assert.equal(names.filter((name) => name === "LICENSE").length, 1,
    "package includes one MIT LICENSE notice at the ZIP root");
  validateArchiveNames(names.filter((name) => name !== "LICENSE"));
  for (const entry of entries) {
    assert.equal(entry.dosTime, deterministicTime, `${entry.name} has deterministic DOS midnight time`);
    assert.equal(entry.dosDate, deterministicDate, `${entry.name} has deterministic DOS date 1980-01-01`);
    assert.doesNotMatch(entry.name, /^(tests|scripts|node_modules|\.git)\/|(^|\/)\.(?:git|DS_Store)$|\.md$/,
      "package excludes development and documentation files");
    assert.deepEqual(entry.data, await readFile(path.join(root, entry.name)),
      `${entry.name} payload matches the freshly built working tree`);
  }
  return entries;
}

export async function verifyPackage(root) {
  const { packageVersion } = await checkProjectVersions(root);
  await validateProjectPolicy(root);
  const archive = path.join(root, "dist", `whatsvim-${packageVersion}.zip`);
  await verifyArchive(await readFile(archive), root);
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await verifyPackage(root);
  console.log("Manifest and package verification passed");
}
