"use strict";

const fs = require("fs");
const path = require("path");
const {
  COMMIT_TYPES,
  SUBJECT_MAX_LENGTH,
} = require("../rules.js");

function unique(arr) {
  return Array.from(new Set(arr));
}

/**
 * Issue numbers from branch name and diff (#123).
 */
function detectIssueNumbers({ branchName, diffText }) {
  const nums = [];
  const branchMatches = branchName.match(/#\d+|\b\d{1,6}\b/g);
  if (branchMatches) {
    for (const m of branchMatches) {
      const n = String(m).replace("#", "");
      if (/^\d{1,6}$/.test(n)) nums.push(n);
    }
  }
  const diffMatches = diffText.match(/#(\d{1,6})/g);
  if (diffMatches) {
    for (const m of diffMatches) {
      const n = m.replace("#", "");
      if (/^\d{1,6}$/.test(n)) nums.push(n);
    }
  }
  return unique(nums);
}

/**
 * Deterministic scope for @verndale/ai-commit repository layout.
 */
function detectScopeFromFiles(files, cwd = process.cwd()) {
  const f = (p) => files.some((x) => x.startsWith(p));
  if (f("lib/")) return "lib";
  if (f("bin/")) return "cli";
  if (f(".github/")) return "ci";
  if (f("docs/")) return "docs";
  return getDefaultScopeFromPackage(cwd);
}

function getDefaultScopeFromPackage(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name && typeof pkg.name === "string") {
        const n = pkg.name;
        if (n.includes("/")) return n.split("/").pop().replace(/^@/, "") || "repo";
        return n.replace(/^@/, "") || "repo";
      }
    }
  } catch {
    /* ignore */
  }
  return "repo";
}

/**
 * Breaking allowed when governance / hook / preset files change.
 */
function looksBreaking({ files }) {
  return files.some(
    (file) =>
      file.includes("commitlint.config") ||
      file.endsWith("commitlint-preset.cjs") ||
      file.endsWith("lib/rules.js") ||
      file.startsWith(".husky/"),
  );
}

function wrap72(text) {
  const width = 72;
  const lines = [];
  for (const paragraph of text.split(/\n\n+/)) {
    const p = paragraph.trim();
    if (!p) {
      lines.push("");
      continue;
    }
    const words = p.split(/\s+/);
    let line = "";
    for (const w of words) {
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    lines.push("");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function stripGitComments(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}

function parseMessage(raw) {
  const cleaned = stripGitComments(raw || "");
  const parts = cleaned.split(/\n\n+/);
  const header = (parts[0] || "").trim();
  const rest = parts.slice(1).join("\n\n").trim();
  return { header, rest };
}

function stripBreakingFooterLines(text) {
  const lines = text.split("\n").filter((line) => !/^BREAKING CHANGE:/i.test(line.trim()));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n").trim();
}

function extractTypeAndSubject(header) {
  const types = COMMIT_TYPES.join("|");
  const re = new RegExp(
    `^(${types})(?:\\([^)]+\\))?(!)?:\\s(.+)$`,
  );
  const m = header.match(re);
  if (!m) {
    return {
      type: "chore",
      subject: header.replace(/^[^:]+:\s*/, "").trim(),
      aiBreaking: false,
    };
  }
  return { type: m[1], subject: (m[3] || "").trim(), aiBreaking: !!m[2] };
}

function normalizeSubject(subject) {
  let s = (subject || "").trim();
  while (s.endsWith(".")) s = s.slice(0, -1);
  if (s && !/^[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > SUBJECT_MAX_LENGTH) s = s.slice(0, SUBJECT_MAX_LENGTH).trimEnd();
  return s;
}

function buildFallbackSubject(files) {
  const buckets = [];
  if (files.some((f) => f.includes("release") || f.includes(".releaserc") || f.includes("CHANGELOG"))) {
    buckets.push("Release automation");
  }
  if (
    files.some(
      (f) =>
        f.includes("commitlint") ||
        f.includes(".husky") ||
        f.includes("CONTRIBUTING"),
    )
  ) {
    buckets.push("Commit governance");
  }
  if (files.some((f) => f.startsWith(".github/"))) buckets.push("CI workflow");
  if (files.some((f) => f.startsWith("lib/") || f.startsWith("bin/"))) {
    buckets.push("Package implementation");
  }
  if (files.some((f) => f.startsWith("docs/"))) buckets.push("Documentation");

  const summary = buckets.length ? buckets[0] : "Repository updates";
  let s = summary.length > SUBJECT_MAX_LENGTH ? summary.slice(0, SUBJECT_MAX_LENGTH) : summary;
  if (s && !/^[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

module.exports = {
  detectIssueNumbers,
  detectScopeFromFiles,
  getDefaultScopeFromPackage,
  looksBreaking,
  wrap72,
  stripGitComments,
  parseMessage,
  stripBreakingFooterLines,
  extractTypeAndSubject,
  normalizeSubject,
  buildFallbackSubject,
};
