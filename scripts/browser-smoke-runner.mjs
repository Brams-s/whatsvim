import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromium = process.env.CHROMIUM_BIN || "chromium";
const token = crypto.randomUUID();
let profile = null;
let browser = null;
let harness = null;
let cleanupPromise = null;
let requestedSignal = null;
let resolveSignal;
const signalReceived = new Promise((resolve) => { resolveSignal = resolve; });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function observe(child) {
  let settled = false;
  const completion = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ error, code: child.exitCode, signal: child.signalCode }));
    child.once("exit", (code, signal) => finish({ error: null, code: child.exitCode ?? code, signal: child.signalCode ?? signal }));
  });
  return { child, completion };
}

function spawnObserved(command, args, options) {
  // Register lifecycle observation in the same turn that owns the spawned
  // child, before any readiness or harness work can begin.
  return observe(spawn(command, args, options));
}

function hasExited(handle) {
  return !handle || handle.child.exitCode !== null || handle.child.signalCode !== null;
}

async function waitForTestGate(phase) {
  const gate = process.env[`WHATSVIM_SMOKE_TEST_${phase}_GATE`];
  if (!gate) return;
  await writeFile(`${gate}.ready`, String(process.pid));
  const release = `${gate}.release`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await access(release);
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Timed out waiting for ${phase.toLowerCase()} acquisition test gate`);
}

async function acquireProfile(profileParent) {
  const acquired = await mkdtemp(path.join(profileParent, "whatsvim-smoke-"));
  // Test-only gates hold an already-created resource before it is returned to
  // the owner. Production has no gate, so this is exactly one mkdtemp await.
  await waitForTestGate("PROFILE");
  return acquired;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    throw new Error("Could not reserve a TCP port");
  }
  try {
    // Keep the socket reserved while the test pauses this acquisition.
    await waitForTestGate("PORT");
    return address.port;
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function terminate(handle) {
  if (hasExited(handle)) return;
  try {
    handle.child.kill("SIGTERM");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  const stopped = await Promise.race([handle.completion, delay(2000).then(() => null)]);
  if (stopped) return;
  if (!hasExited(handle)) {
    try {
      handle.child.kill("SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  await Promise.race([handle.completion, delay(2000)]);
}

async function removeOwnedProfile() {
  if (!profile) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await delay(200);
    }
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    try {
      await terminate(harness);
      await terminate(browser);
    } finally {
      await removeOwnedProfile();
    }
  })();
  return cleanupPromise;
}

async function waitForReady(endpoint, handle) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (hasExited(handle)) {
      const stopped = await handle.completion;
      const detail = stopped.error?.message || stopped.signal || stopped.code;
      throw new Error(`Dedicated Chromium exited before readiness: ${detail}`);
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The owned debugging endpoint is not ready yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for dedicated Chromium debugging endpoint");
}

function startHarness(endpoint) {
  const harnessScript = process.env.WHATSVIM_SMOKE_HARNESS_SCRIPT || "tests/browser-smoke.mjs";
  return spawnObserved(process.execPath, [harnessScript], {
    cwd: root,
    env: {
      ...process.env,
      WHATSVIM_SMOKE_ENDPOINT: endpoint,
      WHATSVIM_SMOKE_TARGET_TOKEN: token,
    },
    stdio: "inherit",
  });
}

function startBrowser(port, targetUrl) {
  const browserScript = process.env.WHATSVIM_SMOKE_BROWSER_SCRIPT;
  if (browserScript) {
    return spawnObserved(process.execPath, [browserScript, String(port)], { stdio: "ignore" });
  }
  return spawnObserved(chromium, [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    `--load-extension=${root}`,
    targetUrl,
  ], { stdio: "ignore" });
}

const onSignal = (signal) => {
  if (requestedSignal) return;
  requestedSignal = signal;
  resolveSignal(signal);
  // Acquisition can still be resolving. Record and wake cancellation now;
  // the outer finally owns cleanup only after those resources settle.
  const marker = process.env.WHATSVIM_SMOKE_TEST_SIGNAL_MARKER;
  if (marker) void writeFile(marker, signal).catch(() => {});
};
const onSigint = () => onSignal("SIGINT");
const onSigterm = () => onSignal("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  const profileParent = process.env.WHATSVIM_SMOKE_PROFILE_PARENT || os.tmpdir();
  profile = await acquireProfile(profileParent);
  if (!requestedSignal) {
    const port = await reservePort();
    if (!requestedSignal) {
      const endpoint = `http://127.0.0.1:${port}`;
      const targetUrl = `https://web.whatsapp.com/?whatsvim-smoke=${encodeURIComponent(token)}`;
      if (!requestedSignal) browser = startBrowser(port, targetUrl);
      if (browser) {
        await Promise.race([
          waitForReady(endpoint, browser),
          signalReceived.then((signal) => { throw new Error(`Received ${signal}`); }),
        ]);
      }
      if (!requestedSignal) harness = startHarness(endpoint);
      if (harness) {
        const result = await Promise.race([
          harness.completion,
          signalReceived.then((signal) => { throw new Error(`Received ${signal}`); }),
        ]);
        if (result.error || result.code !== 0 || result.signal) {
          throw new Error(`Browser smoke harness exited with ${result.error?.message || (result.code ?? result.signal)}`);
        }
      }
    }
  }
} catch (error) {
  if (!requestedSignal) {
    process.exitCode = 1;
    console.error(error);
  }
} finally {
  await cleanup();
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
}

if (requestedSignal) process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
