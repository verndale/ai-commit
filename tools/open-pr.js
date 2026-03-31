#!/usr/bin/env node
/**
 * Deterministic PR creation with optional AI-bounded summary (tools/lib/pr-ai.js).
 *
 * Required env:
 * - GH_TOKEN or GITHUB_TOKEN (PAT in CI)
 *
 * Branch env (CI should set explicitly):
 * - PR_BASE_BRANCH — default: main
 * - PR_HEAD_BRANCH — default: current branch from git
 *
 * Optional AI: PR_AI=true, PR_AI_ENDPOINT, PR_AI_API_KEY, PR_AI_MODEL
 */

"use strict";

require("dotenv").config();

const { execSync } = require("node:child_process");
const { buildChangesByTypeMarkdown, parseHeader } = require("./lib/conventional-notes.js");
const {
  isAiEnabled,
  extractAllowedShortHashes,
  validateAiBullets,
  replaceSummarySection,
  generateAiSummary,
  generateAiLabelsAndChecklist,
} = require("./lib/pr-ai.js");

const TITLE_PRECEDENCE = [
  "feat",
  "fix",
  "perf",
  "docs",
  "refactor",
  "test",
  "ci",
  "build",
  "chore",
  "style",
  "revert",
];

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

function getRepo() {
  const remote = sh("git config --get remote.origin.url");
  const m =
    remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/i) ||
    remote.match(/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/i);
  if (!m) throw new Error(`Could not parse GitHub repo from origin: ${remote}`);
  return { owner: m[1], repo: m[2] };
}

function getBranchInfo(defaultBase = "main") {
  const baseBranch = process.env.PR_BASE_BRANCH || defaultBase;
  const headBranch =
    process.env.PR_HEAD_BRANCH || sh("git rev-parse --abbrev-ref HEAD");
  if (headBranch === baseBranch) {
    throw new Error(`Refusing to open PR from ${baseBranch}. Checkout a feature branch or set PR_HEAD_BRANCH.`);
  }
  return { baseBranch, headBranch };
}

function getCommits(baseBranch, headBranch) {
  sh(`git fetch origin ${baseBranch}:${baseBranch} --quiet || true`);
  const log = sh(`git log ${baseBranch}..${headBranch} --pretty=format:%H%x09%s`);
  if (!log) return [];
  return log.split("\n").map(line => {
    const [hash, subjectLine] = line.split("\t");
    return { hash, subjectLine };
  });
}

function getFileChanges(baseBranch, headBranch) {
  const raw = sh(`git diff --name-status ${baseBranch}...${headBranch}`);
  const files = raw
    ? raw.split("\n").map(l => {
        const [status, ...rest] = l.split("\t");
        return { status, path: rest.join("\t") };
      })
    : [];
  const stat = sh(`git diff --stat ${baseBranch}...${headBranch}`) || "";
  return { files, stat };
}

function pickTitle(commits) {
  const parsed = commits.map(c => ({ ...c, h: parseHeader(c.subjectLine) }));

  for (const t of TITLE_PRECEDENCE) {
    const match = parsed.find(p => p.h.type === t);
    if (match && match.h.subject) {
      const scope = match.h.scope ? `(${match.h.scope})` : "";
      return `${match.h.type}${scope}: ${match.h.subject}`.slice(0, 72);
    }
  }

  const branch = process.env.PR_HEAD_BRANCH || sh("git rev-parse --abbrev-ref HEAD");
  return `chore(pr): ${branch}`.slice(0, 72);
}

function buildBody({ title, commits, fileChanges, baseBranch, headBranch }) {
  const commitLines = commits.map(c => `- \`${c.hash.slice(0, 7)}\` ${c.subjectLine}`);
  const fileLines = fileChanges.files.length
    ? fileChanges.files.map(f => `- \`${f.status}\` ${f.path}`)
    : ["- None"];

  const commitsForNotes = commits.map(c => ({ hash: c.hash, message: c.subjectLine }));
  const changesByType = buildChangesByTypeMarkdown(commitsForNotes);

  return [
    `# ${title}`,
    ``,
    `## Summary (AI, bounded)`,
    `- _Reserved slot (AI may fill this)_`,
    ``,
    `## Changes by type`,
    changesByType,
    ``,
    `## Commits`,
    ...commitLines,
    ``,
    `## Files changed`,
    ...fileLines,
    ``,
    `## Diff stats`,
    "```",
    fileChanges.stat || "(no diff)",
    "```",
    ``,
    `## Testing`,
    `- [ ] Manual smoke test`,
    `- [ ] CI green`,
    ``,
    `## Risk / Impact`,
    `- Risk level: Low / Medium / High`,
    `- Rollback plan:`,
    ``,
    `Base: \`${baseBranch}\`  →  Head: \`${headBranch}\``,
  ].join("\n");
}

async function githubRequest({ method, url, token, body }) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${url} failed: ${res.status}\n${text}`);
  }
  return res.json();
}

async function findExistingPr({ owner, repo, headBranch, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(
    headBranch,
  )}`;
  const prs = await githubRequest({ method: "GET", url, token });
  return Array.isArray(prs) && prs.length ? prs[0] : null;
}

async function createOrUpdatePr({ owner, repo, baseBranch, headBranch, title, body, token, draft }) {
  const existing = await findExistingPr({ owner, repo, headBranch, token });

  if (existing) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${existing.number}`;
    const updated = await githubRequest({ method: "PATCH", url, token, body: { title, body } });
    return { action: "updated", pr: updated };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const created = await githubRequest({
    method: "POST",
    url,
    token,
    body: { title, body, head: headBranch, base: baseBranch, draft },
  });
  return { action: "created", pr: created };
}

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GH_TOKEN or GITHUB_TOKEN.");

  const draft = (process.env.PR_DRAFT || "true").toLowerCase() === "true";

  const { owner, repo } = getRepo();
  const { baseBranch, headBranch } = getBranchInfo("main");

  const commits = getCommits(baseBranch, headBranch);
  if (commits.length === 0) {
    throw new Error(`No commits found in ${baseBranch}..${headBranch}. Nothing to PR.`);
  }

  const title = pickTitle(commits);
  const fileChanges = getFileChanges(baseBranch, headBranch);

  let body = buildBody({
    title,
    commits,
    fileChanges,
    baseBranch,
    headBranch,
  });

  if (isAiEnabled()) {
    const allowedHashes = extractAllowedShortHashes(commits);

    try {
      const bullets = await generateAiSummary({ title, commits, fileChanges, allowedHashes });

      if (validateAiBullets(bullets, allowedHashes)) {
        body = replaceSummarySection(body, bullets);
      } else {
        console.log("AI summary rejected by validator; using deterministic placeholder.");
      }
    } catch (e) {
      console.log(`AI summary failed; using deterministic placeholder. (${e?.message || e})`);
    }

    try {
      const labelsChecklist = await generateAiLabelsAndChecklist({ title, body, commits });
      if (labelsChecklist) {
        body = body.trimEnd() + "\n\n" + labelsChecklist + "\n";
      }
    } catch (e) {
      console.log(`AI labels/checklist skipped. (${e?.message || e})`);
    }
  }

  const result = await createOrUpdatePr({
    owner,
    repo,
    baseBranch,
    headBranch,
    title,
    body,
    token,
    draft,
  });

  console.log(`${result.action.toUpperCase()}: ${result.pr.html_url}`);
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
