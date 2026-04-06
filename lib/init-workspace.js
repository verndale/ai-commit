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
 * Resolve directory and install command by walking from `packageRoot` up to `gitRoot` (inclusive)
 * looking for a lockfile. Falls back to `npm install` at `packageRoot` when none is found.
 * @param {string} packageRoot
 * @param {string | null} gitRoot
 * @returns {{ cwd: string, cmd: string }}
 */
function detectPackageInstallInfo(packageRoot, gitRoot) {
  const pkg = path.resolve(packageRoot);
  const top = gitRoot ? path.resolve(gitRoot) : pkg;
  let dir = pkg;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
      return { cwd: dir, cmd: "pnpm install" };
    }
    if (fs.existsSync(path.join(dir, "yarn.lock"))) {
      return { cwd: dir, cmd: "yarn install" };
    }
    if (fs.existsSync(path.join(dir, "package-lock.json"))) {
      return { cwd: dir, cmd: "npm install" };
    }
    if (
      fs.existsSync(path.join(dir, "bun.lockb")) ||
      fs.existsSync(path.join(dir, "bun.lock"))
    ) {
      return { cwd: dir, cmd: "bun install" };
    }
    if (path.resolve(dir) === top) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return { cwd: pkg, cmd: "npm install" };
}

/**
 * @param {{ cwd: string, cmd: string }} info
 * @param {string} shellCwd directory the user ran the CLI from
 * @returns {string}
 */
function formatPackageInstallLine(info, shellCwd) {
  const resolved = path.resolve(info.cwd);
  const shellResolved = path.resolve(shellCwd);
  if (resolved === shellResolved) {
    return `Next: run \`${info.cmd}\` to install dependencies.`;
  }
  let rel = path.relative(shellResolved, resolved);
  if (!rel || rel === ".") {
    return `Next: run \`${info.cmd}\` to install dependencies.`;
  }
  rel = rel.split(path.sep).join("/");
  return `Next: run \`cd ${rel} && ${info.cmd}\` to install dependencies.`;
}

/**
 * @param {string} packageRoot Absolute package directory (where lockfile / ai-commit dep live)
 * @param {string} gitRoot Absolute git repository root
 * @param {string} execPrefix from detectPackageExec
 * @param {"prepare-commit-msg" | "commit-msg"} hook
 */
function hookScript(packageRoot, gitRoot, execPrefix, hook) {
  const cmd =
    hook === "prepare-commit-msg"
      ? `${execPrefix} ai-commit prepare-commit-msg "$1" "$2"`
      : `${execPrefix} ai-commit lint --edit "$1"`;
  const pkgNorm = path.resolve(packageRoot);
  const gitNorm = path.resolve(gitRoot);
  let cdBlock = "";
  if (pkgNorm !== gitNorm) {
    const rel = path.relative(gitNorm, pkgNorm).split(path.sep).join("/");
    cdBlock = `root="$(git rev-parse --show-toplevel)"\ncd "$root/${rel}"\n`;
  }
  return `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

${cdBlock}${cmd}
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
 * Husky `init` writes `.husky/pre-commit` with only `(npm|pnpm|yarn) test` (see husky bin.js).
 * That often breaks commits when tests fail or are slow. Match that template and optional
 * minimal shebang + husky.sh wrapper so we do not delete custom hooks.
 * @param {string} raw
 * @returns {boolean}
 */
function isHuskyDefaultPreCommitContent(raw) {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const nonEmpty = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (l.length === 0) {
        return false;
      }
      if (/^#!\//.test(l)) {
        return true;
      }
      return !/^\s*#/.test(l);
    });
  if (nonEmpty.length === 0) {
    return false;
  }
  if (nonEmpty.length === 1) {
    return /^(npm|pnpm|yarn)\s+test$/i.test(nonEmpty[0]);
  }
  const last = nonEmpty[nonEmpty.length - 1];
  if (!/^(npm|pnpm|yarn)\s+test$/i.test(last)) {
    return false;
  }
  const head = nonEmpty.slice(0, -1);
  const shebang = /^#!\/usr\/bin\/env\s+sh$/.test(head[0]);
  const huskySource = head.some((l) => {
    if (/\bhusky\.sh\b/.test(l)) {
      return true;
    }
    if (l.includes("$(dirname") && (l.includes("_/husky.sh") || l.includes('_/h"'))) {
      return true;
    }
    return false;
  });
  return shebang && huskySource && head.length <= 3;
}

/**
 * Remove Husky’s stock `pre-commit` (e.g. `pnpm test`) from common paths. Custom hooks are kept.
 * @param {string} gitRoot
 * @param {string} huskyDir Resolved hooks directory (from `core.hooksPath` or `.husky`)
 * @returns {string[]} Absolute paths of removed files
 */
function removeHuskyDefaultPreCommitIfPresent(gitRoot, huskyDir) {
  const candidates = [
    path.join(huskyDir, "pre-commit"),
    path.join(gitRoot, ".husky", "pre-commit"),
  ];
  const seen = new Set();
  const removed = [];
  for (const filePath of candidates) {
    const abs = path.resolve(filePath);
    if (seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    if (!fs.existsSync(abs)) {
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!isHuskyDefaultPreCommitContent(raw)) {
      continue;
    }
    try {
      fs.unlinkSync(abs);
      removed.push(abs);
    } catch {
      // ignore
    }
  }
  return removed;
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
  detectPackageInstallInfo,
  formatPackageInstallLine,
  hookScript,
  runHuskyInit,
  removeHuskyDefaultPreCommitIfPresent,
  mergePackageJsonForAiCommit,
  warnIfPrepareMissingHusky,
};
