import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectVersions } from "./version-sync.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const packageFiles = [
  "manifest.json",
  "LICENSE",
  "content.css",
  "keymap.js",
  "content.js",
  "icons/whatsvim-16.png",
  "icons/whatsvim-32.png",
  "icons/whatsvim-48.png",
  "icons/whatsvim-128.png",
];
const dosTime = 0;
const dosDate = 0x0021; // 1980-01-01

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, data, crc) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, data]);
}

function centralHeader(name, data, crc, offset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(dosTime, 12);
  header.writeUInt16LE(dosDate, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(0o100644 * 2 ** 16, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

const { packageVersion } = await checkProjectVersions(root);
const entries = await Promise.all(packageFiles.map(async (name) => {
  const data = await readFile(path.join(root, name));
  return { name, data, crc: crc32(data) };
}));

let offset = 0;
const locals = [];
const central = [];
for (const entry of entries) {
  locals.push(localHeader(entry.name, entry.data, entry.crc));
  central.push(centralHeader(entry.name, entry.data, entry.crc, offset));
  offset += locals.at(-1).length;
}
const centralDirectory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const archive = path.join(dist, `whatsvim-${packageVersion}.zip`);
await writeFile(archive, Buffer.concat([...locals, centralDirectory, end]));
console.log(path.relative(root, archive));
