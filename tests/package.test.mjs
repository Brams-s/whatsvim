import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package includes the MIT notice, valid deterministic timestamps, and no development files", () => {
  execFileSync(process.execPath, ["scripts/package.mjs"], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/verify-package.mjs"], { cwd: root, stdio: "inherit" });
});
