#!/usr/bin/env node
const { spawn } = require("child_process");
const { loadDotEnvIntoProcess } = require("./load-env.cjs");

loadDotEnvIntoProcess({ cwd: process.cwd() });
process.env.NODE_ENV = "development";

const tsxCmd = process.platform === "win32" ? "tsx.cmd" : "tsx";
const child = spawn(tsxCmd, ["server/_core/index.ts"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
