"use strict";

const { lintMessage } = require("./lint.js");
const { generateCommitMessageFull } = require("./openai.js");
const {
  detectIssueNumbers,
  detectScopeFromFiles,
  looksBreaking,
  buildFallbackSubject,
} = require("./message-policy.js");
const {
  getStagedDiff,
  getChangedFiles,
  getBranchName,
} = require("./git.js");

function buildChoreFallback({ files, scope, issueNumbers }) {
  const subject = buildFallbackSubject(files);
  let msg = `chore(${scope}): ${subject}\n\nSummarize staged changes and keep repository governance consistent.`;
  if (issueNumbers.length) msg += `\n\nRefs #${issueNumbers[0]}`;
  return msg;
}

async function generateAndValidate(
  cwd = process.cwd(),
  { requireOpenAI = false } = {},
) {
  const diff = getStagedDiff(cwd);
  const files = getChangedFiles(cwd);
  const branchName = getBranchName(cwd);
  const issueNumbers = detectIssueNumbers({ branchName, diffText: diff });
  const scope = detectScopeFromFiles(files, cwd);
  const breakingAllowed = looksBreaking({ files });

  if (requireOpenAI && !process.env.OPENAI_API_KEY) {
    const err = new Error(
      "OPENAI_API_KEY is not set. Add it to your environment or a .env file in the project root.",
    );
    err.code = "ENOKEY";
    throw err;
  }

  let msg = "";
  let usedAi = false;
  if (process.env.OPENAI_API_KEY) {
    try {
      msg = await generateCommitMessageFull(
        {
          diff,
          files,
          issueNumbers,
          scope,
          breakingAllowed,
        },
        { cwd },
      );
      if (msg) usedAi = true;
    } catch (e) {
      if (e.code === "ENOKEY") throw e;
      msg = "";
    }
  }

  if (!msg) {
    msg = buildChoreFallback({ files, scope, issueNumbers });
  }

  let result = await lintMessage(msg, cwd);
  if (result.valid) {
    const warnings = [];
    if (!usedAi) {
      if (!process.env.OPENAI_API_KEY) {
        warnings.push("OPENAI_API_KEY not set; used deterministic fallback message.");
      } else {
        warnings.push("Model output could not be used; used deterministic fallback message.");
      }
    }
    return { message: msg, warnings };
  }

  const fallback = buildChoreFallback({ files, scope, issueNumbers });
  result = await lintMessage(fallback, cwd);
  if (result.valid) {
    return {
      message: fallback,
      warnings: ["Used chore fallback after generated message failed commitlint."],
    };
  }

  const minimal = `chore(${scope}): Update staged changes`;
  result = await lintMessage(minimal, cwd);
  if (result.valid) {
    return {
      message: minimal,
      warnings: ["Used generic fallback after validation failed."],
    };
  }

  const errors = [...result.errors, ...result.warnings]
    .map((x) => x.message)
    .filter(Boolean);
  throw new Error(
    `Commit message failed validation:\n${errors.join("\n") || result.input}`,
  );
}

module.exports = { generateAndValidate, buildChoreFallback };
