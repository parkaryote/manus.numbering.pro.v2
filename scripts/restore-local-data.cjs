#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const cwd = process.cwd();
const backupArg = process.argv[2];
const mysqlRoot = path.join(process.env.HOME || "", ".local", "mysql", "current");
const mysql = path.join(mysqlRoot, "bin", "mysql");

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

function latestBackupDir() {
  const backupsRoot = path.join(cwd, "backups");
  if (!fs.existsSync(backupsRoot)) return null;
  return fs
    .readdirSync(backupsRoot)
    .filter(name => name.startsWith("local-"))
    .sort()
    .reverse()
    .map(name => path.join(backupsRoot, name))[0] || null;
}

const backupDir = backupArg ? path.resolve(cwd, backupArg) : latestBackupDir();
if (!backupDir || !fs.existsSync(backupDir)) {
  console.error("Backup directory not found. Usage: pnpm local:restore backups/local-YYYYMMDD-HHMMSS");
  process.exit(1);
}

const sqlPath = path.join(backupDir, "typing_quiz_app.sql");
if (!fs.existsSync(sqlPath)) {
  console.error(`SQL backup not found: ${sqlPath}`);
  process.exit(1);
}

run("bash", ["./scripts/start-local-mysql.sh"]);
run(mysql, ["-uroot", "--protocol=TCP", "-h127.0.0.1", "-P3306", "-e", "DROP DATABASE IF EXISTS typing_quiz_app; CREATE DATABASE typing_quiz_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"]);

const sqlFile = fs.openSync(sqlPath, "r");
run(mysql, ["-uroot", "--protocol=TCP", "-h127.0.0.1", "-P3306", "typing_quiz_app"], {
  stdio: [sqlFile, "inherit", "inherit"],
});
fs.closeSync(sqlFile);

const uploadsArchive = path.join(backupDir, "uploads.tgz");
if (fs.existsSync(uploadsArchive)) {
  fs.rmSync(path.join(cwd, "var", "uploads"), { recursive: true, force: true });
  fs.mkdirSync(path.join(cwd, "var"), { recursive: true });
  run("tar", ["-xzf", uploadsArchive, "-C", path.join(cwd, "var")]);
}

console.log(`Local backup restored: ${backupDir}`);
