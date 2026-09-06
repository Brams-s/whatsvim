import assert from "node:assert/strict";
import test from "node:test";
import {
  checkVersionState,
  checkLockfileVersionState,
  manifestVersionForPackageVersion,
  parsePackageVersion,
  syncLockfileVersionState,
} from "../scripts/version-sync.mjs";

test("maps stable and alpha package versions to manifest fields", () => {
  assert.deepEqual(manifestVersionForPackageVersion("12.34.56"), {
    version: "12.34.56",
    version_name: "12.34.56",
  });
  assert.deepEqual(manifestVersionForPackageVersion("12.34.56-alpha.7"), {
    version: "12.34.56",
    version_name: "12.34.56-alpha.7",
  });
});

test("accepts only Chrome-valid bounded numeric versions", () => {
  assert.equal(parsePackageVersion("0.0.1-alpha.0").core, "0.0.1");
  for (const invalid of ["0.0.0", "0.0.0-alpha.0", "1.2", "1.2.3-beta.1", "1.2.3-alpha", "01.2.3", "1.2.3-alpha.01", "65536.0.0"]) {
    assert.throws(() => parsePackageVersion(invalid), /version/);
  }
});

test("check detects manifest desynchronization without synchronizing it", () => {
  const packageJson = { version: "1.2.3-alpha.4" };
  const manifest = { version: "1.2.3", version_name: "1.2.3" };
  assert.throws(() => checkVersionState(packageJson, manifest), /version mismatch/);
  assert.deepEqual(manifest, { version: "1.2.3", version_name: "1.2.3" });
});

test("lockfile check detects mismatch and sync changes only root versions", () => {
  const packageJson = { version: "1.2.3-alpha.4" };
  const lockfile = {
    version: "1.2.2",
    packages: {
      "": { version: "1.2.2", devDependencies: { example: "1.0.0" } },
      "node_modules/example": { version: "1.0.0", resolved: "https://example.invalid/example.tgz" },
    },
  };
  const dependencyEntry = structuredClone(lockfile.packages["node_modules/example"]);
  assert.throws(() => checkLockfileVersionState(packageJson, lockfile), /lockfile version mismatch/);
  syncLockfileVersionState(packageJson, lockfile);
  assert.doesNotThrow(() => checkLockfileVersionState(packageJson, lockfile));
  assert.equal(lockfile.version, "1.2.3-alpha.4");
  assert.equal(lockfile.packages[""].version, "1.2.3-alpha.4");
  assert.deepEqual(lockfile.packages["node_modules/example"], dependencyEntry);
});
