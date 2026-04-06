"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Pick the consumer example env file for merging ai-commit keys.
 * Prefers `.env.local.example` when it exists, then `.env.example`, then `.env-example`, else default `.env.example`.
 * Emits one-line stderr warnings when multiple candidate files exist.
 * @param {string} dir Absolute or resolved directory (e.g. package root)
 * @returns {string} Destination path for the example/template merge
 */
function resolveEnvExamplePath(dir) {
  const dotLocalExample = path.join(dir, ".env.local.example");
  const dotExample = path.join(dir, ".env.example");
  const dotHyphen = path.join(dir, ".env-example");
  const hasLocalExample = fs.existsSync(dotLocalExample);
  const hasExample = fs.existsSync(dotExample);
  const hasHyphen = fs.existsSync(dotHyphen);

  if (hasLocalExample) {
    if (hasExample || hasHyphen) {
      process.stderr.write(
        "warning: .env.local.example exists alongside .env.example and/or .env-example; using .env.local.example. Remove or consolidate the other file(s) if redundant.\n",
      );
    }
    return dotLocalExample;
  }

  if (hasExample && hasHyphen) {
    process.stderr.write(
      "warning: both .env.example and .env-example exist; using .env.example. Remove or consolidate the other file if redundant.\n",
    );
  }
  if (hasExample) {
    return dotExample;
  }
  if (hasHyphen) {
    return dotHyphen;
  }
  return dotExample;
}

/**
 * Walk from `cwd` up toward `gitRoot` (inclusive); first directory with `package.json` wins.
 * If `gitRoot` is null, returns `cwd` (no upward walk).
 * If none found before/at git root, returns `cwd`.
 * @param {string} cwd
 * @param {string | null} gitRoot
 * @returns {string}
 */
function findPackageRoot(cwd, gitRoot) {
  const cwdResolved = path.resolve(cwd);
  if (!gitRoot) {
    return cwdResolved;
  }
  const rootResolved = path.resolve(gitRoot);
  let dir = cwdResolved;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    if (dir === rootResolved) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return cwdResolved;
}

module.exports = {
  resolveEnvExamplePath,
  findPackageRoot,
};
