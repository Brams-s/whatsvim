import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runHarness(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/browser-smoke.mjs"], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status, stderr }));
  });
}

function runRunner(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/browser-smoke-runner.mjs"], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (status, signal) => resolve({ child, status, signal, stderr }));
  });
}

async function withProfileParent(callback) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "whatsvim-runner-test-"));
  try {
    await callback(parent);
    assert.equal((await readdir(parent)).some((entry) => entry.startsWith("whatsvim-smoke-")), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function waitUntil(read, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for controlled runner state");
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function spawnRunner(environment) {
  return spawn(process.execPath, ["scripts/browser-smoke-runner.mjs"], {
    cwd: root,
    env: environment,
    stdio: "ignore",
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (status, signal) => resolve({ status, signal })));
}

async function writeReadyBrowser(directory, pidFile) {
  const script = path.join(directory, "ready-browser.mjs");
  await writeFile(script, `
    import { writeFile } from "node:fs/promises";
    import http from "node:http";
    await writeFile(${JSON.stringify(pidFile)}, String(process.pid));
    const port = Number(process.argv[2]);
    const server = http.createServer((request, response) => {
      if (request.url === "/json/version") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ Browser: "WhatsVim test browser" }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(port, "127.0.0.1");
    setInterval(() => {}, 1000);
  `);
  return script;
}

test("browser harness refuses an undesignated endpoint before CDP mutation", () => {
  const result = spawnSync(process.execPath, ["tests/browser-smoke.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WHATSVIM_SMOKE_ENDPOINT: "", WHATSVIM_SMOKE_TARGET_TOKEN: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runner-owned debugging endpoint/);
});

test("browser harness refuses a wrong-origin target before CDP mutation", async () => {
  const token = "fixture-token";
  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{
        type: "page",
        url: `https://example.test/?whatsvim-smoke=${token}`,
        webSocketDebuggerUrl: "ws://example.test/devtools/page/unsafe",
      }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await runHarness({
      ...process.env,
      WHATSVIM_SMOKE_ENDPOINT: `http://127.0.0.1:${address.port}`,
      WHATSVIM_SMOKE_TARGET_TOKEN: token,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runner-designated WhatsApp fixture target/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("runner removes its owned profile when Chromium cannot spawn", async () => {
  await withProfileParent(async (profileParent) => {
    const result = await runRunner({
      ...process.env,
      CHROMIUM_BIN: path.join(profileParent, "missing-chromium"),
      WHATSVIM_SMOKE_PROFILE_PARENT: profileParent,
    });
    assert.notEqual(result.status, 0);
  });
});

test("runner removes its owned profile when Chromium is signaled before readiness", async () => {
  await withProfileParent(async (profileParent) => {
    const browser = path.join(profileParent, "signaled-browser.mjs");
    await writeFile(browser, 'process.kill(process.pid, "SIGTERM");');
    const result = await runRunner({
      ...process.env,
      WHATSVIM_SMOKE_BROWSER_SCRIPT: browser,
      WHATSVIM_SMOKE_PROFILE_PARENT: profileParent,
    });
    assert.notEqual(result.status, 0);
  });
});

test("terminating the runner stops its owned harness and removes its profile", async () => {
  await withProfileParent(async (profileParent) => {
    const harness = path.join(profileParent, "hold-harness.mjs");
    const pidFile = path.join(profileParent, "harness.pid");
    const browserPidFile = path.join(profileParent, "browser.pid");
    const browser = await writeReadyBrowser(profileParent, browserPidFile);
    await writeFile(harness, `import { writeFile } from "node:fs/promises"; await writeFile(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
    const child = spawn(process.execPath, ["scripts/browser-smoke-runner.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        WHATSVIM_SMOKE_PROFILE_PARENT: profileParent,
        WHATSVIM_SMOKE_HARNESS_SCRIPT: harness,
        WHATSVIM_SMOKE_BROWSER_SCRIPT: browser,
      },
      stdio: "ignore",
    });
    try {
      await waitUntil(async () => {
        try {
          await writeFile(path.join(profileParent, ".probe"), "");
          const entries = await readdir(profileParent);
          return entries.some((entry) => entry.startsWith("whatsvim-smoke-")) && entries.includes("harness.pid") && entries.includes("browser.pid");
        } catch {
          return false;
        }
      });
      child.kill("SIGTERM");
      const [status, signal] = await new Promise((resolve) => child.once("exit", (exitStatus, exitSignal) => resolve([exitStatus, exitSignal])));
      assert.equal(status, 143);
      assert.equal(signal, null);
      const harnessPid = Number(await readFile(pidFile, "utf8"));
      const browserPid = Number(await readFile(browserPidFile, "utf8"));
      assert.throws(() => process.kill(harnessPid, 0), { code: "ESRCH" });
      assert.throws(() => process.kill(browserPid, 0), { code: "ESRCH" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
});

for (const phase of ["PROFILE", "PORT"]) {
  test(`SIGTERM during ${phase.toLowerCase()} acquisition cleans the profile without spawning a browser`, async () => {
    await withProfileParent(async (profileParent) => {
      const gate = path.join(profileParent, `${phase.toLowerCase()}-gate`);
      const signalMarker = path.join(profileParent, `${phase.toLowerCase()}-signal`);
      const browserMarker = path.join(profileParent, `${phase.toLowerCase()}-browser.pid`);
      const browser = await writeReadyBrowser(profileParent, browserMarker);
      const child = spawnRunner({
        ...process.env,
        WHATSVIM_SMOKE_PROFILE_PARENT: profileParent,
        WHATSVIM_SMOKE_BROWSER_SCRIPT: browser,
        WHATSVIM_SMOKE_TEST_SIGNAL_MARKER: signalMarker,
        [`WHATSVIM_SMOKE_TEST_${phase}_GATE`]: gate,
      });
      try {
        await waitUntil(() => exists(`${gate}.ready`));
        child.kill("SIGTERM");
        await waitUntil(() => exists(signalMarker));
        await writeFile(`${gate}.release`, "release");
        const { status, signal } = await waitForExit(child);
        assert.equal(status, 143);
        assert.equal(signal, null);
        assert.equal(await exists(browserMarker), false);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    });
  });
}
