import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Runs tests/worker.test.mjs against the Cloudflare Worker served locally by
// `wrangler dev` (workerd, Durable Objects included), on the built dist/.
//
//   npm run build && npm run test:worker
//
// With WORKER_URL set, runs them against that address instead (the deploy
// workflow checks https://orion-aic.<account>.workers.dev this way).

const WRANGLER = "wrangler@4.158.0";

const run = (command, args, env = {}) =>
  new Promise((resolve) =>
    spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    }).on("exit", (code) => resolve(code ?? 1)),
  );

if (process.env.WORKER_URL)
  process.exit(await run("node", ["--test", "tests/worker.test.mjs"]));

if (!existsSync("dist/index.html")) {
  console.error("dist/ is missing: run npm run build first.");
  process.exit(1);
}
const port = Number(process.env.WORKER_PORT || 8790);
const url = `http://127.0.0.1:${port}`;
const dev = spawn(
  "npx",
  [
    "--yes",
    WRANGLER,
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--show-interactive-dev-session=false",
  ],
  { stdio: ["ignore", "ignore", "inherit"], detached: true },
);
const stop = () => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
};
process.on("exit", stop);
let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ready = await fetch(`${url}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
}
if (!ready) {
  console.error(`wrangler dev did not answer on ${url}`);
  process.exit(1);
}
const code = await run("node", ["--test", "tests/worker.test.mjs"], {
  WORKER_URL: url,
});
stop();
process.exit(code);
