"use strict";

/**
 * Display order for "Changes by type" / release sections (aligned with lib/rules.js types).
 * Unknown types sort after known ones.
 */
const TYPE_TO_SECTION = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  style: "Style",
  docs: "Docs",
  refactor: "Refactor",
  test: "Test",
  ci: "CI",
  build: "Build",
  chore: "Chore",
  revert: "Reverts",
};

const SECTION_ORDER = [
  "Features",
  "Fixes",
  "Performance",
  "Style",
  "Docs",
  "Refactor",
  "Test",
  "CI",
  "Build",
  "Chore",
  "Reverts",
];

function shortHash(h) {
  return (h || "").slice(0, 7);
}

function parseHeader(message) {
  const firstLine = (message || "").split("\n")[0].trim();
  const m = firstLine.match(/^(\w+)(\(([^)]+)\))?:\s(.+)$/);
  if (!m) return { type: null, scope: null, subject: firstLine || "" };
  return { type: m[1], scope: m[3] || null, subject: m[4] || "" };
}

function titleCaseType(type) {
  if (type && TYPE_TO_SECTION[type]) return TYPE_TO_SECTION[type];
  return `Other (${type || "unknown"})`;
}

function extractBreakingNotes(message) {
  const lines = (message || "").split("\n");
  const breaking = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^BREAKING CHANGE(S)?:/i.test(line)) {
      breaking.push(line.replace(/^BREAKING CHANGE(S)?:\s*/i, "").trim());
    }
  }
  return breaking;
}

/**
 * @param {Array<{ hash: string, message: string }>} commits
 * @returns {{ keys: string[], groups: Map<string, Array<{ hash: string, type: string|null, scope: string|null, subject: string }>> }}
 */
function groupCommits(commits) {
  const groups = new Map();
  for (const c of commits) {
    const header = parseHeader(c.message);
    const typeTitle = titleCaseType(header.type);
    if (!groups.has(typeTitle)) groups.set(typeTitle, []);
    groups.get(typeTitle).push({
      hash: shortHash(c.hash),
      type: header.type,
      scope: header.scope,
      subject: header.subject,
    });
  }

  const keys = [...groups.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  for (const k of keys) {
    groups.get(k).sort((a, b) => {
      const as = `${a.scope || ""} ${a.subject}`.trim();
      const bs = `${b.scope || ""} ${b.subject}`.trim();
      return as.localeCompare(bs);
    });
  }

  return { keys, groups };
}

function formatCommitLine(item) {
  const header = `${item.type || "commit"}${item.scope ? `(${item.scope})` : ""}: ${item.subject}`;
  return `- ${header} (\`${item.hash}\`)`;
}

/**
 * Markdown list grouped by conventional type (for PR bodies).
 * @param {Array<{ hash: string, message: string }>} commits
 */
function buildChangesByTypeMarkdown(commits) {
  if (!commits.length) return "_No commits in range._";
  const { keys, groups } = groupCommits(commits);
  const out = [];
  for (const k of keys) {
    out.push(`### ${k}`);
    for (const item of groups.get(k)) {
      out.push(formatCommitLine(item));
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/**
 * Full deterministic release notes (semantic-release generateNotes).
 * @param {{ version: string, dateISO: string, commits: Array<{ hash: string, message: string }> }} opts
 */
function buildDeterministicReleaseNotes({ version, dateISO, commits }) {
  const breaking = [];
  for (const c of commits) breaking.push(...extractBreakingNotes(c.message));

  const { keys, groups } = groupCommits(commits);

  const lines = [];
  lines.push(`# v${version} — ${dateISO}`);
  lines.push("");
  lines.push("## Highlights");
  lines.push(
    ...commits.slice(0, 8).map(c => {
      const h = parseHeader(c.message);
      const header = `${h.type || "commit"}${h.scope ? `(${h.scope})` : ""}: ${h.subject}`;
      return `- ${header} (${shortHash(c.hash)})`;
    }),
  );
  lines.push("");

  lines.push("## Breaking changes");
  if (breaking.length === 0) {
    lines.push("- None");
  } else {
    for (const b of breaking) lines.push(`- ${b}`);
  }
  lines.push("");

  lines.push("## Changes by type");
  for (const k of keys) {
    lines.push(`### ${k}`);
    for (const item of groups.get(k)) {
      const header = `${item.type || "commit"}${item.scope ? `(${item.scope})` : ""}: ${item.subject}`;
      lines.push(`- ${header} (${item.hash})`);
    }
    lines.push("");
  }

  lines.push("## Full commit list");
  for (const c of commits) {
    const h = parseHeader(c.message);
    const header = `${h.type || "commit"}${h.scope ? `(${h.scope})` : ""}: ${h.subject}`;
    lines.push(`- ${shortHash(c.hash)} ${header}`);
  }

  lines.push("");
  const commitRefs = commits.map(c => shortHash(c.hash));
  return { notes: lines.join("\n"), commitRefs };
}

module.exports = {
  SECTION_ORDER,
  TYPE_TO_SECTION,
  shortHash,
  parseHeader,
  titleCaseType,
  extractBreakingNotes,
  groupCommits,
  buildChangesByTypeMarkdown,
  buildDeterministicReleaseNotes,
};
