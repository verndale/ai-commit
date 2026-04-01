"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HUSKY_RANGE = "^9.1.7";

/**
 * @param {string} cwd
 * @returns {string} `pnpm exec` when a pnpm lockfile exists; otherwise `npx --no` (npm and Yarn).
 */
function detectPackageExec(cwd) {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm exec";
  }
  return "npx --no";
}

/**
 * @param {string} execPrefix from detectPackageExec
 * @param {"prepare-commit-msg" | "commit-msg"} hook
 */
function hookScript(execPrefix, hook) {
  const cmd =
    hook === "prepare-commit-msg"
      ? `${execPrefix} ai-commit prepare-commit-msg "$1" "$2"`
      : `${execPrefix} ai-commit lint --edit "$1"`;
  return `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

${cmd}
`;
}

/**
 * Run Husky’s initializer when `.husky/_/husky.sh` is missing (installs husky, creates `.husky`, sets prepare).
 * @param {string} cwd
 * @returns {{ ok: boolean, status: number | null, error?: string }}
 */
function runHuskyInit(cwd) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(npx, ["--yes", "husky@9", "init"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) {
    return { ok: false, status: null, error: r.error.message };
  }
  const status = r.status ?? 1;
  return { ok: status === 0, status };
}

/**
 * Ensure `commit` script, `prepare` for husky, and `devDependencies.husky`. Does not remove existing scripts.
 * @param {string} packageJsonPath
 * @returns {{ changed: boolean }}
 */
function mergePackageJsonForAiCommit(packageJsonPath) {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  let changed = false;

  pkg.scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  if (!pkg.scripts.commit) {
    pkg.scripts.commit = "ai-commit run";
    changed = true;
  }
  if (!pkg.scripts.prepare) {
    pkg.scripts.prepare = "husky";
    changed = true;
  }

  pkg.devDependencies =
    pkg.devDependencies && typeof pkg.devDependencies === "object"
      ? pkg.devDependencies
      : {};
  if (!pkg.devDependencies.husky) {
    pkg.devDependencies.husky = HUSKY_RANGE;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  return { changed };
}

/**
 * If `prepare` exists but does not run husky, print a hint (do not rewrite arbitrary scripts).
 * @param {string} packageJsonPath
 */
function warnIfPrepareMissingHusky(packageJsonPath) {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  const p = pkg.scripts && pkg.scripts.prepare;
  if (typeof p === "string" && p.trim() && !/\bhusky\b/.test(p)) {
    process.stderr.write(
      "warning: package.json has a \"prepare\" script that does not mention husky; ensure Husky runs on install (see https://typicode.github.io/husky/).\n",
    );
  }
}

module.exports = {
  HUSKY_RANGE,
  detectPackageExec,
  hookScript,
  runHuskyInit,
  mergePackageJsonForAiCommit,
  warnIfPrepareMissingHusky,
};
