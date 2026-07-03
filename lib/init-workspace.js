"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HUSKY_RANGE = "^9.1.7";
/** Same major range as `@verndale/ai-commit` so consumers can load `.env` in their own tooling if needed. */
const DOTENV_RANGE = "^16.4.7";

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
 * Directory for hook scripts Husky’s `h` executes. With `core.hooksPath=.husky/_`, Git runs
 * `.husky/_/prepare-commit-msg` (stub); `h` then runs `.husky/prepare-commit-msg` (real script).
 * @param {string} hooksDirAbs from `resolveGitHooksDir`
 * @returns {string}
 */
function userHooksParentDir(hooksDirAbs) {
  const resolved = path.resolve(hooksDirAbs);
  return path.basename(resolved) === "_" ? path.dirname(resolved) : resolved;
}

/**
 * Git entry stub under `core.hooksPath` (e.g. `.husky/_/prepare-commit-msg`).
 * @returns {string}
 */
function huskyGitEntryStub() {
  return `#!/usr/bin/env sh
. "$(dirname -- "$0")/h"
`;
}

/**
 * True when Husky has installed its `h` runner for this hooks layout.
 * @param {string} hooksDirAbs
 */
function isHuskyShimPresent(hooksDirAbs) {
  const resolved = path.resolve(hooksDirAbs);
  const base = path.basename(resolved);
  const hPath = base === "_" ? path.join(resolved, "h") : path.join(resolved, "_", "h");
  return fs.existsSync(hPath);
}

/**
 * User commands were written under `_/`; that layer must stay a short stub only.
 * @param {string} filePath
 * @returns {boolean}
 */
