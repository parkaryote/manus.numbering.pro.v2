const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function loadDotEnvIntoProcess(options = {}) {
  const cwd = options.cwd || process.cwd();
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return {};

  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const applied = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    applied[key] = value;
  }

  return applied;
}

module.exports = { loadDotEnvIntoProcess };
