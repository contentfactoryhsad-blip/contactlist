import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
const envFile = dotenv.parse(envRaw);

const keys = [
  "DATA_BACKEND",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_API_KEY",
  "AIRTABLE_TABLE_REQUESTS",
  "AIRTABLE_TABLE_ACTIVE_ACCESS",
  "AIRTABLE_TABLE_REFERENCE",
  "AIRTABLE_TABLE_ADMINS",
  "AIRTABLE_TABLE_SETTINGS",
  "AIRTABLE_TABLE_DELETED_REQUESTS",
  "AIRTABLE_TABLE_DELETED_ACTIVE_ACCESS",
  "AIRTABLE_TABLE_ACCESS_OTP",
  "AIRTABLE_TABLE_LOGIN_AUDIT",
  "ADMIN_PASSWORD",
  "SITE_PASSWORD",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "PUBLIC_BASE_URL"
];

const targetEnvs = ["production", "preview", "development"] as const;

function runVercel(args: string[], input?: string, allowFailure = false) {
  const token = process.env.VERCEL_TOKEN || envFile.VERCEL_TOKEN;
  const scope = process.env.VERCEL_SCOPE || envFile.VERCEL_SCOPE;

  const fullArgs = ["--yes", "vercel", ...args];
  if (token) {
    fullArgs.push("--token", token);
  }
  if (scope) {
    fullArgs.push("--scope", scope);
  }

  const result = spawnSync("npx", fullArgs, {
    cwd: rootDir,
    input,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.status !== 0 && !allowFailure) {
    const stderr = result.stderr?.trim() || "";
    const stdout = result.stdout?.trim() || "";
    throw new Error(`vercel ${args.join(" ")} failed. ${stderr || stdout}`.trim());
  }

  return result;
}

function getValue(key: string) {
  return process.env[key] ?? envFile[key] ?? "";
}

function main() {
  for (const key of keys) {
    const value = getValue(key);
    if (!value) {
      console.log(`skip: ${key} (empty)`);
      continue;
    }

    for (const envName of targetEnvs) {
      runVercel(["env", "rm", key, envName, "--yes"], undefined, true);
      runVercel(["env", "add", key, envName], `${value}\n`);
      console.log(`synced: ${key} -> ${envName}`);
    }
  }

  console.log("Vercel environment sync complete.");
}

try {
  main();
} catch (error) {
  console.error("Failed to sync Vercel env", error);
  console.error(
    "Hint: run `npx vercel login` or set VERCEL_TOKEN (and optional VERCEL_SCOPE)."
  );
  process.exit(1);
}
