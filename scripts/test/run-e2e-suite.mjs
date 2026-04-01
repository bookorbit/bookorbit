#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getE2ESuite, listE2ESuites } from "./e2e-suites.mjs";

const DEFAULT_E2E_DATABASE_URL = "postgres://projectx:projectx@localhost:5432/projectx_e2e";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..", "..");
const resultsDir = join(rootDir, "test-results", "server");

function isCiEnvironment() {
  return (process.env.CI ?? "").toLowerCase() === "true";
}

function trimLeadingSeparator(args) {
  if (args[0] === "--") {
    return args.slice(1);
  }
  return args;
}

function printUsage() {
  const usage = [
    "Usage:",
    "  pnpm run test:e2e -- <suite-id> [vitest args...]",
    "",
    "Examples:",
    "  pnpm run test:e2e -- smoke",
    "  pnpm run test:e2e -- all",
    "  pnpm run test:e2e -- scanner --testNamePattern=book-per-folder-disc-folder-flattening",
    "  pnpm run test:e2e -- --list",
    "  pnpm run test:e2e:list",
  ];
  console.log(usage.join("\n"));
}

function printSuiteList() {
  const suites = listE2ESuites();
  console.log("Available e2e suites:");
  console.log("- all [composite] - Run all suites sequentially");
  for (const suite of suites) {
    const dbMode = suite.prepareDedicatedDatabase ? "dedicated-db" : "default-db";
    console.log(`- ${suite.id} [${dbMode}] - ${suite.description}`);
  }
}

async function runCommand(command, args, envOverrides = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...envOverrides },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`Command failed (${reason}): ${command} ${args.join(" ")}`));
    });
  });
}

async function main() {
  const cliArgs = trimLeadingSeparator(process.argv.slice(2));
  if (cliArgs.length === 0 || cliArgs.includes("--help") || cliArgs.includes("-h")) {
    printUsage();
    process.exit(cliArgs.length === 0 ? 1 : 0);
  }

  if (cliArgs.includes("--list")) {
    printSuiteList();
    return;
  }

  const [suiteId, ...remainingArgs] = cliArgs;
  const vitestArgs = trimLeadingSeparator(remainingArgs);
  const suites = suiteId === "all" ? listE2ESuites() : [getE2ESuite(suiteId)];

  if (suiteId !== "all" && !suites[0]) {
    console.error(`Unknown e2e suite "${suiteId}".`);
    printSuiteList();
    process.exit(1);
  }

  if (suiteId === "all" && suites.length === 0) {
    console.error("No e2e suites are configured.");
    process.exit(1);
  }

  if (suiteId === "all" && process.env.JUNIT_OUTPUT) {
    console.error("JUNIT_OUTPUT is only supported when running a single suite. Unset JUNIT_OUTPUT or run one suite id.");
    process.exit(1);
  }

  mkdirSync(resultsDir, { recursive: true });

  const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  if (!isCiEnvironment() && suites.some((suite) => suite.prepareDedicatedDatabase)) {
    console.log("Starting local PostgreSQL (dev compose)...");
    await runCommand("pnpm", ["run", "db:up"]);
  }

  for (const [index, suite] of suites.entries()) {
    // E2E_DATABASE_URL is not in .env so pnpm's auto-loading cannot override it.
    // vitest.config.e2e.ts reads this and injects it as DATABASE_URL into all
    // test workers, ensuring NestJS never connects to the dev database.
    const runEnvironment = { E2E_DATABASE_URL: e2eDatabaseUrl };

    if (suite.prepareDedicatedDatabase) {
      console.log(`Resetting and migrating dedicated e2e database for suite ${suite.id}...`);
      await runCommand("pnpm", ["run", "db:prepare:e2e"], { E2E_DATABASE_URL: e2eDatabaseUrl });
    }

    const junitOutput = process.env.JUNIT_OUTPUT ?? suite.junitOutput;
    if (suites.length > 1) {
      console.log(`Running e2e suite [${index + 1}/${suites.length}]: ${suite.id}...`);
    } else {
      console.log(`Running e2e suite: ${suite.id}...`);
    }

    await runCommand(
      "pnpm",
      [
        "--filter",
        "server",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.config.e2e.ts",
        suite.vitestTarget,
        "--reporter=default",
        "--reporter=junit",
        `--outputFile.junit=${junitOutput}`,
        ...vitestArgs,
      ],
      runEnvironment,
    );
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
