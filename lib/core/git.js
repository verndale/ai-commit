"use strict";

const { execFileSync } = require("child_process");

/** Large staged diffs must not throw ENOBUFS (align with generous buffer in prior tooling). */
const GIT_DIFF_MAX_BUFFER = 50 * 1024 * 1024;

/** Pathspecs excluded from staged diff text (noise / binary). */
const DIFF_EXCLUDE_PATHSPECS = [
  ":!pnpm-lock.yaml",
  ":!*.png",
  ":!*.jpg",
  ":!*.jpeg",
  ":!*.pdf",
];

function execGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: GIT_DIFF_MAX_BUFFER,
    ...options,
  });
}

function isInGitRepo(cwd = process.cwd()) {
  try {
    execGit(["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

function assertInGitRepo(cwd = process.cwd()) {
  if (!isInGitRepo(cwd)) {
    const err = new Error("Not a git repository (or git not available).");
    err.code = "ENOTGIT";
    throw err;
  }
}

/**
 * Staged diff for AI prompts; excludes lockfile and common binary globs.
 */
function getStagedDiff(cwd = process.cwd()) {
  assertInGitRepo(cwd);
  return execGit(
    ["diff", "--cached", "--no-color", "--no-ext-diff", "--", ...DIFF_EXCLUDE_PATHSPECS],
    { cwd },
  );
}

function getChangedFiles(cwd = process.cwd()) {
  assertInGitRepo(cwd);
  return execGit(["diff", "--cached", "--name-only"], { cwd })
    .trim()
    .split("\n")
    .filter(Boolean);
}

function getBranchName(cwd = process.cwd()) {
  assertInGitRepo(cwd);
  try {
    return execGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).trim();
  } catch {
    return "";
  }
}

function getStagedStatSummary(cwd = process.cwd()) {
  assertInGitRepo(cwd);
  try {
    return execGit(["diff", "--cached", "--stat"], { cwd }).trim();
  } catch {
    return "";
  }
}

function hasStagedChanges(cwd = process.cwd()) {
  assertInGitRepo(cwd);
  const out = execGit(["diff", "--cached", "--name-only"], { cwd });
  return out.trim().length > 0;
}

function commitFromFile(message, cwd = process.cwd()) {
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    input: message,
    encoding: "utf8",
    maxBuffer: GIT_DIFF_MAX_BUFFER,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

module.exports = {
  GIT_DIFF_MAX_BUFFER,
  DIFF_EXCLUDE_PATHSPECS,
  execGit,
  isInGitRepo,
  assertInGitRepo,
  getStagedDiff,
  getChangedFiles,
  getBranchName,
  getStagedStatSummary,
  hasStagedChanges,
  commitFromFile,
};