function isMisplacedUserHookInUnderscoreDir(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    return /\bai-commit\b/.test(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Shell line sourcing Husky when Git runs hooks directly from `.husky/` (`core.hooksPath=.husky`).
 * @param {string} hooksDirAbs
 * @returns {string}
 */
function huskyRunnerSourceLine(hooksDirAbs) {
  const resolved = path.resolve(hooksDirAbs);
  const base = path.basename(resolved);
  if (base === "_") {
    return '. "$(dirname -- "$0")/h"';
  }
  return '. "$(dirname -- "$0")/_/h"';
}

/**
 * @returns {{ cdBlock: string, cmd: string }}
 */
function userHookCommands(packageRoot, gitRoot, execPrefix, hook) {
  const pkgNorm = path.resolve(packageRoot);
  const gitNorm = path.resolve(gitRoot);
  const nested = pkgNorm !== gitNorm;
  // Git passes the message-file path relative to the worktree root. When the hook cd's
  // into a subdir (workspace layout) that relative path no longer resolves, so absolutize
  // it first ($msg); at the git root the raw "$1" is already correct.
  const msgArg = nested ? '"$msg"' : '"$1"';
  const cmd =
    hook === "prepare-commit-msg"
      ? `${execPrefix} ai-commit prepare-commit-msg ${msgArg} "$2"`
      : `${execPrefix} ai-commit lint --edit ${msgArg}`;
  let cdBlock = "";
  if (nested) {
    const rel = path.relative(gitNorm, pkgNorm).split(path.sep).join("/");
    cdBlock =
      `root="$(git rev-parse --show-toplevel)"\n` +
      `msg="$1"\n` +
      `case "$msg" in\n  /*) ;;\n  *) msg="$root/$msg" ;;\nesac\n` +
      `cd "$root/${rel}"\n`;
  }
  return { cdBlock, cmd };
}

/**
 * Real hook executed by Husky `h` from `.husky/prepare-commit-msg` (no `. h` line).
 * @param {string} packageRoot
 * @param {string} gitRoot
 * @param {string} execPrefix
 * @param {"prepare-commit-msg" | "commit-msg"} hook
 */
function userHookScript(packageRoot, gitRoot, execPrefix, hook) {
  const { cdBlock, cmd } = userHookCommands(packageRoot, gitRoot, execPrefix, hook);
  return `#!/usr/bin/env sh
${cdBlock}${cmd}
`;
}

/**
 * Single hook file when `core.hooksPath` is `.husky` (not `.husky/_`).
 * @param {string} hooksDirAbs
 * @param {"prepare-commit-msg" | "commit-msg"} hook
 */
function hookScriptFlatLayout(packageRoot, gitRoot, hooksDirAbs, execPrefix, hook) {
  const { cdBlock, cmd } = userHookCommands(packageRoot, gitRoot, execPrefix, hook);
  const huskyLine = huskyRunnerSourceLine(hooksDirAbs);
  return `#!/usr/bin/env sh
${huskyLine}

${cdBlock}${cmd}
`;
}

/**
 * Run Husky’s initializer when the Husky `h` shim is missing (installs husky, `.husky/_/`, `core.hooksPath`, prepare).
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
    if (
      l.includes("$(dirname") &&
      (l.includes("_/husky.sh") || l.includes('_/h"') || l.includes('/h"'))
    ) {
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
 * @param {Record<string, unknown>} pkg
 * @returns {boolean}
 */
function packageJsonHasDotenv(pkg) {
  const dep = (name) =>
    pkg[name] && typeof pkg[name] === "object" && pkg[name] !== null && "dotenv" in pkg[name];
  return dep("dependencies") || dep("devDependencies") || dep("optionalDependencies");
}

/**
 * Ensure `commit` script, `prepare` for husky, `devDependencies.husky`, and `devDependencies.dotenv` when missing.
 * Does not remove existing scripts.
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
  if (!packageJsonHasDotenv(pkg)) {
    pkg.devDependencies.dotenv = DOTENV_RANGE;
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

/**
 * Root `prepare` for the flat (`core.hooksPath=.husky`) workspace layout: point Git at the
 * committed hooks with plain git config — no husky is needed at the repo root, and a fresh
 * clone re-activates hooks on install. The `git rev-parse` guard makes it a no-op outside a
 * work tree (e.g. when installed as a dependency / in a tarball).
 * @returns {string}
 */
function workspaceRootPrepareScript() {
  return "git rev-parse --git-dir > /dev/null 2>&1 && git config core.hooksPath .husky || true";
}

/**
 * `<pm> commit` delegator that runs the subdir's `commit` script from the repo root.
 * @param {string} pm  pnpm | npm | yarn | bun
 * @param {string} subdirRel  POSIX-relative subdir path
 * @returns {string}
 */
function commitDelegator(pm, subdirRel) {
  switch (pm) {
    case "yarn":
      return `yarn --cwd ${subdirRel} commit`;
    case "npm":
      return `npm --prefix ${subdirRel} run commit`;
    case "bun":
      return `bun --cwd ${subdirRel} run commit`;
    default:
      return `pnpm --dir ${subdirRel} commit`;
  }
}

/**
 * Add (missing-only) the flat-workspace root scripts — a `commit` delegator into the subdir and
 * a git-config `prepare` — to the repo-root package.json, creating a minimal `{ private: true }`
 * one if absent. Never clobbers an existing `commit`/`prepare`. @returns {{ changed: boolean }}
 */
function mergeWorkspaceRootPackageJson(rootPkgPath, subdirRel, pm) {
  let pkg = {};
  let existed = false;
  try {
    if (fs.statSync(rootPkgPath).isFile()) {
      pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      existed = true;
    }
  } catch (_) {
    /* absent — create a minimal private root */
  }
  if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new Error(`${rootPkgPath} is not a JSON object`);
  }
  let changed = !existed;
  if (!existed && pkg.private === undefined) pkg.private = true;
  pkg.scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  if (!pkg.scripts.commit) {
    pkg.scripts.commit = commitDelegator(pm, subdirRel);
    changed = true;
  }
  if (!pkg.scripts.prepare) {
    pkg.scripts.prepare = workspaceRootPrepareScript();
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(rootPkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  return { changed };
}

/**
 * Install the flat, husky-free workspace hook layout (the "CN" pattern) at the git root:
 *   - `core.hooksPath=.husky` via plain git config (no husky at the root; fresh clones
 *     re-activate hooks from `prepare` alone);
 *   - committed standalone hooks under `.husky/` that normalize the message path, cd into the
 *     subdir, and run ai-commit;
 *   - a root package.json (created `{ private: true }` if absent) with a `commit` delegator + a
 *     git-config `prepare`;
 *   - the subdir package.json wired for ai-commit (commit script + husky/dotenv devDeps).
 * @param {{ cwd: string, gitRoot: string, packageRoot: string, force: boolean }} opts
 */
function initWorkspaceFlat({ cwd, gitRoot, packageRoot, force }) {
  const huskyDir = path.join(gitRoot, ".husky");
  const subdirRel = path
    .relative(path.resolve(gitRoot), path.resolve(packageRoot))
    .split(path.sep)
    .join("/");
  const execPrefix = detectPackageExec(packageRoot);
  const pm = detectPackageInstallInfo(packageRoot, gitRoot).cmd.split(" ")[0];

  const cfg = spawnSync("git", ["config", "core.hooksPath", ".husky"], { cwd: gitRoot });
  if (cfg.status !== 0) {
    process.stderr.write(
      "warning: could not set core.hooksPath=.husky; run `git config core.hooksPath .husky` at the repo root.\n",
    );
  } else {
    process.stdout.write("Set core.hooksPath=.husky (flat, husky-free layout).\n");
  }

  if (!fs.existsSync(huskyDir)) fs.mkdirSync(huskyDir, { recursive: true });
  for (const abs of removeHuskyDefaultPreCommitIfPresent(gitRoot, huskyDir)) {
    const rel = path.relative(cwd, abs) || path.basename(abs);
    process.stdout.write(`Removed Husky default pre-commit (${rel}).\n`);
  }

  for (const hookKind of ["prepare-commit-msg", "commit-msg"]) {
    const hookPath = path.join(huskyDir, hookKind);
    if (fs.existsSync(hookPath) && !force) {
      process.stderr.write(
        `Skipped ${path.relative(cwd, hookPath)} (already exists). Use --force to overwrite.\n`,
      );
      continue;
    }
    fs.writeFileSync(hookPath, userHookScript(packageRoot, gitRoot, execPrefix, hookKind), {
      encoding: "utf8",
    });
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {
      /* ignore on platforms without chmod */
    }
    process.stdout.write(`Wrote ${path.relative(cwd, hookPath)}.\n`);
  }

  const subdirPkg = path.join(packageRoot, "package.json");
  if (fs.existsSync(subdirPkg)) {
    const { changed } = mergePackageJsonForAiCommit(subdirPkg);
    if (changed) {
      process.stdout.write(
        "Updated subdir package.json (commit script + husky/dotenv devDependencies).\n",
      );
    }
  } else {
    process.stdout.write("No package.json in the subdir; skipped its merge (hooks still written).\n");
  }

  const rootPkg = path.join(gitRoot, "package.json");
  const { changed: rootChanged } = mergeWorkspaceRootPackageJson(rootPkg, subdirRel, pm);
  if (rootChanged) {
    process.stdout.write(
      `Wrote root package.json (commit delegator + git-config prepare) at ${path.relative(cwd, rootPkg) || "package.json"}.\n`,
    );
  }

  process.stdout.write(`${formatPackageInstallLine(detectPackageInstallInfo(packageRoot, gitRoot), cwd)}\n`);
}

module.exports = {
  HUSKY_RANGE,
  DOTENV_RANGE,
  initWorkspaceFlat,
  mergeWorkspaceRootPackageJson,
  workspaceRootPrepareScript,
  commitDelegator,
  detectPackageExec,
  detectPackageInstallInfo,
  formatPackageInstallLine,
  userHooksParentDir,
  huskyGitEntryStub,
  userHookScript,
  hookScriptFlatLayout,
  huskyRunnerSourceLine,
  isHuskyShimPresent,
  isMisplacedUserHookInUnderscoreDir,
  runHuskyInit,
  removeHuskyDefaultPreCommitIfPresent,
  mergePackageJsonForAiCommit,
  warnIfPrepareMissingHusky,
};
