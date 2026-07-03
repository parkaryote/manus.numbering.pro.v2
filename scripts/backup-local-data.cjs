#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const cwd = process.cwd();
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
const backupDir = path.join(cwd, "backups", `local-${timestamp}`);
const mysqlRoot = path.join(process.env.HOME || "", ".local", "mysql", "current");
const mysqldump = path.join(mysqlRoot, "bin", "mysqldump");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.stdio || "inherit",
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

if (!fs.existsSync(mysqldump)) {
  console.error(`mysqldump not found: ${mysqldump}`);
  process.exit(1);
}

run("bash", ["./scripts/start-local-mysql.sh"]);
fs.mkdirSync(backupDir, { recursive: true });

const sqlPath = path.join(backupDir, "typing_quiz_app.sql");
const sqlFile = fs.openSync(sqlPath, "w");
run(
  mysqldump,
  [
    "-uroot",
    "--protocol=TCP",
    "-h127.0.0.1",
    "-P3306",
    "--default-character-set=utf8mb4",
    "--single-transaction",
    "typing_quiz_app",
  ],
  { stdio: ["ignore", sqlFile, "inherit"] }
);
fs.closeSync(sqlFile);

const uploadsDir = path.join(cwd, "var", "uploads");
if (fs.existsSync(uploadsDir)) {
  run("tar", ["-czf", path.join(backupDir, "uploads.tgz"), "-C", path.join(cwd, "var"), "uploads"]);
}

fs.writeFileSync(
  path.join(backupDir, "README.txt"),
  [
    "numbering.pro local backup",
    `createdAt=${new Date().toISOString()}`,
    "database=typing_quiz_app.sql",
    "uploads=uploads.tgz",
    "",
  ].join("\n")
);

console.log(`Local backup saved: ${backupDir}`);
