#!/usr/bin/env node
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const { loadDotEnvIntoProcess } = require("./load-env.cjs");

const cwd = process.cwd();
const localBaseUrl = process.env.LOCAL_BASE_URL || "http://localhost:3000";

// Force local persistence even when .env points at a production database.
process.env.DATABASE_URL =
  process.env.LOCAL_DATABASE_URL ||
  "mysql://app:app_pw@127.0.0.1:3306/typing_quiz_app";
process.env.LOCAL_UPLOAD_DIR =
  process.env.LOCAL_UPLOAD_DIR || path.join(cwd, "var", "uploads");
process.env.OAUTH_SERVER_URL = localBaseUrl;
process.env.VITE_OAUTH_PORTAL_URL = localBaseUrl;
process.env.GOOGLE_OAUTH_REDIRECT_URI = `${localBaseUrl}/login`;
process.env.VITE_GOOGLE_OAUTH_REDIRECT_URI = `${localBaseUrl}/login`;

loadDotEnvIntoProcess({ cwd });
process.env.NODE_ENV = "development";

const mysqlResult = spawnSync("bash", ["./scripts/start-local-mysql.sh"], {
  stdio: "inherit",
  env: process.env,
});
if (mysqlResult.status !== 0) {
  process.exit(mysqlResult.status ?? 1);
}

const tsxCmd = process.platform === "win32" ? "tsx.cmd" : "tsx";
const child = spawn(tsxCmd, ["server/_core/index.ts"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
