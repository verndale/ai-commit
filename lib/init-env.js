"use strict";

const fs = require("fs");

/** Detect our doc line so we do not duplicate or replace other packages’ comments. */
const MARKER_PREFIX = "# @verndale/ai-commit — ";

const SECTION_DIVIDER = "# ------------------------------------------------------------";
const SECTION_TITLE = "# @verndale/ai-commit (pnpm commit / ai-commit run)";
const SECTION_HEADER = [SECTION_DIVIDER, SECTION_TITLE, SECTION_DIVIDER];

const SUBSECTION_OPTIONAL_MODEL = "# Optional — default is gpt-4o-mini";

const DOC_OPENAI = [
  `${MARKER_PREFIX}OPENAI_API_KEY: OpenAI API key for conventional commit messages (ai-commit run; optional for prepare-commit-msg with AI).`,
];

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasAiCommitSectionHeader(text) {
  return (
    text.includes(SECTION_DIVIDER) &&
    text.includes("@verndale/ai-commit (pnpm commit / ai-commit run)")
  );
}

/**
 * True when COMMIT_AI_MODEL is already documented (long marker, subsection, or legacy block).
 * @param {string[]} lines
 * @returns {boolean}
 */
function hasCommitModelNotes(lines) {
  if (hasOurDocForKey(lines, "COMMIT_AI_MODEL")) {
    return true;
  }
  const commitIdx = lines.findIndex(
    (line) =>
      /^\s*COMMIT_AI_MODEL\s*=/.test(line) || /^\s*#\s*COMMIT_AI_MODEL\s*=/.test(line),
  );
  if (commitIdx === -1) {
    return false;
  }
  for (let i = commitIdx - 1; i >= 0 && i >= commitIdx - 12; i--) {
    const t = lines[i].trim();
    if (t === "") {
      continue;
    }
    if (t === SUBSECTION_OPTIONAL_MODEL.trim()) {
      return true;
    }
    if (lines[i].includes(`${MARKER_PREFIX}COMMIT_AI_MODEL:`)) {
      return true;
    }
  }
  return false;
}

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
 * For keys already present (possibly with another package’s comments), add our doc line(s)
 * above the assignment if missing. Does not remove or edit existing comment lines.
 * @param {string} content
 * @returns {string}
 */
function injectAiCommitDocsForExistingKeys(content) {
  const lines = content.split(/\r?\n/);
  let changed = false;

  if (!hasOurDocForKey(lines, "OPENAI_API_KEY")) {
    const idx = lines.findIndex((line) => /^\s*OPENAI_API_KEY\s*=/.test(line));
    if (idx !== -1) {
      const insert = hasAiCommitSectionHeader(lines.join("\n"))
        ? [DOC_OPENAI[0]]
        : [...SECTION_HEADER, DOC_OPENAI[0]];
      lines.splice(idx, 0, ...insert);
      changed = true;
    }
  }

  if (!hasCommitModelNotes(lines)) {
    let idx = lines.findIndex((line) => /^\s*COMMIT_AI_MODEL\s*=/.test(line));
    if (idx === -1) {
      idx = lines.findIndex((line) => /^\s*#\s*COMMIT_AI_MODEL\s*=/.test(line));
    }
    if (idx !== -1) {
      const insert = hasAiCommitSectionHeader(lines.join("\n"))
        ? [SUBSECTION_OPTIONAL_MODEL]
        : [...SECTION_HEADER, "", SUBSECTION_OPTIONAL_MODEL];
      lines.splice(idx, 0, ...insert);
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
  const needOpenai = !keys.has("OPENAI_API_KEY");
  const needCommit = !keys.has("COMMIT_AI_MODEL") && !hasCommitPlaceholder;
  const hasSection = hasAiCommitSectionHeader(existing);

  if (!needOpenai && !needCommit) {
    return null;
  }

  if (needOpenai && needCommit) {
    return [
      ...SECTION_HEADER,
      DOC_OPENAI[0],
      "OPENAI_API_KEY=",
      "",
      SUBSECTION_OPTIONAL_MODEL,
      "# COMMIT_AI_MODEL=",
      "",
      "",
    ].join("\n");
  }

  if (needOpenai) {
    return [...SECTION_HEADER, DOC_OPENAI[0], "OPENAI_API_KEY=", ""].join("\n");
  }

  if (hasSection) {
    return [SUBSECTION_OPTIONAL_MODEL, "# COMMIT_AI_MODEL=", "", ""].join("\n");
  }

  return [
    ...SECTION_HEADER,
    "",
    SUBSECTION_OPTIONAL_MODEL,
    "# COMMIT_AI_MODEL=",
    "",
    "",
  ].join("\n");
}

/**
 * Merge bundled ai-commit env keys into a file. Never removes existing lines.
 * @param {string} destPath
 * @param {string} bundledPath
 * @param {{ force?: boolean }} [options]
 * @returns {{ kind: 'replaced' | 'wrote' | 'unchanged' }}
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
