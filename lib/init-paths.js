"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Pick the consumer example env file: prefer `.env.example`, else `.env-example`, else default `.env.example`.
 * If both dot forms exist, merges target `.env.example` and emits a one-line stderr warning.
 * @param {string} dir Absolute or resolved directory (e.g. package root)
 * @returns {string} Destination path for the example/template merge
 */
function resolveEnvExamplePath(dir) {
  const dotExample = path.join(dir, ".env.example");
  const dotHyphen = path.join(dir, ".env-example");
  const hasExample = fs.existsSync(dotExample);
  const hasHyphen = fs.existsSync(dotHyphen);
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
