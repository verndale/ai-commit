"use strict";

/** @see @commitlint/types RuleConfigSeverity — avoid require() (package is ESM-only). */
const ERROR = 2;
const OFF = 0;

/**
 * Single source of truth for commit types, lengths, and commitlint rules.
 * Scope is mandatory (injected deterministically by the generator); Beams-style subjects
 * start with a capital letter, so subject-case from conventional config is disabled.
 */

const COMMIT_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];

/** Subject line only (after `type(scope):`). */
const SUBJECT_MAX_LENGTH = 50;

/** Full first line: type(scope)!: subject */
const HEADER_MAX_LENGTH = 120;

const BODY_MAX_LINE_LENGTH = 72;
const FOOTER_MAX_LINE_LENGTH = 72;

/** Scopes produced by detectScopeFromFiles in this package (lowercase, hyphens). */
const SCOPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function getCommitlintRuleOverrides() {
  return {
    "type-enum": [ERROR, "always", COMMIT_TYPES],
    "scope-empty": [ERROR, "never"],
    "scope-case": [ERROR, "always", "lower-case"],
    "subject-max-length": [ERROR, "always", SUBJECT_MAX_LENGTH],
    "subject-case": [OFF],
    "header-max-length": [ERROR, "always", HEADER_MAX_LENGTH],
    "body-max-line-length": [ERROR, "always", BODY_MAX_LINE_LENGTH],
    "footer-max-line-length": [ERROR, "always", FOOTER_MAX_LINE_LENGTH],
  };
}

/**
 * Short policy text for docs / external tooling (generator uses richer prompts in openai.js).
 */
function getPromptInstructions() {
  return [
    "Conventional Commits with mandatory scope: type(scope): Subject (or type(scope)!: when breaking).",
    "",
    `Types: ${COMMIT_TYPES.join(", ")}.`,
    "Scope is chosen deterministically from changed paths (not by the model).",
    `Subject: imperative, first word capitalized (Beams-style), max ${SUBJECT_MAX_LENGTH} characters, no trailing period.`,
    `Body: optional; if present, blank line after header; wrap at ${BODY_MAX_LINE_LENGTH} characters.`,
    `Footer: issues (Refs #n / Closes #n), BREAKING CHANGE: when applicable; wrap at ${FOOTER_MAX_LINE_LENGTH} characters.`,
  ].join("\n");
}

module.exports = {
  COMMIT_TYPES,
  SUBJECT_MAX_LENGTH,
  HEADER_MAX_LENGTH,
  BODY_MAX_LINE_LENGTH,
  FOOTER_MAX_LINE_LENGTH,
  SCOPE_PATTERN,
  getCommitlintRuleOverrides,
  getPromptInstructions,
};
