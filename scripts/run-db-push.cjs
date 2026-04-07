#!/usr/bin/env node
const { spawnSync } = require("child_process");
const { loadDotEnvIntoProcess } = require("./load-env.cjs");

loadDotEnvIntoProcess({ cwd: process.cwd() });

const drizzleCmd = process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit";

const run = args => {
  const result = spawnSync(drizzleCmd, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(["generate"]);
run(["migrate"]);
