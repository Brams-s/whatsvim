import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const numericPart = "(0|[1-9]\\d*)";
const versionPattern = new RegExp(`^${numericPart}\\.${numericPart}\\.${numericPart}(?:-alpha\\.${numericPart})?$`);

export function parsePackageVersion(version) {
  if (typeof version !== "string") throw new Error("package.json version must be a string");
  const match = version.match(versionPattern);
  if (!match) {
    throw new Error("package.json version must be x.y.z or x.y.z-alpha.N with numeric components");
  }
  const components = match.slice(1, 4).map(Number);
  const prerelease = match[4] === undefined ? null : Number(match[4]);
  if ([...components, prerelease].filter((value) => value !== null).some((value) => value > 65535)) {
    throw new Error("package.json version components must be between 0 and 65535");
  }
  if (components.every((value) => value === 0)) {
    throw new Error("package.json version core must not be Chrome-invalid 0.0.0");
  }
  return Object.freeze({
    exact: version,
    core: components.join("."),
    prerelease,
  });
}

export function manifestVersionForPackageVersion(version) {
  const parsed = parsePackageVersion(version);
  return Object.freeze({ version: parsed.core, version_name: parsed.exact });
}

export function checkVersionState(packageJson, manifest) {
  const packageVersion = parsePackageVersion(packageJson?.version);
  const expected = manifestVersionForPackageVersion(packageVersion.exact);
  if (manifest?.version !== expected.version || manifest?.version_name !== expected.version_name) {
    throw new Error(
      `version mismatch: package.json=${packageVersion.exact}, ` +
      `manifest.version=${manifest?.version ?? "<missing>"}, ` +
      `manifest.version_name=${manifest?.version_name ?? "<missing>"}`
    );
  }
  return Object.freeze({ packageVersion: packageVersion.exact, manifest, parsed: packageVersion });
}

export function checkLockfileVersionState(packageJson, lockfile) {
  const packageVersion = parsePackageVersion(packageJson?.version).exact;
  if (lockfile?.version !== packageVersion || lockfile?.packages?.[""]?.version !== packageVersion) {
    throw new Error(
      `lockfile version mismatch: package.json=${packageVersion}, ` +
      `package-lock.json=${lockfile?.version ?? "<missing>"}, ` +
      `package-lock.json packages[\"\"].version=${lockfile?.packages?.[""]?.version ?? "<missing>"}`
    );
  }
  return lockfile;
}

export function syncLockfileVersionState(packageJson, lockfile) {
  const packageVersion = parsePackageVersion(packageJson?.version).exact;
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages || typeof lockfile.packages[""] !== "object") {
    throw new Error("package-lock.json must contain a root packages[\"\"] entry");
  }
  lockfile.version = packageVersion;
  lockfile.packages[""].version = packageVersion;
  return lockfile;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function checkProjectVersions(projectRoot = root) {
  const [packageJson, manifest, lockfile] = await Promise.all([
    readJson(path.join(projectRoot, "package.json")),
    readJson(path.join(projectRoot, "manifest.json")),
    readJson(path.join(projectRoot, "package-lock.json")),
  ]);
  const state = checkVersionState(packageJson, manifest);
  checkLockfileVersionState(packageJson, lockfile);
  return Object.freeze({ ...state, lockfile });
}

export async function syncProjectVersions(projectRoot = root) {
  const [packageJson, manifest, lockfile] = await Promise.all([
    readJson(path.join(projectRoot, "package.json")),
    readJson(path.join(projectRoot, "manifest.json")),
    readJson(path.join(projectRoot, "package-lock.json")),
  ]);
  const expected = manifestVersionForPackageVersion(packageJson.version);
  const manifestPath = path.join(projectRoot, "manifest.json");
  if (manifest.version !== expected.version || manifest.version_name !== expected.version_name) {
    manifest.version = expected.version;
    manifest.version_name = expected.version_name;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const lockfilePath = path.join(projectRoot, "package-lock.json");
  const originalLockfileVersion = lockfile.version;
  const originalRootPackageVersion = lockfile?.packages?.[""]?.version;
  syncLockfileVersionState(packageJson, lockfile);
  if (lockfile.version !== originalLockfileVersion || lockfile.packages[""]?.version !== originalRootPackageVersion) {
    await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
  }
  return checkProjectVersions(projectRoot);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== "--check")) {
    throw new Error("usage: node scripts/version-sync.mjs [--check]");
  }
  const state = args[0] === "--check"
    ? await checkProjectVersions()
    : await syncProjectVersions();
  console.log(`Versions synchronized: ${state.packageVersion} (manifest ${state.parsed.core})`);
}
