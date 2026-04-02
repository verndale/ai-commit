"use strict";

const fs = require("fs");

/** Detect our doc line so we do not duplicate or replace other packages’ comments. */
const MARKER_PREFIX = "# @verndale/ai-pr — ";

const HEADER_LINES = [
  "# ------------------------------------------------------------",
  "# @verndale/ai-pr (pnpm open-pr) — GitHub PR create/update",
  "# ------------------------------------------------------------",
];

const DOC_GH_TOKEN = [
  `${MARKER_PREFIX}GH_TOKEN: Set for local CLI runs; CI uses workflow env / secrets. Also reads GITHUB_TOKEN.`,
];

const DOC_PR_BASE = [
  `${MARKER_PREFIX}PR_BASE_BRANCH: Base branch to merge into (default main).`,
];

const DOC_PR_DRAFT = [
  `${MARKER_PREFIX}PR_DRAFT: If true (default), new PRs are drafts.`,
];

const DOC_PR_AI = [
  `${MARKER_PREFIX}PR_AI: Set true to enable AI summary and optional labels/checklist.`,
];

const DOC_PR_AI_ENDPOINT = [
  `${MARKER_PREFIX}PR_AI_ENDPOINT: AI API URL when PR_AI is true (e.g. OpenAI Responses endpoint).`,
];

const DOC_PR_AI_API_KEY = [
  `${MARKER_PREFIX}PR_AI_API_KEY: Bearer token for the AI API when PR_AI is true.`,
];

const DOC_PR_AI_MODEL = [
  `${MARKER_PREFIX}PR_AI_MODEL: Model id (default string default).`,
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

/**
 * @param {string} text
 * @param {string} key
 * @returns {boolean}
 */
function hasKeyAssignmentOrCommented(text, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`^\\s*${esc}\\s*=`, "m").test(text) ||
    new RegExp(`^\\s*#\\s*${esc}\\s*=`, "m").test(text)
  );
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasGhTokenLine(text) {
  return (
    /^\s*#GH_TOKEN\s*=/m.test(text) ||
    hasKeyAssignmentOrCommented(text, "GH_TOKEN") ||
    /^\s*#GITHUB_TOKEN\s*=/m.test(text) ||
    hasKeyAssignmentOrCommented(text, "GITHUB_TOKEN")
  );
}

function hasOurDocForKey(lines, key) {
  const needle = `${MARKER_PREFIX}${key}:`;
  return lines.some((line) => line.includes(needle));
}

/**
 * @param {string[]} lines mutable
 * @param {RegExp} assignmentRegex
 * @param {string[]} docLines
 * @param {string} key
 * @returns {boolean}
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
 * @param {string} content
 * @returns {string}
 */
function injectAiPrDocsForExistingKeys(content) {
  const lines = content.split(/\r?\n/);
  let changed = false;

  const tryInject = (regex, doc, key) => {
    if (injectDocBeforeAssignment(lines, regex, doc, key)) {
      changed = true;
    }
  };

  if (!hasOurDocForKey(lines, "GH_TOKEN")) {
    const idx = lines.findIndex(
      (line) =>
        /^\s*#GH_TOKEN\s*=/.test(line) ||
        /^\s*#\s*GH_TOKEN\s*=/.test(line) ||
        /^\s*GH_TOKEN\s*=/.test(line) ||
        /^\s*#GITHUB_TOKEN\s*=/.test(line) ||
        /^\s*#\s*GITHUB_TOKEN\s*=/.test(line) ||
        /^\s*GITHUB_TOKEN\s*=/.test(line),
    );
    if (idx !== -1) {
      lines.splice(idx, 0, ...DOC_GH_TOKEN);
      changed = true;
    }
  }
  tryInject(/^\s*(?:#\s*)?PR_BASE_BRANCH\s*=/, DOC_PR_BASE, "PR_BASE_BRANCH");
  tryInject(/^\s*(?:#\s*)?PR_DRAFT\s*=/, DOC_PR_DRAFT, "PR_DRAFT");
  tryInject(/^\s*(?:#\s*)?PR_AI\s*=/, DOC_PR_AI, "PR_AI");
  tryInject(/^\s*(?:#\s*)?PR_AI_ENDPOINT\s*=/, DOC_PR_AI_ENDPOINT, "PR_AI_ENDPOINT");
  tryInject(/^\s*(?:#\s*)?PR_AI_API_KEY\s*=/, DOC_PR_AI_API_KEY, "PR_AI_API_KEY");
  tryInject(/^\s*(?:#\s*)?PR_AI_MODEL\s*=/, DOC_PR_AI_MODEL, "PR_AI_MODEL");

  return changed ? lines.join("\n") : content;
}

/**
 * @param {string} existing
 * @returns {string | null}
 */
function buildAiPrEnvAppend(existing) {
  const keys = parseDotenvAssignedKeys(existing);
  const parts = [];

  if (!hasGhTokenLine(existing)) {
    parts.push(
      `${HEADER_LINES.join("\n")}\n${DOC_GH_TOKEN[0]}\n# GH_TOKEN=\n`,
    );
  }

  const hasPrBase =
    keys.has("PR_BASE_BRANCH") || /^\s*#\s*PR_BASE_BRANCH\s*=/m.test(existing);
  if (!hasPrBase) {
    parts.push(
      `\n# Optional — PR behavior\n${DOC_PR_BASE[0]}\n# PR_BASE_BRANCH=main\n\n${DOC_PR_DRAFT[0]}\n# PR_DRAFT=true\n`,
    );
  }

  const hasPrAiBlock =
    keys.has("PR_AI") ||
    /^\s*#\s*PR_AI\s*=/m.test(existing) ||
    /^\s*PR_AI\s*=/m.test(existing);
  if (!hasPrAiBlock) {
    parts.push(
      `\n# Optional — AI summary + labels (when PR_AI=true)\n${DOC_PR_AI[0]}\n# PR_AI=true\n\n${DOC_PR_AI_ENDPOINT[0]}\n# PR_AI_ENDPOINT=https://api.openai.com/v1/responses\n\n${DOC_PR_AI_API_KEY[0]}\n# PR_AI_API_KEY=\n\n${DOC_PR_AI_MODEL[0]}\n# PR_AI_MODEL=default\n\n`,
    );
  }

  if (parts.length === 0) {
    return null;
  }
  return parts.join("");
}

/**
 * Merge bundled @verndale/ai-pr env keys into a file. Never removes existing lines.
 * @param {string} destPath
 * @param {string} bundledPath
 * @param {{ force?: boolean }} [options]
 * @returns {{ kind: 'replaced' | 'wrote' | 'merged' | 'unchanged' }}
 */
function mergeAiPrEnvFile(destPath, bundledPath, options = {}) {
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

  let text = injectAiPrDocsForExistingKeys(existing);
  const append = buildAiPrEnvAppend(text);
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
  buildAiPrEnvAppend,
  injectAiPrDocsForExistingKeys,
  mergeAiPrEnvFile,
};
