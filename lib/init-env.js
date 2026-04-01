"use strict";

const fs = require("fs");

/** Detect our doc line so we do not duplicate or replace other packages’ comments. */
const MARKER_PREFIX = "# @verndale/ai-commit — ";

const DOC_OPENAI = [
  `${MARKER_PREFIX}OPENAI_API_KEY: OpenAI API key for conventional commit messages (ai-commit run; optional for prepare-commit-msg with AI).`,
];

const DOC_COMMIT_MODEL = [
  `${MARKER_PREFIX}COMMIT_AI_MODEL: OpenAI model for commit messages (optional; default gpt-4o-mini).`,
];

/**
 * Keys assigned on non-comment lines (`KEY=value` or `export KEY=value`).
 * @param {string} text
 * @returns {Set<string>}
 */
function parseDotenvAssignedKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(t);
    if (m) {
      keys.add(m[1]);
    }
  }
  return keys;
}

function hasOurDocForKey(lines, key) {
  const needle = `${MARKER_PREFIX}${key}:`;
  return lines.some((line) => line.includes(needle));
}

/**
 * Insert ai-commit doc lines immediately before an assignment line, without changing
 * existing comments above that line (we insert after those lines, before the key line).
 * @param {string[]} lines mutable
 * @param {RegExp} assignmentRegex
 * @param {string[]} docLines
 * @param {string} key for marker check
 * @returns {boolean} whether lines were mutated
 */
function injectDocBeforeAssignment(lines, assignmentRegex, docLines, key) {
  if (hasOurDocForKey(lines, key)) {
    return false;
  }
  const idx = lines.findIndex((line) => assignmentRegex.test(line));
  if (idx === -1) {
    return false;
  }
  lines.splice(idx, 0, ...docLines);
  return true;
}

/**
 * For keys already present (possibly with another package’s comments), add our doc line(s)
 * above the assignment if missing. Does not remove or edit existing comment lines.
 * @param {string} content
 * @returns {string}
 */
function injectAiCommitDocsForExistingKeys(content) {
  const lines = content.split(/\r?\n/);
  let changed = false;

  if (
    injectDocBeforeAssignment(
      lines,
      /^\s*OPENAI_API_KEY\s*=/,
      DOC_OPENAI,
      "OPENAI_API_KEY",
    )
  ) {
    changed = true;
  }

  if (!hasOurDocForKey(lines, "COMMIT_AI_MODEL")) {
    let idx = lines.findIndex((line) => /^\s*COMMIT_AI_MODEL\s*=/.test(line));
    if (idx === -1) {
      idx = lines.findIndex((line) => /^\s*#\s*COMMIT_AI_MODEL\s*=/.test(line));
    }
    if (idx !== -1) {
      lines.splice(idx, 0, ...DOC_COMMIT_MODEL);
      changed = true;
    }
  }

  return changed ? lines.join("\n") : content;
}

/**
 * Build text to append so OPENAI_API_KEY / COMMIT_AI_MODEL placeholders exist.
 * Returns null if nothing to add.
 * @param {string} existing
 * @returns {string | null}
 */
function buildAiCommitEnvAppend(existing) {
  const keys = parseDotenvAssignedKeys(existing);
  const hasCommitPlaceholder =
    keys.has("COMMIT_AI_MODEL") ||
    /^\s*#\s*COMMIT_AI_MODEL\s*=/m.test(existing) ||
    /^\s*COMMIT_AI_MODEL\s*=/m.test(existing);
  const parts = [];
  if (!keys.has("OPENAI_API_KEY")) {
    parts.push(`${DOC_OPENAI[0]}\nOPENAI_API_KEY=\n`);
  }
  if (!keys.has("COMMIT_AI_MODEL") && !hasCommitPlaceholder) {
    parts.push(`${DOC_COMMIT_MODEL[0]}\n# COMMIT_AI_MODEL=\n`);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

/**
 * Merge bundled ai-commit env keys into a file. Never removes existing lines.
 * @param {string} destPath
 * @param {string} bundledPath
 * @param {{ force?: boolean }} [options]
 * @returns {{ kind: 'replaced' | 'wrote' | 'merged' | 'unchanged' }}
 */
function mergeAiCommitEnvFile(destPath, bundledPath, options = {}) {
  const { force = false } = options;
  const bundled = fs.readFileSync(bundledPath, "utf8");

  if (force) {
    fs.writeFileSync(destPath, bundled, "utf8");
    return { kind: "replaced" };
  }

  let existing = "";
  if (fs.existsSync(destPath)) {
    existing = fs.readFileSync(destPath, "utf8");
  }

  if (!existing.trim()) {
    fs.writeFileSync(destPath, bundled, "utf8");
    return { kind: "wrote" };
  }

  let text = injectAiCommitDocsForExistingKeys(existing);
  const append = buildAiCommitEnvAppend(text);
  if (append !== null) {
    const sep = text.endsWith("\n") ? "" : "\n";
    text = `${text}${sep}${append}`;
  }

  if (text === existing) {
    return { kind: "unchanged" };
  }

  fs.writeFileSync(destPath, text, "utf8");
  return { kind: "merged" };
}

module.exports = {
  parseDotenvAssignedKeys,
  buildAiCommitEnvAppend,
  injectAiCommitDocsForExistingKeys,
  mergeAiCommitEnvFile,
};
