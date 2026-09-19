// Blocks until the api and web containers answer their Render health checks, so a slow JVM start
// reads as "waiting" rather than as a failed first test. Exits non-zero after the deadline.

const targets = [
  `${process.env.E2E_API_ORIGIN}/health`,
  `${process.env.E2E_WEB_ORIGIN}/api/health`,
  `${process.env.E2E_FIXTURE_ORIGIN}/marketing.html`,
];
const deadline = Date.now() + 180_000;

async function ok(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

for (const url of targets) {
  process.stdout.write(`waiting for ${url} `);
  while (!(await ok(url))) {
    if (Date.now() > deadline) {
      console.error(`\n${url} did not become healthy within 180s`);
      process.exit(1);
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.log(" ok");
}
